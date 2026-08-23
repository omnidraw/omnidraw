/**
 * @file Local resource catalog, gateway, lifecycle, and consumer-use coordination.
 *
 * The manager deliberately depends on structural stores and requirement resolvers.
 * Host packages adapt their persistence models at the edge.
 */

import { ResourceError, toResourceError } from '#backend/core/resources/ResourceError';
import type {
  TResourceBinding,
  TResourceJson,
  TResourceKind,
  TResourcePermission,
  TResourceRequirement,
  TResourceStatus,
} from '#backend/core/resources/types';
import type { ILocalResourceProvider } from './ResourceProviderTypes';
import {
  fnResourceBindingFromManaged,
  fnResourceRequirementFromManaged,
} from './fn.resource-manager-gateway';

const RESOURCE_NAME_MAX_LENGTH = 120;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type TResourceScope = ('read' | 'write')[];

export type TManagedResourceRequirement = Readonly<{
  kind: TResourceKind;
  required: boolean;
  scope: TResourceScope;
  arbitrarySql?: boolean;
  operations?: Readonly<Record<string, Readonly<{
    effect: 'read' | 'write';
    sql: string;
    parameters?: Readonly<Record<string, Readonly<{
      type: 'string' | 'number' | 'boolean' | 'bigint' | 'bytes' | 'json';
      required?: boolean;
      nullable?: boolean;
    }>>>;
    result: 'rows' | 'execute';
    jsonColumns?: readonly string[];
  }>>>;
}>;

export type TResourceCatalogRecord = Readonly<{
  id: string;
  kind: TResourceKind;
  name: string;
  status: TResourceStatus;
  lastError: TResourceJson | null;
  createdAtSec: string;
  updatedAtSec: string;
}>;

type TResolvedResourceBinding = Readonly<{
  slot: string;
  resourceId: string;
  allowRead: boolean;
  allowWrite: boolean;
}>;

export type TResourceFunctionClass = 'fn' | 'fx' | 'tx';

export type TResourceManagerCall = Readonly<{
  consumerId: string;
  definitionName: string;
  invocationId: number;
  functionClass: TResourceFunctionClass;
  slot: string;
  kind: TResourceKind;
  operation: string;
  args: unknown;
}>;

export type TResourceDirectBinding = Readonly<{
  resourceId: string;
  requirement: TManagedResourceRequirement;
  scope: TResourceScope;
}>;

export type TResourceGatewayAuthorization = Readonly<{
  binding: TResourceBinding;
  requirement: TResourceRequirement;
  effect: TResourcePermission;
}>;

export type IResourceManagerStore = Readonly<{
  catalog: Readonly<{
    list(filter: Readonly<{ kind?: TResourceKind; status?: TResourceStatus }>): Promise<readonly TResourceCatalogRecord[]>;
    get(args: Readonly<{ id: string }>): Promise<TResourceCatalogRecord | null>;
    findByNameKey(args: Readonly<{ nameKey: string }>): Promise<readonly TResourceCatalogRecord[]>;
    create(args: Readonly<{ id: string; kind: TResourceKind; name: string; status: TResourceStatus }>): Promise<TResourceCatalogRecord>;
    rename(args: Readonly<{ id: string; name: string }>): Promise<TResourceCatalogRecord | null>;
    updateProviderState(args: Readonly<{
      id: string;
      status: TResourceStatus;
      expectedStatus?: TResourceStatus;
      lastError: TResourceJson | null;
    }>): Promise<TResourceCatalogRecord | null>;
    beginDelete(args: Readonly<{ id: string }>): Promise<TResourceCatalogRecord | null>;
    delete(args: Readonly<{ id: string }>): Promise<boolean>;
  }>;
  migration: Readonly<{
    hasActiveWork(resourceId: string): Promise<boolean>;
  }>;
}>;

