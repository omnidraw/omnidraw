/**
 * @file Local Resource Store and location-transparent gateway.
 */

import {
  ResourceError,
  fnResourceBindingDecision,
  fnResourceEffectAllows,
  toSafeResourceError,
} from '#backend/shell/resources';
import type {
  IResourceBindingResolver,
  IResourceControlStore,
  IResourceGateway,
  IResourceRequirementResolver,
  IResourceStore,
  IResourceWriteCapabilityVerifier,
  IResourceWritePermitGuard,
  IResourceWritePermitCoordinator,
  TResolvedResourceCall,
  TResourceCall,
  TResourceCallResult,
  TResourceDescriptor,
  TResourceKind,
  TResourcePlacement,
  TResourcePermission,
  TResourceRequirement,
  TResourceWriteCapabilityClaims,
} from '#backend/shell/resources';
import type { ILocalResourceProvider } from './ResourceProviderTypes';
import { RESOURCE_MANAGEMENT_OPERATION } from '../../widget/CONSTANTS';
import {
  fnValidatePortableResourceOperationInput,
  fnValidatePortableResourceOperationResult,
} from '@omnidraw/sdk/contract';

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
    resource: TResourceDescriptor,
  ): boolean | Promise<boolean>;
  canDeleteUnplacedResource(
    resource: TResourceDescriptor,
  ): boolean | Promise<boolean>;
}>;

export type TResourceStoreServiceConfig = Readonly<{
  controlStore: IResourceControlStore;
  providers: readonly ILocalResourceStoreProvider[];
  placement: Readonly<{
    cellId: string;
    placementEpoch: number;
  }>;
  /** Explicit host authority for one-shot recovery of catalog rows with no placement. */
  reconciliationAuthority?: TResourceReconciliationAuthority;
  writeCapabilityVerifier?: IResourceWriteCapabilityVerifier;
  writePermitCoordinator?: IResourceWritePermitCoordinator;
  /** Process-local authority for trusted host management writes. */
  hostWriteCapability?: string;
  nowMs: () => number;
}>;

export type TResourceStoreCreateRequest = Readonly<{
  id: string;
  kind: TResourceKind;
  name: string;
  storageKey?: string;
}>;

function resourceMatches(
  resourceId: string,
  resource: TResourceDescriptor,
): boolean {
  return resource.id === resourceId;
}

function placementMatches(
  local: TResourceStoreServiceConfig['placement'],
  resourceId: string,
  placement: TResourcePlacement,
): boolean {
  return placement.resourceId === resourceId
    && placement.status === 'active'
    && placement.cellId === local.cellId
    && placement.placementEpoch === local.placementEpoch;
}

function namedDatabaseOperation(
  requirement: TResourceRequirement,
  operation: string,
  input: unknown,
): NonNullable<TResourceRequirement['operations']>[string] | undefined {
  if (
    requirement.kind !== 'db'
    || operation !== 'invoke'
    || input === null
    || typeof input !== 'object'
    || Array.isArray(input)
  ) return undefined;
  const name = (input as Readonly<Record<string, unknown>>).operation;
  return typeof name === 'string' ? requirement.operations?.[name] : undefined;
}

function validatePortableCall(
  requirement: TResourceRequirement,
  operation: string,
  effect: TResourcePermission,
  input: unknown,
): void {
  if (requirement.kind === 'secretStore') return;
  const declared = namedDatabaseOperation(requirement, operation, input);
  try {
    fnValidatePortableResourceOperationInput({
      kind: requirement.kind,
      operation,
      effect,
      input,
      ...(declared === undefined ? {} : { declaredEffect: declared.effect }),
    });
  } catch {
    throw new ResourceError(
      'RESOURCE_CALL_INVALID',
      'Resource operation input does not satisfy the portable contract.',
    );
  }
}

function validatePortableResult(
  requirement: TResourceRequirement,
  operation: string,
  input: unknown,
  output: unknown,
): void {
  if (requirement.kind === 'secretStore') return;
  const declared = namedDatabaseOperation(requirement, operation, input);
  try {
    fnValidatePortableResourceOperationResult({
      kind: requirement.kind,
      operation,
      result: output,
      ...(declared === undefined ? {} : { declaredResult: declared.result }),
    });
  } catch {
    throw new ResourceError(
      'RESOURCE_PROVIDER_UNAVAILABLE',
      'Resource provider result does not satisfy the portable contract.',
    );
  }
}

function placementCanActivate(
  local: TResourceStoreServiceConfig['placement'],
  resourceId: string,
  placement: TResourcePlacement,
): boolean {
  return placement.resourceId === resourceId
    && placement.cellId === local.cellId
    && placement.placementEpoch === local.placementEpoch
    && (placement.status === 'reserved' || placement.status === 'active');
}

