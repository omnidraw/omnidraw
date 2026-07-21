/**
 * @file Single-owner local Resource Store and location-transparent gateway.
 */

import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ResourceError,
  fnResourceBindingDecision,
  fnResourceEffectAllows,
  toSafeResourceError,
} from '../index';
import type {
  IResourceBindingResolver,
  IResourceControlStore,
  IResourceGateway,
  IResourceRequirementResolver,
  IResourceStore,
  IResourceWriteCapabilityVerifier,
  TResolvedResourceCall,
  TResourceCall,
  TResourceCallResult,
  TResourceDescriptor,
  TResourceKind,
  TResourceOperationReceipt,
  TResourcePlacement,
  TResourcePermission,
  TResourceRequirement,
} from '../index';
import { claimResourceOwner, type ResourceOwnerLease } from './ResourceOwnerLock';
import type { ILocalResourceProvider } from './ResourceProviderTypes';

type TLocalProviderContext = Readonly<{
  resource: Readonly<{ id: string; kind: TResourceKind }>;
  requirement: TResourceRequirement & Readonly<{
    required: boolean;
    scope: readonly TResourcePermission[];
  }>;
  canRead: boolean;
  canWrite: boolean;
}>;

export type ILocalResourceStoreProvider = ILocalResourceProvider;

export type TResourceReconciliationAuthority = Readonly<{
  canAdoptUnplacedResource(
    tenant: TTenantContext,
    resource: TResourceDescriptor,
  ): boolean | Promise<boolean>;
  canDeleteUnplacedResource(
    tenant: TTenantContext,
    resource: TResourceDescriptor,
  ): boolean | Promise<boolean>;
}>;

export type TResourceStoreServiceConfig = Readonly<{
  root: string;
  ownerId: string;
  controlStore: IResourceControlStore;
  providers: readonly ILocalResourceStoreProvider[];
  /** Explicit host authority for one-shot recovery of catalog rows with no placement. */
  reconciliationAuthority?: TResourceReconciliationAuthority;
  writeCapabilityVerifier?: IResourceWriteCapabilityVerifier;
  allowUnfencedWrites?: boolean;
  nowMs?: () => number;
}>;

export type TResourceStoreCreateRequest = Readonly<{
  id: string;
  kind: TResourceKind;
  name: string;
  storageKey?: string;
}>;

function resourceMatches(
  tenant: TTenantContext,
  resourceId: string,
  resource: TResourceDescriptor,
): boolean {
  return resource.orgId === tenant.orgId && resource.id === resourceId;
}

function placementMatches(
  tenant: TTenantContext,
  resourceId: string,
  placement: TResourcePlacement,
): boolean {
  return placement.orgId === tenant.orgId
    && placement.resourceId === resourceId
    && placement.status === 'active'
    && placement.cellId === tenant.cellId
    && placement.placementEpoch === tenant.placementEpoch;
}

function placementCanActivate(
  tenant: TTenantContext,
  resourceId: string,
  placement: TResourcePlacement,
): boolean {
  return placement.orgId === tenant.orgId
    && placement.resourceId === resourceId
    && placement.cellId === tenant.cellId
    && placement.placementEpoch === tenant.placementEpoch
    && (placement.status === 'reserved' || placement.status === 'active');
}

export class ResourceStoreService implements IResourceStore {
  readonly #controlStore: IResourceControlStore;
  readonly #providers = new Map<TResourceKind, ILocalResourceStoreProvider>();
  readonly #writeCapabilityVerifier?: IResourceWriteCapabilityVerifier;
  readonly #allowUnfencedWrites: boolean;
  readonly #reconciliationAuthority?: TResourceReconciliationAuthority;
  readonly #nowMs: () => number;
  readonly #ownerLease: ResourceOwnerLease;
  readonly #writeTails = new Map<string, Promise<void>>();
  readonly #inflight = new Set<Promise<unknown>>();
  #closed = false;
  #closePromise: Promise<void> | null = null;

  private constructor(
    config: TResourceStoreServiceConfig,
    ownerLease: ResourceOwnerLease,
  ) {
    this.#controlStore = config.controlStore;
    this.#writeCapabilityVerifier = config.writeCapabilityVerifier;
    this.#allowUnfencedWrites = config.allowUnfencedWrites ?? false;
    this.#reconciliationAuthority = config.reconciliationAuthority;
    this.#nowMs = config.nowMs ?? (() => Date.now());
    this.#ownerLease = ownerLease;
    for (const provider of config.providers) {
      if (this.#providers.has(provider.kind)) {
        throw new ResourceError(
          'RESOURCE_PROVIDER_UNAVAILABLE',
          `A provider is already registered for resource kind '${provider.kind}'.`,
        );
      }
      this.#providers.set(provider.kind, provider);
    }
  }