export type TResourceManagerConfig = Readonly<{
  readonly store: IResourceManagerStore;
  readonly crypto: Pick<Crypto, 'randomUUID'>;
  readonly providers: readonly ILocalResourceProvider[];
  /** The Resource Store owns provider shutdown in split manager/store composition. */
  readonly closeProviders?: boolean;
}>;

export type TCreateResourceArgs = Readonly<{
  readonly kind: TResourceKind;
  readonly name: string;
}>;

function normalizedResourceName(name: unknown): { name: string; key: string } {
  if (typeof name !== 'string') {
    throw new ResourceError('RESOURCE_NAME_INVALID', 'Resource names must be strings.');
  }
  const displayName = name.normalize('NFC').trim();
  if (displayName.length === 0) {
    throw new ResourceError('RESOURCE_NAME_INVALID', 'Resource names cannot be empty.');
  }
  if (displayName.length > RESOURCE_NAME_MAX_LENGTH) {
    throw new ResourceError(
      'RESOURCE_NAME_INVALID',
      `Resource names cannot exceed ${RESOURCE_NAME_MAX_LENGTH} characters.`,
    );
  }
  if (CONTROL_CHARACTER_PATTERN.test(displayName)) {
    throw new ResourceError('RESOURCE_NAME_INVALID', 'Resource names cannot contain control characters.');
  }
  return { name: displayName, key: displayName.toLowerCase() };
}

function validateScope(scope: readonly string[], requirement: TManagedResourceRequirement): TResourceScope {
  if (!Array.isArray(scope) || scope.length === 0 || scope.length > 2 || new Set(scope).size !== scope.length) {
    throw new ResourceError('RESOURCE_SCOPE_INVALID', 'Resource scope must be a non-empty duplicate-free subset of read and write.');
  }
  for (const permission of scope) {
    if ((permission !== 'read' && permission !== 'write') || !requirement.scope.includes(permission)) {
      throw new ResourceError('RESOURCE_SCOPE_INVALID', 'A binding may reduce but never broaden the manifest resource scope.', {
        requestedScope: [...scope],
        manifestScope: [...requirement.scope],
      });
    }
  }
  return [...scope] as TResourceScope;
}

function safeLifecycleError(error: unknown): TResourceJson {
  if (error instanceof ResourceError) return { code: error.code, message: error.message };
  return { code: 'RESOURCE_PROVIDER_UNAVAILABLE', message: 'Resource provider operation failed.' };
}

export class ResourceManager {
  readonly #store: IResourceManagerStore;
  readonly #crypto: Pick<Crypto, 'randomUUID'>;
  readonly #closeProviders: boolean;
  readonly #providers = new Map<TResourceKind, ILocalResourceProvider>();
  readonly #inflight = new Map<string, Set<Promise<unknown>>>();
  readonly #gatewayCalls = new Set<Promise<unknown>>();
  readonly #gatewayCancellations = new Set<(error: ResourceError) => void>();
  readonly #lifecycleOperations = new Set<Promise<unknown>>();
  readonly #blockedResources = new Set<string>();
  readonly #resourceGateTails = new Map<string, Promise<void>>();
  #closed = false;
  #closePromise: Promise<void> | null = null;

  constructor(config: TResourceManagerConfig) {
    this.#store = config.store;
    this.#crypto = config.crypto;
    this.#closeProviders = config.closeProviders ?? true;
    for (const provider of config.providers) this.registerProvider(provider);
  }

  registerProvider(provider: ILocalResourceProvider): void {
    this.#assertOpen();
    if (this.#providers.has(provider.kind)) {
      throw new ResourceError('RESOURCE_PROVIDER_UNAVAILABLE', `A provider is already registered for resource kind "${provider.kind}".`);
    }
    this.#providers.set(provider.kind, provider);
  }