export class ResourceStoreService implements IResourceStore {
  readonly #controlStore: IResourceControlStore;
  readonly #placement: TResourceStoreServiceConfig['placement'];
  readonly #providers = new Map<TResourceKind, ILocalResourceStoreProvider>();
  readonly #writeCapabilityVerifier?: IResourceWriteCapabilityVerifier;
  readonly #writePermitCoordinator?: IResourceWritePermitCoordinator;
  readonly #hostWriteCapability?: string;
  readonly #reconciliationAuthority?: TResourceReconciliationAuthority;
  readonly #nowMs: () => number;
  readonly #writeTails = new Map<string, Promise<void>>();
  readonly #inflight = new Set<Promise<unknown>>();
  #closed = false;
  #closePromise: Promise<void> | null = null;

  constructor(config: TResourceStoreServiceConfig) {
    this.#controlStore = config.controlStore;
    this.#placement = Object.freeze({ ...config.placement });
    this.#writeCapabilityVerifier = config.writeCapabilityVerifier;
    this.#writePermitCoordinator = config.writePermitCoordinator;
    this.#hostWriteCapability = config.hostWriteCapability;
    this.#reconciliationAuthority = config.reconciliationAuthority;
    this.#nowMs = config.nowMs;
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

  async call<TOutput = unknown>(
    call: TResolvedResourceCall,
  ): Promise<TResourceCallResult<TOutput>> {
    this.#assertOpen();
    const operation = call.effect === 'write'
      ? this.#withWriteLane(
        call.resourceId,
        () => this.#dispatchCall<TOutput>(call),
      )
      : this.#dispatchCall<TOutput>(call);
    return this.#track(operation);
  }