  static async open(config: TResourceStoreServiceConfig): Promise<ResourceStoreService> {
    const ownerLease = await claimResourceOwner({ root: config.root, ownerId: config.ownerId });
    try {
      return new ResourceStoreService(config, ownerLease);
    } catch (error) {
      await ownerLease.release();
      throw error;
    }
  }

  async call<TOutput = unknown>(
    tenant: TTenantContext,
    call: TResolvedResourceCall,
  ): Promise<TResourceCallResult<TOutput>> {
    this.#assertOpen();
    const operation = call.effect === 'write'
      ? this.#withWriteLane(
        tenant,
        call.resourceId,
        () => this.#dispatchCall<TOutput>(tenant, call),
      )
      : this.#dispatchCall<TOutput>(tenant, call);
    return this.#track(operation);
  }

  async #dispatchCall<TOutput>(
    tenant: TTenantContext,
    call: TResolvedResourceCall,
  ): Promise<TResourceCallResult<TOutput>> {
    const [resource, placement] = await Promise.all([
      this.#controlStore.getResource(tenant, call.resourceId),
      this.#controlStore.getPlacement(tenant, call.resourceId),
    ]);
    if (!resource || !placement) {
      throw new ResourceError('RESOURCE_NOT_FOUND', 'Resource was not found.');
    }
    if (
      !resourceMatches(tenant, call.resourceId, resource)
      || !placementMatches(tenant, call.resourceId, placement)
    ) {
      throw new ResourceError(
        'RESOURCE_PLACEMENT_STALE',
        'Resource catalog or placement identity is stale for this cell.',
      );
    }
    if (resource.kind !== call.kind) {
      throw new ResourceError('RESOURCE_KIND_MISMATCH', 'Resolved resource kind does not match its catalog entry.');
    }
    if (call.requirement.slot !== call.slot || call.requirement.kind !== resource.kind) {
      throw new ResourceError('RESOURCE_KIND_MISMATCH', 'Resolved resource requirement does not match its call.');
    }
    if (!fnResourceEffectAllows(call.requirement.effect, call.effect)) {
      throw new ResourceError(
        call.effect === 'read' ? 'RESOURCE_READ_NOT_ALLOWED' : 'RESOURCE_WRITE_NOT_ALLOWED',
        'Resolved resource requirement does not allow this operation.',
      );
    }
    if (resource.status !== 'ready') {
      throw new ResourceError(
        resource.status === 'migrating' ? 'RESOURCE_MIGRATING' : 'RESOURCE_NOT_READY',
        'Resource is not ready for calls.',
      );
    }

    const provider = this.#provider(resource.kind);
    const requirement: TLocalProviderContext['requirement'] = {
      ...call.requirement,
      required: call.requirement.required ?? true,
      scope: call.requirement.effect === 'read_write'
        ? ['read', 'write']
        : [call.requirement.effect],
    };
    const effect = provider.effect(call.operation, requirement, call.input);
    if (effect !== call.effect) {
      throw new ResourceError('RESOURCE_CALL_INVALID', 'Resource operation effect does not match the resolved call.');
    }
    if (call.effect === 'write') await this.#verifyWriteCapability(tenant, call);

    const output = await provider.dispatch({
      tenant,
      resource,
      requirement,
      canRead: call.effect === 'read',
      canWrite: call.effect === 'write',
    }, call.operation, call.input) as TOutput;
    return {
      output,
      ...(call.operationId
        ? { receipt: this.#receipt(call, true) }
        : {}),
    };
  }

  async reconcile(tenant: TTenantContext): Promise<void> {
    this.#assertOpen();
    return this.#track(this.#reconcile(tenant));
  }

  async #reconcile(tenant: TTenantContext): Promise<void> {
    const resources = await this.#controlStore.listResources(tenant);
    for (const resource of resources) {
      if (!resourceMatches(tenant, resource.id, resource)) continue;
      let placement = await this.#controlStore.getPlacement(tenant, resource.id);
      if (!placement && resource.status !== 'deleting') {
        placement = await this.#adoptMissingPlacement(tenant, resource);
      }
      if (resource.status === 'deleting' && !placement) {
        await this.#reconcileDeletingResource(tenant, resource);
        continue;
      }
      if (!placement || !placementCanActivate(tenant, resource.id, placement)) {
        continue;
      }
      await this.#reconcileResource(tenant, resource, placement);
    }
  }

  /** Atomically reserves catalog + placement, then provisions and activates it. */
  async createResource(
    tenant: TTenantContext,
    request: TResourceStoreCreateRequest,
  ): Promise<TResourceDescriptor> {
    this.#assertOpen();
    return this.#track(this.#withWriteLane(tenant, request.id, async () => {
      const created = await this.#controlStore.createResource(tenant, {
        id: request.id,
        kind: request.kind,
        name: request.name,
        cellId: tenant.cellId,
        placementEpoch: tenant.placementEpoch,
        storageKey: request.storageKey ?? request.id,
        nowMs: this.#nowMs(),
      });
      if (!resourceMatches(tenant, request.id, created)) {
        throw new ResourceError(
          'RESOURCE_PLACEMENT_STALE',
          'Created resource identity does not match this tenant placement.',
        );
      }
      const placement = await this.#controlStore.getPlacement(tenant, request.id);
      if (!placement) {
        throw new ResourceError(
          'RESOURCE_PLACEMENT_NOT_FOUND',
          'Resource placement reservation was not persisted.',
        );
      }
      await this.#reconcileResource(tenant, created, placement);
      const ready = await this.#controlStore.getResource(tenant, request.id);
      if (!ready || !resourceMatches(tenant, request.id, ready) || ready.status !== 'ready') {
        throw new ResourceError(
          'RESOURCE_NOT_READY',
          'Resource provisioning did not reach ready state.',
          ready ? { status: ready.status, lastError: ready.lastError } : undefined,
        );
      }
      return ready;
    }));
  }

  async #adoptMissingPlacement(
    tenant: TTenantContext,
    resource: TResourceDescriptor,
  ): Promise<TResourcePlacement | null> {
    if (
      !this.#reconciliationAuthority
      || !await this.#reconciliationAuthority.canAdoptUnplacedResource(tenant, resource)
    ) {
      return null;
    }
    const current = await this.#controlStore.getPlacement(tenant, resource.id);
    if (current) return current;
    const adopted = await this.#controlStore.reservePlacement(tenant, {
      resourceId: resource.id,
      cellId: tenant.cellId,
      placementEpoch: tenant.placementEpoch,
      storageKey: resource.id,
      nowMs: this.#nowMs(),
    });
    return placementCanActivate(tenant, resource.id, adopted) ? adopted : null;
  }

  async #reconcileResource(
    tenant: TTenantContext,
    resource: TResourceDescriptor,
    placement: TResourcePlacement,
  ): Promise<void> {
    if (
      !resourceMatches(tenant, resource.id, resource)
      || !placementCanActivate(tenant, resource.id, placement)
    ) {
      return;
    }
    let reconciliationState = resource;
    try {
      if (resource.status === 'deleting') {
        await this.#reconcileDeletingResource(tenant, resource);
        return;
      }
      const provider = this.#provider(resource.kind);
      if (resource.status === 'created') {
        const provisioning = await this.#controlStore.updateResourceState(tenant, {
          resourceId: resource.id,
          expectedStatus: 'created',
          status: 'provisioning',
          lastError: null,
          nowMs: this.#nowMs(),
        });
        if (!provisioning) return;
        if (!resourceMatches(tenant, resource.id, provisioning)) {
          throw new ResourceError(
            'RESOURCE_PLACEMENT_STALE',
            'Provisioning resource identity changed during reconciliation.',
          );
        }
        reconciliationState = provisioning;
        const currentPlacement = await this.#currentOwnedPlacement(tenant, resource.id);
        if (!currentPlacement) return;
        await provider.provision(provisioning, {});
        await this.#activateReady(tenant, provisioning, currentPlacement);
        return;
      }
      if (resource.status === 'provisioning' || (resource.status === 'ready' && provider.reconcileReady)) {
        const currentPlacement = await this.#currentOwnedPlacement(tenant, resource.id);
        if (!currentPlacement) return;
        const result = provider.reconcile
          ? await provider.reconcile(resource)
          : { status: 'error' as const, lastError: {
            code: 'RESOURCE_PROVIDER_UNAVAILABLE' as const,
            message: 'Resource provider cannot reconcile physical state.',
          } };
        if (result.status === 'ready') {
          await this.#activateReady(tenant, resource, currentPlacement);
        } else {
          await this.#markError(tenant, resource, result.lastError ?? {
            code: 'RESOURCE_PROVIDER_UNAVAILABLE',
            message: 'Resource provider reconciliation failed.',
          });
        }
      }
    } catch (error) {
      await this.#markError(tenant, reconciliationState, toSafeResourceError(error)).catch(() => undefined);
    }
  }

  async #reconcileDeletingResource(
    tenant: TTenantContext,
    resource: TResourceDescriptor,
  ): Promise<void> {
    if (!resourceMatches(tenant, resource.id, resource)) return;
    try {
      await this.#withWriteLane(tenant, resource.id, async () => {
        const placement = await this.#controlStore.getPlacement(tenant, resource.id);
        const mayDelete = placement
          ? placementCanActivate(tenant, resource.id, placement)
          : await this.#reconciliationAuthority?.canDeleteUnplacedResource(tenant, resource) === true;
        if (!mayDelete) return;
        const provider = this.#provider(resource.kind);
        await provider.delete(resource);
        if (!await this.#controlStore.deleteResource(tenant, resource.id)) {
          throw new ResourceError('RESOURCE_LIFECYCLE_CONFLICT', 'Resource deletion state changed.');
        }
      });
    } catch (error) {
      await this.#markError(tenant, resource, toSafeResourceError(error)).catch(() => undefined);
    }
  }

  async #activateReady(
    tenant: TTenantContext,
    resource: TResourceDescriptor,
    placement: TResourcePlacement,
  ): Promise<void> {
    if (
      !resourceMatches(tenant, resource.id, resource)
      || !placementCanActivate(tenant, resource.id, placement)
    ) {
      throw new ResourceError('RESOURCE_PLACEMENT_STALE', 'Resource placement cannot be activated by this cell.');
    }
    const active = await this.#controlStore.updatePlacement(tenant, {
      resourceId: resource.id,
      expectedEpoch: placement.placementEpoch,
      placementEpoch: placement.placementEpoch,
      cellId: placement.cellId,
      status: 'active',
      storageKey: placement.storageKey,
      nowMs: this.#nowMs(),
    });
    if (
      !active
      || !placementCanActivate(tenant, resource.id, active)
      || !placementMatches(tenant, resource.id, active)
    ) {
      throw new ResourceError('RESOURCE_PLACEMENT_STALE', 'Resource placement changed during activation.');
    }

    const expectedStatus = resource.status === 'created' ? 'provisioning' : resource.status;
    const ready = await this.#controlStore.updateResourceState(tenant, {
      resourceId: resource.id,
      expectedStatus,
      status: 'ready',
      lastError: null,
      nowMs: this.#nowMs(),
    });
    if (!ready) {
      throw new ResourceError('RESOURCE_LIFECYCLE_CONFLICT', 'Resource state changed during reconciliation.');
    }
  }

  async #markError(
    tenant: TTenantContext,
    resource: TResourceDescriptor,
    error: ReturnType<typeof toSafeResourceError>,
  ): Promise<void> {
    if (
      !resourceMatches(tenant, resource.id, resource)
      || !await this.#currentOwnedPlacement(tenant, resource.id)
    ) {
      return;
    }
    await this.#controlStore.updateResourceState(tenant, {
      resourceId: resource.id,
      expectedStatus: resource.status,
      status: 'error',
      lastError: error,
      nowMs: this.#nowMs(),
    });
  }

  async #currentOwnedPlacement(
    tenant: TTenantContext,
    resourceId: string,
  ): Promise<TResourcePlacement | null> {
    const placement = await this.#controlStore.getPlacement(tenant, resourceId);
    return placement && placementCanActivate(tenant, resourceId, placement) ? placement : null;
  }

  async #verifyWriteCapability(
    tenant: TTenantContext,
    call: TResolvedResourceCall,
  ): Promise<void> {
    if (!call.writeCapability) {
      if (this.#allowUnfencedWrites) return;
      throw new ResourceError('RESOURCE_WRITE_CAPABILITY_INVALID', 'A write capability is required.');
    }
    const claims = await this.#writeCapabilityVerifier?.verifyWriteCapability(
      tenant,
      call.writeCapability,
    );
    if (!claims) {
      throw new ResourceError('RESOURCE_WRITE_CAPABILITY_INVALID', 'Resource write capability is invalid.');
    }
    if (claims.expiresAtMs <= this.#nowMs()) {
      throw new ResourceError('RESOURCE_WRITE_CAPABILITY_EXPIRED', 'Resource write capability expired.');
    }
    if (
      claims.orgId !== tenant.orgId
      || claims.resourceId !== call.resourceId
      || claims.operation !== call.operation
    ) {
      throw new ResourceError('RESOURCE_WRITE_CAPABILITY_STALE', 'Resource write capability scope is stale.');
    }
  }

  #receipt(call: TResolvedResourceCall, committed: boolean): TResourceOperationReceipt {
    return {
      operationId: call.operationId!,
      resourceId: call.resourceId,
      effect: call.effect,
      committed,
    };
  }

  #provider(kind: TResourceKind): ILocalResourceStoreProvider {
    const provider = this.#providers.get(kind);
    if (!provider) {
      throw new ResourceError('RESOURCE_PROVIDER_UNAVAILABLE', `No provider is registered for '${kind}'.`);
    }
    return provider;
  }

  #withWriteLane<T>(
    tenant: TTenantContext,
    resourceId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = `${tenant.orgId}:${resourceId}`;
    const previous = this.#writeTails.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.#writeTails.set(key, tail);
    void tail.finally(() => {
      if (this.#writeTails.get(key) === tail) this.#writeTails.delete(key);
    });
    return result;
  }

  #track<T>(operation: Promise<T>): Promise<T> {
    this.#inflight.add(operation);
    void operation.finally(() => this.#inflight.delete(operation)).catch(() => undefined);
    return operation;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new ResourceError('RESOURCE_CALL_CANCELLED', 'Resource Store is closed.');
    }
  }

  /** Stop admitting calls without releasing provider or owner-fence custody. */
  quiesce(): void {
    this.#closed = true;
  }

  /** Drain calls admitted before quiescing while providers are still available. */
  async drain(): Promise<void> {
    while (this.#inflight.size > 0 || this.#writeTails.size > 0) {
      await Promise.allSettled([
        ...this.#inflight,
        ...this.#writeTails.values(),
      ]);
    }
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.quiesce();
    const closing = this.#closeOwnedResources();
    this.#closePromise = closing;
    void closing.catch(() => {
      if (this.#closePromise === closing) this.#closePromise = null;
    });
    return closing;
  }

  async #closeOwnedResources(): Promise<void> {
    await this.drain();
    const closes = await Promise.allSettled(
      [...this.#providers.values()].map((provider) => provider.close?.() ?? Promise.resolve()),
    );
    const failures = closes.flatMap((result) => (
      result.status === 'rejected' ? [result.reason] : []
    ));
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'One or more Resource Store providers failed to close; ownership was retained.',
      );
    }
    await this.#ownerLease.release();
  }
}