  listResources(filter: { kind?: TResourceKind; status?: TResourceStatus } = {}): Promise<readonly TResourceCatalogRecord[]> {
    return this.#store.catalog.list(filter)
      .catch((error) => { throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resources could not be listed.'); });
  }

  getResource(id: string): Promise<TResourceCatalogRecord | null> {
    return this.#readResource(id);
  }

  async resolveResourceByName(
    resourceName: string,
    options: { requireReady: boolean; kind?: TResourceKind },
  ): Promise<TResourceCatalogRecord> {
    const normalized = normalizedResourceName(resourceName);
    const matches = await this.#store.catalog.findByNameKey({ nameKey: normalized.key })
      .catch((error) => { throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource name lookup failed.'); });
    if (matches.length === 0) {
      throw new ResourceError('RESOURCE_NOT_FOUND', `Resource '${normalized.name}' was not found.`);
    }
    if (matches.length > 1) {
      throw new ResourceError(
        'RESOURCE_NAME_AMBIGUOUS',
        `Resource name '${normalized.name}' is ambiguous and must be repaired by the host.`,
      );
    }
    const resource = matches[0]!;
    if (options.kind && resource.kind !== options.kind) {
      throw new ResourceError(
        'RESOURCE_KIND_MISMATCH',
        `Resource '${resource.name}' is ${resource.kind}, not ${options.kind}.`,
      );
    }
    if (options.requireReady && resource.status !== 'ready') {
      throw new ResourceError('RESOURCE_NOT_READY', `Resource '${resource.name}' is not ready (status: ${resource.status}).`);
    }
    return resource;
  }

  reconcileStartup(): Promise<void> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#reconcileStartup());
  }

  async #reconcileStartup(): Promise<void> {
    const resources = await this.#store.catalog.list({})
      .catch((error) => { throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource recovery state could not be listed.'); });

    for (const resource of resources) {
      const provider = this.#provider(resource.kind);
      if (resource.status === 'ready' && !provider.reconcileReady) continue;
      if (resource.kind === 'db' && resource.status === 'migrating') continue;
      this.#blockedResources.add(resource.id);
      try {
        if (resource.status === 'deleting') {
          await provider.delete(resource);
          await this.#store.catalog.delete({ id: resource.id });
          continue;
        }

        if (!provider.reconcile) {
          if (resource.status !== 'error') {
            await this.#markResourceError(resource.id, new ResourceError(
              'RESOURCE_PROVIDER_UNAVAILABLE',
              'Resource recovery requires an explicit provider repair operation.',
            ));
          }
          continue;
        }

        const reconciliation = await provider.reconcile(resource);
        await this.#store.catalog.updateProviderState({
          id: resource.id,
          status: reconciliation.status,
          lastError: reconciliation.status === 'ready'
            ? null
            : reconciliation.lastError ?? {
                code: 'RESOURCE_PROVIDER_UNAVAILABLE',
                message: 'Resource recovery could not be verified.',
              },
        });
      } catch (error) {
        await this.#markResourceError(resource.id, error);
      } finally {
        this.#blockedResources.delete(resource.id);
      }
    }
  }

