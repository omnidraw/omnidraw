/**
 * @file Local resource catalog, gateway, lifecycle, and consumer-use coordination.
 *
 * The manager deliberately depends on structural stores and requirement resolvers.
 * Host packages adapt their persistence models and legacy consumers at the edge.
 */

import { ResourceError, toResourceError } from '../ResourceError';
import type {
  TResourceBinding,
  TResourceJson,
  TResourceKind,
  TResourcePermission,
  TResourceRequirement,
  TResourceStatus,
} from '../types';
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
  }>>>;
}>;

export type TResourceCatalogRecord = Readonly<{
  id: string;
  kind: TResourceKind;
  name: string;
  status: TResourceStatus;
  last_error: TResourceJson | null;
  created_at: string;
  updated_at: string;
}>;

export type TResourceBindingRecord = Readonly<{
  definition_name: string;
  slot_name: string;
  resource_id: string;
  allow_read: boolean;
  allow_write: boolean;
  created_at: string;
  updated_at: string;
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

export type TResourceBindingStatus = Readonly<{
  slot: string;
  requirement: TManagedResourceRequirement;
  bound: boolean;
  resource: TResourceCatalogRecord | null;
  requestedScope: TResourceScope;
  bindingScope: TResourceScope | null;
  scopeValid: boolean;
  kindMatches: boolean;
  ready: boolean;
  blockedCode: string | null;
  blockedMessage: string | null;
}>;

export type TConsumerStartAdmission = Readonly<{
  allowed: boolean;
  hadBlocks: boolean;
  shouldRestart: boolean;
  resolvedBlockResourceIds: readonly string[];
  code: string | null;
  message: string | null;
}>;

export type TResourceRequirementsResolver = (
  definitionName: string,
) => Readonly<Record<string, TManagedResourceRequirement>> | null;

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
      lastError: TResourceJson | null;
    }>): Promise<TResourceCatalogRecord | null>;
    beginDelete(args: Readonly<{ id: string }>): Promise<TResourceCatalogRecord | null>;
    delete(args: Readonly<{ id: string }>): Promise<boolean>;
    listBindingsForResource(args: Readonly<{ resourceId: string }>): Promise<readonly TResourceBindingRecord[]>;
    listBindingsForDefinition(args: Readonly<{ definitionName: string }>): Promise<readonly TResourceBindingRecord[]>;
    upsertBinding(args: Readonly<{
      definitionName: string;
      slotName: string;
      resourceId: string;
      allowRead: boolean;
      allowWrite: boolean;
    }>): Promise<TResourceBindingRecord | null>;
    removeBinding(args: Readonly<{ definitionName: string; slotName: string }>): Promise<boolean>;
    replaceBindings(args: Readonly<{
      definitionName: string;
      expectedBindings?: readonly Readonly<{
        slotName: string;
        resourceId: string;
        allowRead: boolean;
        allowWrite: boolean;
      }>[];
      bindings: readonly Readonly<{
        slotName: string;
        resourceId: string;
        allowRead: boolean;
        allowWrite: boolean;
      }>[];
    }>): Promise<readonly TResourceBindingRecord[]>;
  }>;
  migration: Readonly<{
    hasActiveWork(resourceId: string): Promise<boolean>;
  }>;
  consumerRecovery?: Readonly<{
    listResults(consumerId: string): Promise<readonly Readonly<{
      migrationId: string;
      consumerId: string;
      definitionName: string;
      wasRunning: boolean;
      status: string;
    }>[]>;
    getMigration(migrationId: string): Promise<Readonly<{ resourceId: string }> | null>;
    markRestarted(result: Readonly<{
      migrationId: string;
      consumerId: string;
      definitionName: string;
    }>): Promise<void>;
  }>;
}>;

export type TResourceManagerConfig = Readonly<{
  readonly store: IResourceManagerStore;
  readonly crypto: Pick<Crypto, 'randomUUID'>;
  readonly resolveRequirements: TResourceRequirementsResolver;
  readonly providers: readonly ILocalResourceProvider[];
  /** The Resource Store owns provider shutdown in split manager/store composition. */
  readonly closeProviders?: boolean;
}>;

export type TCreateResourceArgs = Readonly<{
  readonly kind: TResourceKind;
  readonly name: string;
}>;