export type TResourceGatewayConfig = Readonly<{
  store: IResourceStore;
  bindings: IResourceBindingResolver;
  requirements: IResourceRequirementResolver;
}>;

export class ResourceGateway implements IResourceGateway {
  readonly #store: IResourceStore;
  readonly #bindings: IResourceBindingResolver;
  readonly #requirements: IResourceRequirementResolver;

  constructor(config: TResourceGatewayConfig) {
    this.#store = config.store;
    this.#bindings = config.bindings;
    this.#requirements = config.requirements;
  }

  async call<TOutput = unknown>(
    tenant: TTenantContext,
    call: TResourceCall,
  ): Promise<TResourceCallResult<TOutput>> {
    const [binding, requirement] = await Promise.all([
      this.#bindings.resolveBinding(tenant, call.slot),
      this.#requirements.resolveRequirement(tenant, call.slot),
    ]);
    if (!binding) throw new ResourceError('RESOURCE_NOT_BOUND', 'Resource slot is not bound.');
    if (!requirement) throw new ResourceError('RESOURCE_SLOT_UNKNOWN', 'Resource slot is not declared.');
    const decision = fnResourceBindingDecision(requirement, binding, call.effect);
    if (!decision.allowed) {
      const code = decision.reason === 'kind_mismatch'
        ? 'RESOURCE_KIND_MISMATCH'
        : call.effect === 'read'
          ? 'RESOURCE_READ_NOT_ALLOWED'
          : 'RESOURCE_WRITE_NOT_ALLOWED';
      throw new ResourceError(code, 'Resource binding does not allow this operation.');
    }
    if (call.kind && call.kind !== binding.kind) {
      throw new ResourceError('RESOURCE_KIND_MISMATCH', 'Logical call kind does not match its binding.');
    }
    return this.#store.call(tenant, {
      slot: call.slot,
      resourceId: binding.resourceId,
      kind: binding.kind,
      requirement,
      operation: call.operation,
      operationId: call.operationId,
      effect: call.effect,
      input: call.input,
      ...(call.effect === 'write' ? { writeCapability: call.writeCapability } : {}),
    }) as Promise<TResourceCallResult<TOutput>>;
  }
}