  createResource(args: TCreateResourceArgs): Promise<TResourceCatalogRecord> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#createResource(args));
  }

  async #createResource(args: TCreateResourceArgs): Promise<TResourceCatalogRecord> {
    const provider = this.#provider(args.kind);
    const id = this.#crypto.randomUUID();
    try {
      await this.#store.catalog.create({ id, kind: args.kind, name: normalizedResourceName(args.name).name, status: 'created' });
    } catch (error) {
      throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', `Failed to create ${args.kind} resource catalog entry.`);
    }
    const provisioning = await this.#store.catalog.updateProviderState({ id, status: 'provisioning', lastError: null })
      .catch((error) => { throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', `Failed to begin ${args.kind} resource provisioning.`); });
    if (!provisioning) throw new ResourceError('RESOURCE_NOT_FOUND', `Resource '${args.name}' disappeared during provisioning.`);
    try {
      await provider.provision(provisioning, args);
      const ready = await this.#store.catalog.updateProviderState({ id, status: 'ready', lastError: null });
      if (!ready) throw new ResourceError('RESOURCE_NOT_FOUND', `Resource '${args.name}' disappeared during provisioning.`);
      return ready;
    } catch (error) {
      await this.#markResourceError(id, error);
      throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', `Failed to provision ${args.kind} resource.`);
    }
  }

  async renameResource(args: { id: string; name: string }): Promise<TResourceCatalogRecord> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#withResourceGate(args.id, async () => {
      const current = await this.#requireResource(args.id);
      if (current.status === 'provisioning' || current.status === 'migrating' || current.status === 'deleting') {
        throw new ResourceError('RESOURCE_NOT_READY', `Resource "${current.name}" cannot be renamed while ${current.status}.`);
      }
      if (this.#blockedResources.has(args.id)) {
        throw new ResourceError('RESOURCE_NOT_READY', `Resource "${current.name}" is busy with a lifecycle operation.`);
      }
      const resource = await this.#store.catalog.rename({ id: args.id, name: normalizedResourceName(args.name).name })
        .catch((error) => { throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource rename failed.'); });
      if (!resource) throw new ResourceError('RESOURCE_NOT_FOUND', 'Resource was not found.');
      return resource;
    }));
  }

  deleteResource(id: string): Promise<void> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#deleteResource(id));
  }

  async #deleteResource(id: string): Promise<void> {
    this.#assertOpen();
    return this.#withResourceGate(id, async () => {
      const resource = await this.#requireResource(id);
      if (this.#blockedResources.has(id)) {
        throw new ResourceError('RESOURCE_NOT_READY', `Resource "${resource.name}" already has a lifecycle operation in progress.`);
      }
      if (resource.kind === 'db' && await this.#store.migration.hasActiveWork(id)) {
        throw new ResourceError('RESOURCE_NOT_READY', `DbResource "${resource.name}" has accepted draft or apply work that must finish or be discarded before deletion.`);
      }
      this.#blockedResources.add(id);
      try {
        const deleting = await this.#store.catalog.beginDelete({ id })
          .catch((error) => { throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource deletion could not begin.'); });
        if (!deleting) {
          throw new ResourceError('RESOURCE_NOT_READY', `Resource "${resource.name}" cannot begin deletion from status "${resource.status}".`);
        }
        await this.#drain(id);
        try {
          await this.#provider(resource.kind).delete(deleting);
          const deleted = await this.#store.catalog.delete({ id });
          if (!deleted) throw new ResourceError('RESOURCE_NOT_FOUND', `Resource '${resource.name}' was not deleted.`);
        } catch (error) {
          await this.#markResourceError(id, error);
          throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', `Failed to delete ${resource.kind} resource.`);
        }
      } finally {
        this.#blockedResources.delete(id);
      }
    });
  }

  withReadyResource<T>(
    resourceId: string,
    operation: (resource: TResourceCatalogRecord) => Promise<T>,
  ): Promise<T> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#withResourceGate(resourceId, async () => {
      const resource = await this.#requireResource(resourceId);
      if (resource.status !== 'ready' || this.#blockedResources.has(resourceId)) this.#throwUnavailable(resource);
      return operation(resource);
    }));
  }

  /** Resolves one caller-supplied resource choice into exact host authorization. */
  resolveGatewayCall(
    call: TResourceManagerCall,
    direct: TResourceDirectBinding,
  ): Promise<TResourceGatewayAuthorization> {
    if (this.#closed) {
      return Promise.reject(new ResourceError('RESOURCE_CALL_CANCELLED', 'Resource gateway is closed.'));
    }
    return this.#runGatewayCall(this.#resolveGatewayAuthorization(call, direct));
  }

  async #resolveGatewayAuthorization(
    call: TResourceManagerCall,
    direct: TResourceDirectBinding,
  ): Promise<TResourceGatewayAuthorization> {
    const requirement = direct.requirement;
    if (requirement.kind !== call.kind) {
      throw new ResourceError('RESOURCE_KIND_MISMATCH', `Slot "${call.slot}" is not a ${call.kind} resource.`);
    }

    const scope = validateScope(direct.scope, requirement);
    const binding: TResolvedResourceBinding = {
      slot: call.slot,
      resourceId: direct.resourceId,
      allowRead: scope.includes('read'),
      allowWrite: scope.includes('write'),
    };

    this.#assertOpen();
    const provider = this.#provider(requirement.kind);
    const effect = provider.effect(call.operation, requirement, call.args);
    if (!effect) {
      throw new ResourceError(
        'RESOURCE_PROVIDER_UNAVAILABLE',
        `Unknown ${requirement.kind} operation "${call.operation}".`,
      );
    }
    const canRead = call.functionClass !== 'fn'
      && requirement.scope.includes('read')
      && binding.allowRead;
    const canWrite = call.functionClass === 'tx'
      && requirement.scope.includes('write')
      && binding.allowWrite;
    if (effect === 'read' && !canRead) {
      throw new ResourceError('RESOURCE_READ_NOT_ALLOWED', `Read access is not allowed for resource slot "${call.slot}".`);
    }
    if (effect === 'write' && !canWrite) {
      throw new ResourceError('RESOURCE_WRITE_NOT_ALLOWED', `Write access is not allowed for resource slot "${call.slot}".`);
    }

    const gatewayRequirement = fnResourceRequirementFromManaged(call.slot, requirement);
    return {
      requirement: gatewayRequirement,
      binding: fnResourceBindingFromManaged(gatewayRequirement, binding),
      effect,
    };
  }

  callWithDirectBinding(call: TResourceManagerCall, direct: TResourceDirectBinding): Promise<unknown> {
    if (this.#closed) return Promise.reject(new ResourceError('RESOURCE_CALL_CANCELLED', 'Resource gateway is closed.'));
    const resolving = (async () => {
      if (direct.requirement.kind !== call.kind) {
        throw new ResourceError('RESOURCE_KIND_MISMATCH', `Slot "${call.slot}" is not a ${call.kind} resource.`);
      }
      const scope = validateScope(direct.scope, direct.requirement);
      const binding: TResolvedResourceBinding = {
        slot: call.slot,
        resourceId: direct.resourceId,
        allowRead: scope.includes('read'),
        allowWrite: scope.includes('write'),
      };
      return this.#track(direct.resourceId, this.#resolveBoundCall(call, direct.requirement, binding));
    })();
    return this.#runGatewayCall(resolving);
  }

  async #resolveBoundCall(
    call: TResourceManagerCall,
    requirement: TManagedResourceRequirement,
    binding: TResolvedResourceBinding,
  ): Promise<unknown> {
    const resource = await this.#requireResource(binding.resourceId);
    if (resource.kind !== requirement.kind) throw new ResourceError('RESOURCE_KIND_MISMATCH', `Bound resource kind does not match slot "${call.slot}".`);
    if (resource.status !== 'ready' || this.#blockedResources.has(resource.id)) this.#throwCallUnavailable(resource);
    return this.#dispatchResolvedCall(call, requirement, binding, resource);
  }

  async #dispatchResolvedCall(
    call: TResourceManagerCall,
    requirement: TManagedResourceRequirement,
    binding: TResolvedResourceBinding,
    resource: TResourceCatalogRecord,
  ): Promise<unknown> {
    if (this.#blockedResources.has(resource.id)) this.#throwCallUnavailable(resource);
    const provider = this.#provider(resource.kind);
    const effect = provider.effect(call.operation, requirement, call.args);
    if (!effect) throw new ResourceError('RESOURCE_PROVIDER_UNAVAILABLE', `Unknown ${resource.kind} operation "${call.operation}".`);
    const canRead = call.functionClass !== 'fn' && requirement.scope.includes('read') && binding.allowRead;
    const canWrite = call.functionClass === 'tx' && requirement.scope.includes('write') && binding.allowWrite;
    if (effect === 'read' && !canRead) throw new ResourceError('RESOURCE_READ_NOT_ALLOWED', `Read access is not allowed for resource slot "${call.slot}".`);
    if (effect === 'write' && !canWrite) throw new ResourceError('RESOURCE_WRITE_NOT_ALLOWED', `Write access is not allowed for resource slot "${call.slot}".`);

    return provider.dispatch({ resource, requirement, binding, functionClass: call.functionClass, slot: call.slot, canRead, canWrite }, call.operation, call.args);
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#closePromise = (async () => {
      const cancellation = new ResourceError('RESOURCE_CALL_CANCELLED', 'Resource gateway closed before the operation completed.');
      for (const cancel of [...this.#gatewayCancellations]) cancel(cancellation);
      await Promise.allSettled([...this.#lifecycleOperations]);
      await Promise.allSettled([...this.#gatewayCalls]);
      await Promise.allSettled(
        [...this.#inflight.keys()].map((resourceId) => this.#drain(resourceId)),
      );
      const closes = this.#closeProviders
        ? await Promise.allSettled(
          [...this.#providers.values()].map((provider) => provider.close?.() ?? Promise.resolve()),
        )
        : [];
      const failures = closes.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length > 0) {
        throw new AggregateError(failures, 'One or more resource providers failed to close.');
      }
    })();
    return this.#closePromise;
  }

  drainResource(resourceId: string): Promise<void> {
    return this.#drain(resourceId);
  }

  coordinateResourceMigration<T>(
    resourceId: string,
    operation: (resource: TResourceCatalogRecord) => Promise<T>,
  ): Promise<T> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#coordinateResourceMigration(resourceId, operation));
  }

  /**
   * Settles a catalog row left in `migrating` after interrupted or stale db
   * work was reconciled from durable apply and physical backup evidence.
   * The transition is compare-and-set against `migrating`, so a newer
   * admitted migration is never overwritten.
   */
  settleResourceMigration(
    resourceId: string,
    settlement: Readonly<{ status: 'ready' } | { status: 'error'; code: string; message: string }>,
  ): Promise<void> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#withResourceGate(resourceId, async () => {
      const resource = await this.#readResource(resourceId);
      if (!resource || resource.status !== 'migrating') return;
      await this.#store.catalog.updateProviderState({
        id: resourceId,
        status: settlement.status,
        expectedStatus: 'migrating',
        lastError: settlement.status === 'error'
          ? { code: settlement.code, message: settlement.message }
          : null,
      });
    }));
  }

  async #coordinateResourceMigration<T>(
    resourceId: string,
    operation: (resource: TResourceCatalogRecord) => Promise<T>,
  ): Promise<T> {
    this.#assertOpen();
    return this.#withResourceGate(resourceId, async () => {
      const resource = await this.#requireResource(resourceId);
      if (resource.kind !== 'db') {
        throw new ResourceError('RESOURCE_KIND_MISMATCH', `Resource '${resource.name}' is not a DbResource.`);
      }
      if (resource.status !== 'ready' || this.#blockedResources.has(resourceId)) {
        this.#throwUnavailable(resource);
      }
      this.#blockedResources.add(resourceId);
      try {
        await this.#drain(resourceId);
        const migrating = await this.#store.catalog.updateProviderState({
          id: resourceId,
          status: 'migrating',
          lastError: null,
        });
        if (!migrating) {
          throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource catalog row disappeared before apply.');
        }
        try {
          const result = await operation(migrating);
          const ready = await this.#store.catalog.updateProviderState({
            id: resourceId,
            status: 'ready',
            expectedStatus: 'migrating',
            lastError: null,
          });
          if (!ready) {
            throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource catalog state changed before the migration could be marked ready.');
          }
          return result;
        } catch (error) {
          const current = await this.#readResource(resourceId).catch(() => null);
          if (current?.status === 'migrating') await this.#markResourceError(resourceId, error, 'migrating');
          throw error;
        }
      } finally {
        this.#blockedResources.delete(resourceId);
      }
    });
  }

  async #withResourceGate<T>(resourceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#resourceGateTails.get(resourceId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    this.#resourceGateTails.set(resourceId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.#resourceGateTails.get(resourceId) === tail) {
        void tail.finally(() => {
          if (this.#resourceGateTails.get(resourceId) === tail) this.#resourceGateTails.delete(resourceId);
        });
      }
    }
  }

  #provider(kind: TResourceKind): ILocalResourceProvider {
    const provider = this.#providers.get(kind);
    if (!provider) throw new ResourceError('RESOURCE_PROVIDER_UNAVAILABLE', `No provider is registered for resource kind "${kind}".`);
    return provider;
  }

  async #requireResource(id: string): Promise<TResourceCatalogRecord> {
    const resource = await this.#readResource(id);
    if (!resource) throw new ResourceError('RESOURCE_NOT_FOUND', 'Resource was not found.');
    return resource;
  }

  #readResource(id: string): Promise<TResourceCatalogRecord | null> {
    return this.#store.catalog.get({ id })
      .catch((error) => { throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource catalog state could not be read.'); });
  }

  #throwUnavailable(resource: TResourceCatalogRecord): never {
    if (resource.status === 'migrating') throw new ResourceError('RESOURCE_MIGRATING', `Resource "${resource.name}" is migrating.`);
    throw new ResourceError('RESOURCE_NOT_READY', `Resource "${resource.name}" is ${resource.status}.`);
  }

  #throwCallUnavailable(resource: TResourceCatalogRecord): never {
    if (resource.status === 'migrating') throw new ResourceError('RESOURCE_MIGRATING', `Resource "${resource.name}" is migrating.`);
    throw new ResourceError('RESOURCE_UNAVAILABLE', `Resource "${resource.name}" is unavailable.`);
  }

  #assertOpen(): void {
    if (this.#closed) throw new ResourceError('RESOURCE_PROVIDER_UNAVAILABLE', 'Resource manager is closed.');
  }

  async #markResourceError(id: string, error: unknown, expectedStatus?: TResourceStatus): Promise<void> {
    try {
      await this.#store.catalog.updateProviderState({ id, status: 'error', expectedStatus, lastError: safeLifecycleError(error) });
    } catch {
      // Preserve the original safe provider failure if control-state persistence also fails.
    }
  }

  #track<T>(resourceId: string, operation: Promise<T>): Promise<T> {
    let calls = this.#inflight.get(resourceId);
    if (!calls) {
      calls = new Set();
      this.#inflight.set(resourceId, calls);
    }
    calls.add(operation);
    void operation.finally(() => {
      calls?.delete(operation);
      if (calls?.size === 0) this.#inflight.delete(resourceId);
    }).catch(() => undefined);
    return operation;
  }

  #trackGatewayCall<T>(operation: Promise<T>): Promise<T> {
    this.#gatewayCalls.add(operation);
    void operation.finally(() => this.#gatewayCalls.delete(operation)).catch(() => undefined);
    return operation;
  }

  #runGatewayCall<T>(operation: Promise<T>): Promise<T> {
    const tracked = this.#trackGatewayCall(operation);
    return this.#cancelOnGatewayClose(tracked);
  }

  #cancelOnGatewayClose<T>(operation: Promise<T>): Promise<T> {
    let cancel!: (error: ResourceError) => void;
    const closed = new Promise<T>((_resolve, reject) => {
      cancel = reject;
      this.#gatewayCancellations.add(cancel);
    });
    const raced = Promise.race([operation, closed]);
    void operation.catch(() => undefined);
    void raced.finally(() => this.#gatewayCancellations.delete(cancel)).catch(() => undefined);
    return raced;
  }

  #trackLifecycle<T>(operation: Promise<T>): Promise<T> {
    this.#lifecycleOperations.add(operation);
    void operation.finally(() => this.#lifecycleOperations.delete(operation)).catch(() => undefined);
    return operation;
  }

  async #drain(resourceId: string): Promise<void> {
    const calls = this.#inflight.get(resourceId);
    if (!calls || calls.size === 0) return;
    await Promise.allSettled([...calls]);
  }

}