export type TBindResourceArgs = Readonly<{
  readonly definitionName: string;
  readonly slot: string;
  readonly resourceId: string;
  readonly scope?: TResourceScope;
}>;

export type TReplaceResourceBindingsArgs = Readonly<{
  readonly definitionName: string;
  readonly expectedBindings?: readonly {
    readonly slot: string;
    readonly resourceId: string;
    readonly scope: TResourceScope;
  }[];
  readonly bindings: readonly {
    readonly slot: string;
    readonly resourceId: string;
    readonly scope: TResourceScope;
  }[];
}>;

type TConsumerStartReservation = {
  readonly admission: TConsumerStartAdmission;
  readonly definitionName: string;
  readonly release: () => void;
  readonly settled: Promise<void>;
};

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

function bindingSetMatches(
  current: readonly TResourceBindingRecord[],
  expected: NonNullable<TReplaceResourceBindingsArgs['expectedBindings']>,
): boolean {
  const sorted = [...expected].sort((left, right) => left.slot.localeCompare(right.slot, 'en-US'));
  return current.length === sorted.length && current.every((binding, index) => {
    const candidate = sorted[index];
    return candidate !== undefined
      && binding.slot_name === candidate.slot
      && binding.resource_id === candidate.resourceId
      && binding.allow_read === candidate.scope.includes('read')
      && binding.allow_write === candidate.scope.includes('write');
  });
}

function bindingScope(binding: TResourceBindingRecord): TResourceScope {
  const scope: TResourceScope = [];
  if (binding.allow_read) scope.push('read');
  if (binding.allow_write) scope.push('write');
  return scope;
}

function safeLifecycleError(error: unknown): TResourceJson {
  if (error instanceof ResourceError) return { code: error.code, message: error.message };
  return { code: 'RESOURCE_PROVIDER_UNAVAILABLE', message: 'Resource provider operation failed.' };
}

export class ResourceManager {
  readonly #store: IResourceManagerStore;
  readonly #crypto: Pick<Crypto, 'randomUUID'>;
  readonly #resolveRequirements: TResourceRequirementsResolver;
  readonly #closeProviders: boolean;
  readonly #providers = new Map<TResourceKind, ILocalResourceProvider>();
  readonly #inflight = new Map<string, Set<Promise<unknown>>>();
  readonly #gatewayCalls = new Set<Promise<unknown>>();
  readonly #gatewayCancellations = new Set<(error: ResourceError) => void>();
  readonly #lifecycleOperations = new Set<Promise<unknown>>();
  readonly #blockedResources = new Set<string>();
  readonly #resourceGateTails = new Map<string, Promise<void>>();
  readonly #definitionGateTails = new Map<string, Promise<void>>();
  readonly #consumerStartAdmissionGateTails = new Map<string, Promise<void>>();
  readonly #consumerStartReservations = new Map<string, TConsumerStartReservation>();
  readonly #definitionStartLeases = new Map<string, Set<Promise<void>>>();
  readonly #bindingIntents = new Map<string, Set<Promise<void>>>();
  #closed = false;
  #closePromise: Promise<void> | null = null;