  async #dispatchCall<TOutput>(
    call: TResolvedResourceCall,
  ): Promise<TResourceCallResult<TOutput>> {
    const [resource, placement] = await Promise.all([
      this.#controlStore.getResource(call.resourceId),
      this.#controlStore.getPlacement(call.resourceId),
    ]);
    if (!resource || !placement) {
      throw new ResourceError('RESOURCE_NOT_FOUND', 'Resource was not found.');
    }
    if (
      !resourceMatches(call.resourceId, resource)
      || !placementMatches(this.#placement, call.resourceId, placement)
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
    if (
      effect === null
      && requirement.kind === 'db'
      && call.operation === 'invoke'
    ) {
      throw new ResourceError(
        'DB_NAMED_OPERATION_UNKNOWN',
        'Named database operation is not declared.',
      );
    }
    if (effect !== call.effect) {
      throw new ResourceError(
        call.effect === 'read'
          ? 'RESOURCE_READ_NOT_ALLOWED'
          : 'RESOURCE_WRITE_NOT_ALLOWED',
        'Resource operation effect does not match the resolved call.',
      );
    }
    const isPortableWidgetCall = call.operation !== RESOURCE_MANAGEMENT_OPERATION;
    if (isPortableWidgetCall) {
      validatePortableCall(requirement, call.operation, call.effect, call.input);
    }
    const providerContext = {
      resource,
      requirement,
      canRead: call.effect === 'read',
      canWrite: call.effect === 'write',
    };
    const claims = call.effect === 'write'
      ? await this.#verifyWriteCapability(call)
      : null;
    const dispatch = async (
      guard?: IResourceWritePermitGuard,
    ): Promise<TResourceCallResult<TOutput>> => {
      if (call.effect === 'write' && claims) {
        if (guard === undefined) {
          throw new ResourceError(
            'RESOURCE_WRITE_CAPABILITY_STALE',
            'A function resource mutation requires a live single-use permit.',
          );
        }
        await guard.assertCanCommit();
      }

      const output = await provider.dispatch(
        providerContext,
        call.operation,
        call.input,
      ) as TOutput;
      if (isPortableWidgetCall) {
        validatePortableResult(requirement, call.operation, call.input, output);
      }
      return {
        output,
      };
    };

    if (
      call.effect === 'write'
      && call.operationId
      && claims
      && this.#writePermitCoordinator
    ) {
      return this.#writePermitCoordinator.runWithWritePermit({
        claims,
        slot: call.slot,
        kind: call.kind,
        resourceId: call.resourceId,
        operation: call.operation,
        operationId: call.operationId,
        operationFingerprintSha256: claims.operationFingerprintSha256,
      }, dispatch);
    }
    return dispatch();
  }

  async reconcile(): Promise<void> {
    this.#assertOpen();
    return this.#track(this.#reconcile());
  }

  async #reconcile(): Promise<void> {
    const resources = await this.#controlStore.listResources();
    for (const resource of resources) {
      if (!resourceMatches(resource.id, resource)) continue;
      let placement = await this.#controlStore.getPlacement(resource.id);
      if (!placement && resource.status !== 'deleting') {
        placement = await this.#adoptMissingPlacement(resource);
      }
      if (resource.status === 'deleting' && !placement) {
        await this.#reconcileDeletingResource(resource);
        continue;
      }
      if (!placement || !placementCanActivate(this.#placement, resource.id, placement)) {
        continue;
      }
      await this.#reconcileResource(resource, placement);
    }
  }

  /** Atomically reserves catalog + placement, then provisions and activates it. */
  async createResource(
    request: TResourceStoreCreateRequest,
  ): Promise<TResourceDescriptor> {
    this.#assertOpen();
    return this.#track(this.#withWriteLane(request.id, async () => {
      const created = await this.#controlStore.createResource({
        id: request.id,
        kind: request.kind,
        name: request.name,
        cellId: this.#placement.cellId,
        placementEpoch: this.#placement.placementEpoch,
        storageKey: request.storageKey ?? request.id,
      });
      if (!resourceMatches(request.id, created)) {
        throw new ResourceError(
          'RESOURCE_PLACEMENT_STALE',
          'Created resource identity does not match the configured placement.',
        );
      }
      const placement = await this.#controlStore.getPlacement(request.id);
      if (!placement) {
        throw new ResourceError(
          'RESOURCE_PLACEMENT_NOT_FOUND',
          'Resource placement reservation was not persisted.',
        );
      }
      await this.#reconcileResource(created, placement);
      const ready = await this.#controlStore.getResource(request.id);
      if (!ready || !resourceMatches(request.id, ready) || ready.status !== 'ready') {
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
    resource: TResourceDescriptor,
  ): Promise<TResourcePlacement | null> {
    if (
      !this.#reconciliationAuthority
      || !await this.#reconciliationAuthority.canAdoptUnplacedResource(resource)
    ) {
      return null;
    }
    const current = await this.#controlStore.getPlacement(resource.id);
    if (current) return current;
    const adopted = await this.#controlStore.reservePlacement({
      resourceId: resource.id,
      cellId: this.#placement.cellId,
      placementEpoch: this.#placement.placementEpoch,
      storageKey: resource.id,
    });
    return placementCanActivate(this.#placement, resource.id, adopted) ? adopted : null;
  }

  async #reconcileResource(
    resource: TResourceDescriptor,
    placement: TResourcePlacement,
  ): Promise<void> {
    if (
      !resourceMatches(resource.id, resource)
      || !placementCanActivate(this.#placement, resource.id, placement)
    ) {
      return;
    }
    let reconciliationState = resource;
    try {
      if (resource.status === 'deleting') {
        await this.#reconcileDeletingResource(resource);
        return;
      }
      const provider = this.#provider(resource.kind);
      if (resource.status === 'created') {
        const provisioning = await this.#controlStore.updateResourceState({
          resourceId: resource.id,
          expectedStatus: 'created',
          status: 'provisioning',
          lastError: null,
        });
        if (!provisioning) return;
        if (!resourceMatches(resource.id, provisioning)) {
          throw new ResourceError(
            'RESOURCE_PLACEMENT_STALE',
            'Provisioning resource identity changed during reconciliation.',
          );
        }
        reconciliationState = provisioning;
        const currentPlacement = await this.#currentOwnedPlacement(resource.id);
        if (!currentPlacement) return;
        await provider.provision(provisioning, {});
        await this.#activateReady(provisioning, currentPlacement);
        return;
      }
      if (resource.status === 'provisioning' || (resource.status === 'ready' && provider.reconcileReady)) {
        const currentPlacement = await this.#currentOwnedPlacement(resource.id);
        if (!currentPlacement) return;
        const result = provider.reconcile
          ? await provider.reconcile(resource)
          : { status: 'error' as const, lastError: {
            code: 'RESOURCE_PROVIDER_UNAVAILABLE' as const,
            message: 'Resource provider cannot reconcile physical state.',
          } };
        if (result.status === 'ready') {
          await this.#activateReady(resource, currentPlacement);
        } else {
          await this.#markError(resource, result.lastError ?? {
            code: 'RESOURCE_PROVIDER_UNAVAILABLE',
            message: 'Resource provider reconciliation failed.',
          });
        }
      }
    } catch (error) {
      await this.#markError(reconciliationState, toSafeResourceError(error)).catch(() => undefined);
    }
  }

  async #reconcileDeletingResource(
    resource: TResourceDescriptor,
  ): Promise<void> {
    if (!resourceMatches(resource.id, resource)) return;
    try {
      await this.#withWriteLane(resource.id, async () => {
        const placement = await this.#controlStore.getPlacement(resource.id);
        const mayDelete = placement
          ? placementCanActivate(this.#placement, resource.id, placement)
          : await this.#reconciliationAuthority?.canDeleteUnplacedResource(resource) === true;
        if (!mayDelete) return;
        const provider = this.#provider(resource.kind);
        await provider.delete(resource);
        if (!await this.#controlStore.deleteResource(resource.id)) {
          throw new ResourceError('RESOURCE_LIFECYCLE_CONFLICT', 'Resource deletion state changed.');
        }
      });
    } catch (error) {
      await this.#markError(resource, toSafeResourceError(error)).catch(() => undefined);
    }
  }

  async #activateReady(
    resource: TResourceDescriptor,
    placement: TResourcePlacement,
  ): Promise<void> {
    if (
      !resourceMatches(resource.id, resource)
      || !placementCanActivate(this.#placement, resource.id, placement)
    ) {
      throw new ResourceError('RESOURCE_PLACEMENT_STALE', 'Resource placement cannot be activated by this cell.');
    }
    const active = await this.#controlStore.updatePlacement({
      resourceId: resource.id,
      expectedEpoch: placement.placementEpoch,
      placementEpoch: placement.placementEpoch,
      cellId: placement.cellId,
      status: 'active',
      storageKey: placement.storageKey,
    });
    if (
      !active
      || !placementCanActivate(this.#placement, resource.id, active)
      || !placementMatches(this.#placement, resource.id, active)
    ) {
      throw new ResourceError('RESOURCE_PLACEMENT_STALE', 'Resource placement changed during activation.');
    }

    const expectedStatus = resource.status === 'created' ? 'provisioning' : resource.status;
    const ready = await this.#controlStore.updateResourceState({
      resourceId: resource.id,
      expectedStatus,
      status: 'ready',
      lastError: null,
    });
    if (!ready) {
      throw new ResourceError('RESOURCE_LIFECYCLE_CONFLICT', 'Resource state changed during reconciliation.');
    }
  }

  async #markError(
    resource: TResourceDescriptor,
    error: ReturnType<typeof toSafeResourceError>,
  ): Promise<void> {
    if (
      !resourceMatches(resource.id, resource)
      || !await this.#currentOwnedPlacement(resource.id)
    ) {
      return;
    }
    await this.#controlStore.updateResourceState({
      resourceId: resource.id,
      expectedStatus: resource.status,
      status: 'error',
      lastError: error,
    });
  }

  async #currentOwnedPlacement(
    resourceId: string,
  ): Promise<TResourcePlacement | null> {
    const placement = await this.#controlStore.getPlacement(resourceId);
    return placement && placementCanActivate(this.#placement, resourceId, placement) ? placement : null;
  }

  async #verifyWriteCapability(
    call: TResolvedResourceCall,
  ): Promise<TResourceWriteCapabilityClaims | null> {
    if (call.writeCapability && call.writeCapability === this.#hostWriteCapability) return null;
    if (!call.writeCapability) {
      throw new ResourceError('RESOURCE_WRITE_CAPABILITY_INVALID', 'A write capability is required.');
    }
    if (!call.operationId) {
      throw new ResourceError(
        'RESOURCE_WRITE_CAPABILITY_INVALID',
        'A fenced write requires a host-owned operation id.',
      );
    }
    const claims = await this.#writeCapabilityVerifier?.verifyWriteCapability(
      call.writeCapability,
    );
    if (!claims) {
      throw new ResourceError('RESOURCE_WRITE_CAPABILITY_INVALID', 'Resource write capability is invalid.');
    }
    if (claims.expiresAtMs <= this.#nowMs()) {
      throw new ResourceError('RESOURCE_WRITE_CAPABILITY_EXPIRED', 'Resource write capability expired.');
    }
    if (
      claims.resourceId !== call.resourceId
      || claims.operation !== call.operation
      || claims.operationId !== call.operationId
    ) {
      throw new ResourceError('RESOURCE_WRITE_CAPABILITY_STALE', 'Resource write capability scope is stale.');
    }
    return claims;
  }

  #provider(kind: TResourceKind): ILocalResourceStoreProvider {
    const provider = this.#providers.get(kind);
    if (!provider) {
      throw new ResourceError('RESOURCE_PROVIDER_UNAVAILABLE', `No provider is registered for '${kind}'.`);
    }
    return provider;
  }

  #withWriteLane<T>(
    resourceId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = resourceId;
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

  /** Stop admitting calls while admitted work and providers remain available. */
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
        'One or more Resource Store providers failed to close; provider cleanup remains incomplete.',
      );
    }
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
    call: TResourceCall,
  ): Promise<TResourceCallResult<TOutput>> {
    const [binding, requirement] = await Promise.all([
      this.#bindings.resolveBinding(call.slot),
      this.#requirements.resolveRequirement(call.slot),
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
    return this.#store.call({
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