  constructor(config: TResourceManagerConfig) {
    this.#store = config.store;
    this.#crypto = config.crypto;
    this.#resolveRequirements = config.resolveRequirements;
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
        `Resource name '${normalized.name}' matches multiple legacy resources and must be repaired by the host.`,
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
    await this.#drainBindingIntents(id);
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
        const references = await this.#store.catalog.listBindingsForResource({ resourceId: id });
        if (references.length > 0) {
          throw new ResourceError('RESOURCE_STILL_BOUND', `Resource "${resource.name}" is still bound to ${references.length} definition slot(s).`, {
            resourceId: id,
            bindingCount: references.length,
          });
        }
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

  listResourceReferences(resourceId: string): Promise<readonly TResourceBindingRecord[]> {
    return this.#store.catalog.listBindingsForResource({ resourceId })
      .catch((error) => { throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource references could not be listed.'); });
  }

  listResourceBindingsForDefinition(definitionName: string): Promise<readonly TResourceBindingRecord[]> {
    return this.#store.catalog.listBindingsForDefinition({ definitionName })
      .catch((error) => { throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Definition resource bindings could not be listed.'); });
  }

  async bindResource(args: TBindResourceArgs): Promise<TResourceBindingRecord> {
    this.#assertOpen();
    const releaseIntent = this.#registerBindingIntent(args.resourceId);
    try {
      return await this.#trackLifecycle(this.#withDefinitionGate(args.definitionName, async () => {
        await this.#drainDefinitionStarts(args.definitionName);
        this.#assertOpen();
        const requirement = this.#requireRequirement(args.definitionName, args.slot);
        const existing = (await this.#store.catalog.listBindingsForDefinition({ definitionName: args.definitionName }))
          .find((binding) => binding.slot_name === args.slot);
        const resourceIds = existing ? [existing.resource_id, args.resourceId] : [args.resourceId];
        return this.#withResourceGates(resourceIds, async () => {
          const resource = await this.#requireResource(args.resourceId);
          if (resource.status !== 'ready') this.#throwUnavailable(resource);
          if (resource.kind !== requirement.kind) {
            throw new ResourceError('RESOURCE_KIND_MISMATCH', `Slot "${args.slot}" requires ${requirement.kind}, not ${resource.kind}.`, {
              slot: args.slot,
              expectedKind: requirement.kind,
              actualKind: resource.kind,
            });
          }
          const scope = validateScope(args.scope ?? requirement.scope, requirement);
          for (const resourceId of resourceIds) {
            if (this.#blockedResources.has(resourceId)) {
              throw new ResourceError('RESOURCE_NOT_READY', `Resource "${resource.name}" is busy with a lifecycle operation.`);
            }
          }
          const binding = await this.#store.catalog.upsertBinding({
            definitionName: args.definitionName,
            slotName: args.slot,
            resourceId: args.resourceId,
            allowRead: scope.includes('read'),
            allowWrite: scope.includes('write'),
          }).catch((error) => { throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource binding could not be persisted.'); });
          if (!binding) throw new ResourceError('RESOURCE_NOT_READY', `Resource "${resource.name}" is not ready for binding.`);
          return binding;
        });
      }));
    } finally {
      releaseIntent();
    }
  }

  async unbindResource(args: { definitionName: string; slot: string }): Promise<boolean> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#withDefinitionGate(args.definitionName, async () => {
      await this.#drainDefinitionStarts(args.definitionName);
      this.#assertOpen();
      const existing = (await this.#store.catalog.listBindingsForDefinition({ definitionName: args.definitionName }))
        .find((binding) => binding.slot_name === args.slot);
      if (!existing) return false;
      return this.#withResourceGate(existing.resource_id, async () => {
        if (this.#blockedResources.has(existing.resource_id)) {
          throw new ResourceError('RESOURCE_NOT_READY', 'Resource is busy with a lifecycle operation.');
        }
        return this.#store.catalog.removeBinding({ definitionName: args.definitionName, slotName: args.slot })
          .catch((error) => { throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource binding could not be removed.'); });
      });
    }));
  }

  async replaceResourceBindings(args: TReplaceResourceBindingsArgs): Promise<readonly TResourceBindingRecord[]> {
    return this.#replaceResourceBindings(args, async () => undefined);
  }

  async transitionResourceBindings(
    args: TReplaceResourceBindingsArgs,
    beforeReplace: () => Promise<void>,
  ): Promise<readonly TResourceBindingRecord[]> {
    return this.#replaceResourceBindings(args, beforeReplace);
  }

  async #replaceResourceBindings(
    args: TReplaceResourceBindingsArgs,
    beforeReplace: () => Promise<void>,
  ): Promise<readonly TResourceBindingRecord[]> {
    this.#assertOpen();
    if (new Set(args.bindings.map((binding) => binding.slot)).size !== args.bindings.length) {
      throw new ResourceError('RESOURCE_SCOPE_INVALID', 'Resource binding slots must be unique.');
    }
    if (args.expectedBindings && new Set(args.expectedBindings.map((binding) => binding.slot)).size !== args.expectedBindings.length) {
      throw new ResourceError('RESOURCE_SCOPE_INVALID', 'Expected resource binding slots must be unique.');
    }
    const involvedResourceIds = [...new Set([
      ...args.bindings.map((binding) => binding.resourceId),
      ...(args.expectedBindings?.map((binding) => binding.resourceId) ?? []),
    ])];
    const releaseIntents = involvedResourceIds.map((resourceId) => this.#registerBindingIntent(resourceId));
    try {
      return await this.#trackLifecycle(this.#withDefinitionGate(args.definitionName, async () => {
        await this.#drainDefinitionStarts(args.definitionName);
        this.#assertOpen();
        const existing = await this.#store.catalog.listBindingsForDefinition({ definitionName: args.definitionName });
        if (args.expectedBindings && !bindingSetMatches(existing, args.expectedBindings)) {
          throw new ResourceError(
            'RESOURCE_BINDING_CONFLICT',
            `Resource bindings for definition '${args.definitionName}' changed concurrently.`,
          );
        }
        const resourceIds = [...new Set([
          ...existing.map((binding) => binding.resource_id),
          ...involvedResourceIds,
        ])];
        return this.#withResourceGates(resourceIds, async () => {
          await beforeReplace();
          const validated: {
            slotName: string;
            resourceId: string;
            allowRead: boolean;
            allowWrite: boolean;
          }[] = [];
          for (const binding of args.bindings) {
            const requirement = this.#requireRequirement(args.definitionName, binding.slot);
            const resource = await this.#requireResource(binding.resourceId);
            if (resource.status !== 'ready' || this.#blockedResources.has(resource.id)) this.#throwUnavailable(resource);
            if (resource.kind !== requirement.kind) {
              throw new ResourceError('RESOURCE_KIND_MISMATCH', `Slot "${binding.slot}" requires ${requirement.kind}, not ${resource.kind}.`, {
                slot: binding.slot,
                expectedKind: requirement.kind,
                actualKind: resource.kind,
              });
            }
            const scope = validateScope(binding.scope, requirement);
            validated.push({
              slotName: binding.slot,
              resourceId: binding.resourceId,
              allowRead: scope.includes('read'),
              allowWrite: scope.includes('write'),
            });
          }
          for (const resourceId of resourceIds) {
            if (this.#blockedResources.has(resourceId)) {
              throw new ResourceError('RESOURCE_NOT_READY', `Resource '${resourceId}' is busy with a lifecycle operation.`);
            }
          }
          return this.#store.catalog.replaceBindings({
            definitionName: args.definitionName,
            expectedBindings: args.expectedBindings?.map((binding) => ({
              slotName: binding.slot,
              resourceId: binding.resourceId,
              allowRead: binding.scope.includes('read'),
              allowWrite: binding.scope.includes('write'),
            })),
            bindings: validated,
          }).catch((error) => {
            throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource bindings could not be replaced.');
          });
        });
      }));
    } finally {
      for (const release of releaseIntents) release();
    }
  }

  async getDefinitionResourceStatus(definitionName: string): Promise<TResourceBindingStatus[]> {
    const requirements = this.#resolveRequirements(definitionName);
    if (!requirements) throw new ResourceError('RESOURCE_DEFINITION_NOT_FOUND', `Resource definition "${definitionName}" was not found.`);
    const bindings = await this.#store.catalog.listBindingsForDefinition({ definitionName })
      .catch((error) => { throw toResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource binding status could not be read.'); });
    const bindingBySlot = new Map(bindings.map((binding) => [binding.slot_name, binding]));
    const statuses: TResourceBindingStatus[] = [];

    for (const [slot, requirement] of Object.entries(requirements)) {
      const binding = bindingBySlot.get(slot) ?? null;
      const resource = binding ? await this.#readResource(binding.resource_id) : null;
      const scope = binding ? bindingScope(binding) : null;
      const scopeValid = scope ? scope.every((permission) => requirement.scope.includes(permission)) : true;
      const kindMatches = resource ? resource.kind === requirement.kind : false;
      const ready = resource?.status === 'ready';
      const blocked = this.#statusBlock(requirement, binding, resource, scopeValid, kindMatches);
      statuses.push({
        slot,
        requirement,
        bound: binding !== null,
        resource,
        requestedScope: requirement.scope,
        bindingScope: scope,
        scopeValid,
        kindMatches,
        ready,
        blockedCode: blocked.code,
        blockedMessage: blocked.message,
      });
    }
    return statuses;
  }

  getConsumerStartAdmission(args: {
    definitionName: string;
    consumerId: string;
    restartIfCompatible: boolean;
  }): Promise<TConsumerStartAdmission> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#withConsumerStartAdmissionGate(args.consumerId, async () => {
      const existingReservation = this.#consumerStartReservations.get(args.consumerId);
      if (existingReservation) {
        await existingReservation.settled;
        this.#assertOpen();
      }
      return this.#withDefinitionGate(args.definitionName, async () => {
        const requirements = this.#requireRequirementMap(args.definitionName);
        const bindings = await this.#store.catalog.listBindingsForDefinition({ definitionName: args.definitionName });
        const bindingBySlot = new Map(bindings.map((binding) => [binding.slot_name, binding]));
        const resourceIds = [...new Set(bindings.map((binding) => binding.resource_id))].sort();
        return this.#withResourceGates(resourceIds, async () => {
          const admittedResourceIds: string[] = [];
          const admittedDbResourceIds: string[] = [];
          for (const [slot, requirement] of Object.entries(requirements)) {
            const binding = bindingBySlot.get(slot);
            if (!binding) {
              if (!requirement.required) continue;
              return this.#blockedStartAdmission(args, {
                code: this.#notBoundCode(requirement.kind),
                message: `Required ${requirement.kind} resource slot "${slot}" is not bound for resource definition "${args.definitionName}".`,
                lifecycleBlocked: false,
              });
            }
            const resource = await this.#readResource(binding.resource_id);
            if (!resource) {
              return this.#blockedStartAdmission(args, {
                code: 'RESOURCE_NOT_FOUND',
                message: `Resource slot "${slot}" is bound to missing resource "${binding.resource_id}".`,
                lifecycleBlocked: false,
              });
            }
            const scope = bindingScope(binding);
            if (!scope.every((permission) => requirement.scope.includes(permission))) {
              return this.#blockedStartAdmission(args, {
                code: 'RESOURCE_SCOPE_INVALID',
                message: `Resource slot "${slot}" has a binding scope that exceeds its manifest scope.`,
                lifecycleBlocked: false,
              });
            }
            if (resource.kind !== requirement.kind) {
              return this.#blockedStartAdmission(args, {
                code: 'RESOURCE_KIND_MISMATCH',
                message: `Resource slot "${slot}" requires ${requirement.kind}, but "${resource.name}" is ${resource.kind}.`,
                lifecycleBlocked: false,
              });
            }
            admittedResourceIds.push(resource.id);
            if (resource.kind === 'db') admittedDbResourceIds.push(resource.id);
            const lifecycleBlocked = resource.status === 'migrating' || this.#blockedResources.has(resource.id);
            if (lifecycleBlocked || resource.status !== 'ready') {
              return this.#blockedStartAdmission(args, {
                code: resource.status === 'migrating'
                  ? (resource.kind === 'db' ? 'DB_RESOURCE_MIGRATING' : 'RESOURCE_MIGRATING')
                  : this.#unavailableCode(resource.kind),
                message: lifecycleBlocked
                  ? `Resource definition "${args.definitionName}" is waiting for ${resource.kind} resource "${resource.name}" to finish a lifecycle operation.`
                  : `${resource.kind} resource "${resource.name}" bound to slot "${slot}" is ${resource.status}.`,
                lifecycleBlocked,
              });
            }
          }

          const interrupted = await this.#resolvedConsumerMigrationBlocks(args.consumerId, admittedDbResourceIds);
          const admission: TConsumerStartAdmission = {
            allowed: true,
            hadBlocks: interrupted.length > 0,
            shouldRestart: args.restartIfCompatible || interrupted.length > 0,
            resolvedBlockResourceIds: interrupted,
            code: null,
            message: null,
          };
          this.#reserveConsumerStart(args.consumerId, args.definitionName, admittedResourceIds, admission);
          return admission;
        });
      });
    }));
  }

  async completeConsumerStart(args: {
    consumerId: string;
    resourceIds: readonly string[];
    succeeded: boolean;
  }): Promise<void> {
    const reservation = this.#consumerStartReservations.get(args.consumerId);
    if (reservation) {
      this.#consumerStartReservations.delete(args.consumerId);
      reservation.release();
    }
    if (this.#closed && !reservation) return;
    if (!args.succeeded) return;
    const resolved = new Set(args.resourceIds);
    if (resolved.size === 0) return;
    const handledResources = new Set<string>();
    const recovery = this.#store.consumerRecovery;
    if (!recovery) return;
    const results = await recovery.listResults(args.consumerId);
    for (const result of results) {
      const migration = await recovery.getMigration(result.migrationId);
      if (!migration || !resolved.has(migration.resourceId) || handledResources.has(migration.resourceId)) continue;
      handledResources.add(migration.resourceId);
      if (!result.wasRunning || result.status === 'restarted' || result.status === 'notRunning') continue;
      await recovery.markRestarted({
        migrationId: result.migrationId,
        consumerId: result.consumerId,
        definitionName: result.definitionName,
      });
    }
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

  call(call: TResourceManagerCall): Promise<unknown> {
    if (this.#closed) return Promise.reject(new ResourceError('RESOURCE_CALL_CANCELLED', 'Resource gateway is closed.'));
    return this.#runGatewayCall(this.#resolveCall(call));
  }

  /**
   * Resolves legacy consumer metadata into the exact host-owned authorization
   * snapshot consumed by ResourceGateway and ResourceStoreService.
   */
  resolveGatewayCall(
    call: TResourceManagerCall,
    direct?: TResourceDirectBinding,
  ): Promise<TResourceGatewayAuthorization> {
    if (this.#closed) {
      return Promise.reject(new ResourceError('RESOURCE_CALL_CANCELLED', 'Resource gateway is closed.'));
    }
    return this.#runGatewayCall(this.#resolveGatewayAuthorization(call, direct));
  }

  async #resolveGatewayAuthorization(
    call: TResourceManagerCall,
    direct?: TResourceDirectBinding,
  ): Promise<TResourceGatewayAuthorization> {
    const requirement = direct?.requirement ?? this.#requireRequirement(call.definitionName, call.slot);
    if (requirement.kind !== call.kind) {
      throw new ResourceError('RESOURCE_KIND_MISMATCH', `Slot "${call.slot}" is not a ${call.kind} resource.`);
    }

    let binding: TResourceBindingRecord;
    if (direct) {
      const scope = validateScope(direct.scope, requirement);
      binding = {
        definition_name: call.definitionName,
        slot_name: call.slot,
        resource_id: direct.resourceId,
        allow_read: scope.includes('read'),
        allow_write: scope.includes('write'),
        created_at: '',
        updated_at: '',
      };
    } else {
      const stored = (await this.#store.catalog.listBindingsForDefinition({
        definitionName: call.definitionName,
      })).find((candidate) => candidate.slot_name === call.slot);
      if (!stored) {
        throw new ResourceError('RESOURCE_NOT_BOUND', `Resource slot "${call.slot}" is not bound.`);
      }
      binding = stored;
    }

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
      && binding.allow_read;
    const canWrite = call.functionClass === 'tx'
      && requirement.scope.includes('write')
      && binding.allow_write;
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
      const binding: TResourceBindingRecord = {
        definition_name: call.definitionName,
        slot_name: call.slot,
        resource_id: direct.resourceId,
        allow_read: scope.includes('read'),
        allow_write: scope.includes('write'),
        created_at: '',
        updated_at: '',
      };
      return this.#track(direct.resourceId, this.#resolveBoundCall(call, direct.requirement, binding));
    })();
    return this.#runGatewayCall(resolving);
  }

  async #resolveCall(call: TResourceManagerCall): Promise<unknown> {
    const requirement = this.#requireRequirement(call.definitionName, call.slot);
    if (requirement.kind !== call.kind) throw new ResourceError('RESOURCE_KIND_MISMATCH', `Slot "${call.slot}" is not a ${call.kind} resource.`);
    const binding = (await this.#store.catalog.listBindingsForDefinition({ definitionName: call.definitionName }))
      .find((candidate) => candidate.slot_name === call.slot);
    if (!binding) throw new ResourceError('RESOURCE_NOT_BOUND', `Resource slot "${call.slot}" is not bound.`);
    return this.#track(binding.resource_id, this.#resolveBoundCall(call, requirement, binding));
  }

  async #resolveBoundCall(
    call: TResourceManagerCall,
    requirement: TManagedResourceRequirement,
    binding: TResourceBindingRecord,
  ): Promise<unknown> {
    const resource = await this.#requireResource(binding.resource_id);
    if (resource.kind !== requirement.kind) throw new ResourceError('RESOURCE_KIND_MISMATCH', `Bound resource kind does not match slot "${call.slot}".`);
    if (resource.status !== 'ready' || this.#blockedResources.has(resource.id)) this.#throwCallUnavailable(resource);
    return this.#dispatchResolvedCall(call, requirement, binding, resource);
  }

  async #dispatchResolvedCall(
    call: TResourceManagerCall,
    requirement: TManagedResourceRequirement,
    binding: TResourceBindingRecord,
    resource: TResourceCatalogRecord,
  ): Promise<unknown> {
    if (this.#blockedResources.has(resource.id)) this.#throwCallUnavailable(resource);
    const provider = this.#provider(resource.kind);
    const effect = provider.effect(call.operation, requirement, call.args);
    if (!effect) throw new ResourceError('RESOURCE_PROVIDER_UNAVAILABLE', `Unknown ${resource.kind} operation "${call.operation}".`);
    const canRead = call.functionClass !== 'fn' && requirement.scope.includes('read') && binding.allow_read;
    const canWrite = call.functionClass === 'tx' && requirement.scope.includes('write') && binding.allow_write;
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
      await Promise.allSettled(
        [...this.#consumerStartReservations.values()].map((reservation) => reservation.settled),
      );
      for (const reservation of this.#consumerStartReservations.values()) reservation.release();
      this.#consumerStartReservations.clear();
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

  async #coordinateResourceMigration<T>(
    resourceId: string,
    operation: (resource: TResourceCatalogRecord) => Promise<T>,
  ): Promise<T> {
    await this.#drainBindingIntents(resourceId);
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
          return await operation(migrating);
        } catch (error) {
          const current = await this.#readResource(resourceId).catch(() => null);
          if (current?.status === 'migrating') await this.#markResourceError(resourceId, error);
          throw error;
        }
      } finally {
        this.#blockedResources.delete(resourceId);
      }
    });
  }

  async #resolvedConsumerMigrationBlocks(consumerId: string, resourceIds: readonly string[]): Promise<string[]> {
    if (resourceIds.length === 0) return [];
    const recovery = this.#store.consumerRecovery;
    if (!recovery) return [];
    const resourceIdSet = new Set(resourceIds);
    const resolved = new Set<string>();
    const handledResources = new Set<string>();
    const results = await recovery.listResults(consumerId);
    for (const result of results) {
      const migration = await recovery.getMigration(result.migrationId);
      if (!migration || !resourceIdSet.has(migration.resourceId) || handledResources.has(migration.resourceId)) continue;
      handledResources.add(migration.resourceId);
      if (result.wasRunning && result.status !== 'restarted' && result.status !== 'notRunning') {
        resolved.add(migration.resourceId);
      }
    }
    return [...resolved].sort();
  }

  #reserveConsumerStart(
    consumerId: string,
    definitionName: string,
    resourceIds: readonly string[],
    admission: TConsumerStartAdmission,
  ): void {
    if (this.#consumerStartReservations.has(consumerId)) return;
    const releases: (() => void)[] = [];
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => { settle = resolve; });
    let released = false;
    for (const resourceId of [...new Set(resourceIds)]) {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      this.#track(resourceId, pending);
      releases.push(release);
    }
    this.#consumerStartReservations.set(consumerId, {
      admission,
      definitionName,
      settled,
      release: () => {
        if (released) return;
        released = true;
        for (const release of releases) release();
        settle();
      },
    });
    let definitionLeases = this.#definitionStartLeases.get(definitionName);
    if (!definitionLeases) {
      definitionLeases = new Set();
      this.#definitionStartLeases.set(definitionName, definitionLeases);
    }
    definitionLeases.add(settled);
    void settled.finally(() => {
      definitionLeases?.delete(settled);
      if (definitionLeases?.size === 0) this.#definitionStartLeases.delete(definitionName);
    });
  }

  async #drainDefinitionStarts(definitionName: string): Promise<void> {
    const leases = this.#definitionStartLeases.get(definitionName);
    if (!leases || leases.size === 0) return;
    await Promise.all([...leases]);
  }

  #registerBindingIntent(resourceId: string): () => void {
    let settle!: () => void;
    const intent = new Promise<void>((resolve) => { settle = resolve; });
    let intents = this.#bindingIntents.get(resourceId);
    if (!intents) {
      intents = new Set();
      this.#bindingIntents.set(resourceId, intents);
    }
    intents.add(intent);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      intents?.delete(intent);
      if (intents?.size === 0) this.#bindingIntents.delete(resourceId);
      settle();
    };
  }

  async #drainBindingIntents(resourceId: string): Promise<void> {
    const intents = this.#bindingIntents.get(resourceId);
    if (!intents || intents.size === 0) return;
    await Promise.all([...intents]);
  }

  #withResourceGates<T>(resourceIds: readonly string[], operation: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(resourceIds)].sort();
    const enter = (index: number): Promise<T> => index === ordered.length
      ? operation()
      : this.#withResourceGate(ordered[index]!, () => enter(index + 1));
    return enter(0);
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

  async #withDefinitionGate<T>(definitionName: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#definitionGateTails.get(definitionName) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    this.#definitionGateTails.set(definitionName, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.#definitionGateTails.get(definitionName) === tail) {
        void tail.finally(() => {
          if (this.#definitionGateTails.get(definitionName) === tail) this.#definitionGateTails.delete(definitionName);
        });
      }
    }
  }

  async #withConsumerStartAdmissionGate<T>(consumerId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#consumerStartAdmissionGateTails.get(consumerId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    this.#consumerStartAdmissionGateTails.set(consumerId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.#consumerStartAdmissionGateTails.get(consumerId) === tail) {
        void tail.finally(() => {
          if (this.#consumerStartAdmissionGateTails.get(consumerId) === tail) this.#consumerStartAdmissionGateTails.delete(consumerId);
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

  #requireRequirement(definitionName: string, slot: string): TManagedResourceRequirement {
    const requirement = this.#requireRequirementMap(definitionName)[slot];
    if (!requirement) throw new ResourceError('RESOURCE_SLOT_UNKNOWN', `Resource definition "${definitionName}" has no resource slot named "${slot}".`);
    return requirement;
  }

  #requireRequirementMap(definitionName: string): Readonly<Record<string, TManagedResourceRequirement>> {
    const requirements = this.#resolveRequirements(definitionName);
    if (!requirements) throw new ResourceError('RESOURCE_DEFINITION_NOT_FOUND', `Resource definition "${definitionName}" was not found.`);
    return requirements;
  }

  #statusBlock(requirement: TManagedResourceRequirement, binding: TResourceBindingRecord | null, resource: TResourceCatalogRecord | null, scopeValid: boolean, kindMatches: boolean): { code: string | null; message: string | null } {
    if (!binding) return { code: requirement.required ? 'RESOURCE_NOT_BOUND' : null, message: requirement.required ? 'Required resource slot is not bound.' : null };
    if (!resource) return { code: 'RESOURCE_NOT_FOUND', message: 'The bound resource no longer exists.' };
    if (!scopeValid) return { code: 'RESOURCE_SCOPE_INVALID', message: 'The binding scope broadens the manifest scope.' };
    if (!kindMatches) return { code: 'RESOURCE_KIND_MISMATCH', message: 'The bound resource kind does not match the slot.' };
    if (resource.status === 'migrating') return { code: 'RESOURCE_MIGRATING', message: 'The resource is migrating.' };
    if (resource.status !== 'ready') return { code: 'RESOURCE_NOT_READY', message: `The resource is ${resource.status}.` };
    return { code: null, message: null };
  }

  #blockedStartAdmission(
    args: { readonly restartIfCompatible: boolean },
    blocked: { readonly code: string; readonly message: string; readonly lifecycleBlocked: boolean },
  ): TConsumerStartAdmission {
    return {
      allowed: false,
      hadBlocks: blocked.lifecycleBlocked,
      shouldRestart: args.restartIfCompatible,
      resolvedBlockResourceIds: [],
      code: blocked.code,
      message: blocked.message,
    };
  }

  #notBoundCode(kind: TResourceKind): string {
    if (kind === 'db') return 'DB_RESOURCE_NOT_BOUND';
    if (kind === 'kv') return 'KV_RESOURCE_NOT_BOUND';
    return 'SECRET_STORE_NOT_BOUND';
  }

  #unavailableCode(kind: TResourceKind): string {
    if (kind === 'db') return 'DB_RESOURCE_UNAVAILABLE';
    if (kind === 'kv') return 'KV_RESOURCE_UNAVAILABLE';
    return 'SECRET_STORE_UNAVAILABLE';
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

  async #markResourceError(id: string, error: unknown): Promise<void> {
    try {
      await this.#store.catalog.updateProviderState({ id, status: 'error', lastError: safeLifecycleError(error) });
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
