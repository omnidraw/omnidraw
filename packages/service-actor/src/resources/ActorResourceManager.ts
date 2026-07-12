import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type {
  TActorResource,
  TActorResourceBinding,
  TActorResourceKind,
  TActorResourceStatus,
  TDbResourceMigrationBlock,
  TJson,
} from '@vibecanvas/service-db/model';
import { ActorResourceError, toActorResourceError } from './ActorResourceError';
import type {
  IActorResourceProvider,
  TActorManifestResolver,
  TActorResourceBindingStatus,
  TActorResourceCall,
  TActorResourceProviderCreateArgs,
  TActorStartAdmission,
} from './resource-types';
import type { TActorResourceRequirement, TActorResourceScope } from '../core/types';

const RESOURCE_NAME_MAX_LENGTH = 256;
const SHUTDOWN_DRAIN_TIMEOUT_MS = 2_000;

type TActorResourceManagerConfig = {
  readonly db: DbServiceTurso;
  readonly crypto: Pick<Crypto, 'randomUUID'>;
  readonly getDefinition: TActorManifestResolver;
  readonly providers: readonly IActorResourceProvider[];
};

type TCreateResourceArgs = TActorResourceProviderCreateArgs & {
  readonly kind: TActorResourceKind;
  readonly name: string;
};

type TBindResourceArgs = {
  readonly definitionName: string;
  readonly slot: string;
  readonly resourceId: string;
  readonly scope?: TActorResourceScope;
};

function validateResourceName(name: string): string {
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > RESOURCE_NAME_MAX_LENGTH) {
    throw new ActorResourceError('RESOURCE_NOT_READY', `Resource names must be non-blank strings no longer than ${RESOURCE_NAME_MAX_LENGTH} characters.`);
  }
  return name;
}

function validateScope(scope: readonly string[], requirement: TActorResourceRequirement): TActorResourceScope {
  if (!Array.isArray(scope) || scope.length === 0 || scope.length > 2 || new Set(scope).size !== scope.length) {
    throw new ActorResourceError('RESOURCE_SCOPE_INVALID', 'Resource scope must be a non-empty duplicate-free subset of read and write.');
  }
  for (const permission of scope) {
    if ((permission !== 'read' && permission !== 'write') || !requirement.scope.includes(permission)) {
      throw new ActorResourceError('RESOURCE_SCOPE_INVALID', 'A binding may reduce but never broaden the manifest resource scope.', {
        requestedScope: [...scope],
        manifestScope: [...requirement.scope],
      });
    }
  }
  return [...scope] as TActorResourceScope;
}

function bindingScope(binding: TActorResourceBinding): TActorResourceScope {
  const scope: TActorResourceScope = [];
  if (binding.allow_read) scope.push('read');
  if (binding.allow_write) scope.push('write');
  return scope;
}

function safeLifecycleError(error: unknown): TJson {
  if (error instanceof ActorResourceError) return { code: error.code, message: error.message };
  return { code: 'RESOURCE_PROVIDER_UNAVAILABLE', message: 'Resource provider operation failed.' };
}

export class ActorResourceManager {
  readonly #db: DbServiceTurso;
  readonly #crypto: Pick<Crypto, 'randomUUID'>;
  readonly #getDefinition: TActorManifestResolver;
  readonly #providers = new Map<TActorResourceKind, IActorResourceProvider>();
  readonly #inflight = new Map<string, Set<Promise<unknown>>>();
  readonly #gatewayCalls = new Set<Promise<unknown>>();
  readonly #gatewayCancellations = new Set<(error: ActorResourceError) => void>();
  readonly #lifecycleOperations = new Set<Promise<unknown>>();
  readonly #blockedResources = new Set<string>();
  #closed = false;
  #closePromise: Promise<void> | null = null;

  constructor(config: TActorResourceManagerConfig) {
    this.#db = config.db;
    this.#crypto = config.crypto;
    this.#getDefinition = config.getDefinition;
    for (const provider of config.providers) this.registerProvider(provider);
  }

  registerProvider(provider: IActorResourceProvider): void {
    this.#assertOpen();
    if (this.#providers.has(provider.kind)) {
      throw new ActorResourceError('RESOURCE_PROVIDER_UNAVAILABLE', `A provider is already registered for resource kind "${provider.kind}".`);
    }
    this.#providers.set(provider.kind, provider);
  }

  listResources(filter: { kind?: TActorResourceKind; status?: TActorResourceStatus } = {}): Promise<TActorResource[]> {
    return this.#db.actorResource.list(filter)
      .catch((error) => { throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resources could not be listed.'); });
  }

  getResource(id: string): Promise<TActorResource | null> {
    return this.#readResource(id);
  }

  reconcileStartup(): Promise<void> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#reconcileStartup());
  }

  async #reconcileStartup(): Promise<void> {
    const resources = await this.#db.actorResource.list({})
      .catch((error) => { throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource recovery state could not be listed.'); });

    for (const resource of resources) {
      if (resource.status === 'ready') continue;
      this.#blockedResources.add(resource.id);
      try {
        const provider = this.#provider(resource.kind);
        if (resource.status === 'deleting') {
          await provider.delete(resource);
          await this.#db.actorResource.delete({ id: resource.id });
          continue;
        }

        if (!provider.reconcile) {
          if (resource.status !== 'error') {
            await this.#markResourceError(resource.id, new ActorResourceError(
              'RESOURCE_PROVIDER_UNAVAILABLE',
              'Resource recovery requires an explicit provider repair operation.',
            ));
          }
          continue;
        }

        const reconciliation = await provider.reconcile(resource);
        await this.#db.actorResource.updateProviderState({
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

  createResource(args: TCreateResourceArgs): Promise<TActorResource> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#createResource(args));
  }

  async #createResource(args: TCreateResourceArgs): Promise<TActorResource> {
    const provider = this.#provider(args.kind);
    const id = this.#crypto.randomUUID();
    try {
      await this.#db.actorResource.create({ id, kind: args.kind, name: validateResourceName(args.name), status: 'created' });
    } catch (error) {
      throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', `Failed to create ${args.kind} resource catalog entry.`);
    }
    const provisioning = await this.#db.actorResource.updateProviderState({ id, status: 'provisioning', lastError: null })
      .catch((error) => { throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', `Failed to begin ${args.kind} resource provisioning.`); });
    if (!provisioning) throw new ActorResourceError('RESOURCE_NOT_FOUND', `Resource "${id}" disappeared during provisioning.`);
    try {
      await provider.provision(provisioning, args);
      const ready = await this.#db.actorResource.updateProviderState({ id, status: 'ready', lastError: null });
      if (!ready) throw new ActorResourceError('RESOURCE_NOT_FOUND', `Resource "${id}" disappeared during provisioning.`);
      return ready;
    } catch (error) {
      await this.#markResourceError(id, error);
      throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', `Failed to provision ${args.kind} resource.`);
    }
  }

  async renameResource(args: { id: string; name: string }): Promise<TActorResource> {
    this.#assertOpen();
    const current = await this.#requireResource(args.id);
    if (current.status === 'provisioning' || current.status === 'migrating' || current.status === 'deleting') {
      throw new ActorResourceError('RESOURCE_NOT_READY', `Resource "${current.name}" cannot be renamed while ${current.status}.`);
    }
    if (this.#blockedResources.has(args.id)) {
      throw new ActorResourceError('RESOURCE_NOT_READY', `Resource "${current.name}" is busy with a lifecycle operation.`);
    }
    const resource = await this.#db.actorResource.rename({ id: args.id, name: validateResourceName(args.name) })
      .catch((error) => { throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource rename failed.'); });
    if (!resource) throw new ActorResourceError('RESOURCE_NOT_FOUND', `Resource "${args.id}" was not found.`);
    return resource;
  }

  deleteResource(id: string): Promise<void> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#deleteResource(id));
  }

  async #deleteResource(id: string): Promise<void> {
    const resource = await this.#requireResource(id);
    const references = await this.#db.actorResource.listBindingsForResource({ resourceId: id });
    if (references.length > 0) {
      throw new ActorResourceError('RESOURCE_STILL_BOUND', `Resource "${resource.name}" is still bound to ${references.length} definition slot(s).`, {
        resourceId: id,
        bindingCount: references.length,
      });
    }
    if (this.#blockedResources.has(id)) {
      throw new ActorResourceError('RESOURCE_NOT_READY', `Resource "${resource.name}" already has a lifecycle operation in progress.`);
    }
    this.#blockedResources.add(id);
    try {
      const deleting = await this.#db.actorResource.beginDelete({ id })
        .catch((error) => { throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource deletion could not begin.'); });
      if (!deleting) {
        const currentReferences = await this.#db.actorResource.listBindingsForResource({ resourceId: id });
        if (currentReferences.length > 0) {
          throw new ActorResourceError('RESOURCE_STILL_BOUND', `Resource "${resource.name}" became bound before deletion could begin.`, {
            resourceId: id,
            bindingCount: currentReferences.length,
          });
        }
        throw new ActorResourceError('RESOURCE_NOT_READY', `Resource "${resource.name}" cannot begin deletion from status "${resource.status}".`);
      }
      await this.#drain(id);
      try {
        await this.#provider(resource.kind).delete(deleting);
        const deleted = await this.#db.actorResource.delete({ id });
        if (!deleted) throw new ActorResourceError('RESOURCE_NOT_FOUND', `Resource "${id}" was not deleted.`);
      } catch (error) {
        await this.#markResourceError(id, error);
        throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', `Failed to delete ${resource.kind} resource.`);
      }
    } finally {
      this.#blockedResources.delete(id);
    }
  }

  listResourceReferences(resourceId: string): Promise<TActorResourceBinding[]> {
    return this.#db.actorResource.listBindingsForResource({ resourceId })
      .catch((error) => { throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource references could not be listed.'); });
  }

  async bindResource(args: TBindResourceArgs): Promise<TActorResourceBinding> {
    this.#assertOpen();
    const requirement = this.#requireRequirement(args.definitionName, args.slot);
    const resource = await this.#requireResource(args.resourceId);
    if (resource.status !== 'ready') this.#throwUnavailable(resource);
    if (resource.kind !== requirement.kind) {
      throw new ActorResourceError('RESOURCE_KIND_MISMATCH', `Slot "${args.slot}" requires ${requirement.kind}, not ${resource.kind}.`, {
        slot: args.slot,
        expectedKind: requirement.kind,
        actualKind: resource.kind,
      });
    }
    const scope = validateScope(args.scope ?? requirement.scope, requirement);
    const compatibility = await this.#compatibility(requirement, resource);
    if (!compatibility.compatible) {
      const code = compatibility.code === 'DB_RESOURCE_SCHEMA_MISMATCH'
        ? 'DB_RESOURCE_SCHEMA_MISMATCH'
        : compatibility.code === 'DB_RESOURCE_UNAVAILABLE'
          ? 'DB_RESOURCE_UNAVAILABLE'
          : compatibility.code === 'RESOURCE_SCHEMA_MISMATCH'
            ? 'RESOURCE_SCHEMA_MISMATCH'
            : compatibility.code === 'DB_RESOURCE_VERSION_MISMATCH'
              ? 'DB_RESOURCE_VERSION_MISMATCH'
              : 'RESOURCE_VERSION_MISMATCH';
      throw new ActorResourceError(code, compatibility.message ?? 'Resource is incompatible with this slot.');
    }
    if (this.#blockedResources.has(resource.id)) {
      throw new ActorResourceError('RESOURCE_NOT_READY', `Resource "${resource.name}" is busy with a lifecycle operation.`);
    }
    const binding = await this.#db.actorResource.upsertBinding({
      definitionName: args.definitionName,
      slotName: args.slot,
      resourceId: args.resourceId,
      allowRead: scope.includes('read'),
      allowWrite: scope.includes('write'),
    }).catch((error) => { throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource binding could not be persisted.'); });
    if (!binding) throw new ActorResourceError('RESOURCE_NOT_READY', `Resource "${resource.name}" is not ready for binding.`);
    return binding;
  }

  unbindResource(args: { definitionName: string; slot: string }): Promise<boolean> {
    this.#assertOpen();
    return this.#db.actorResource.removeBinding({ definitionName: args.definitionName, slotName: args.slot })
      .catch((error) => { throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource binding could not be removed.'); });
  }

  async getDefinitionResourceStatus(definitionName: string): Promise<TActorResourceBindingStatus[]> {
    const definition = this.#getDefinition(definitionName);
    if (!definition) throw new ActorResourceError('RESOURCE_DEFINITION_NOT_FOUND', `Actor definition "${definitionName}" was not found.`);
    const requirements = definition.actor.resources ?? {};
    const bindings = await this.#db.actorResource.listBindingsForDefinition({ definitionName })
      .catch((error) => { throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource binding status could not be read.'); });
    const bindingBySlot = new Map(bindings.map((binding) => [binding.slot_name, binding]));
    const statuses: TActorResourceBindingStatus[] = [];

    for (const [slot, requirement] of Object.entries(requirements)) {
      const binding = bindingBySlot.get(slot) ?? null;
      const resource = binding ? await this.#readResource(binding.resource_id) : null;
      const scope = binding ? bindingScope(binding) : null;
      const scopeValid = scope ? scope.every((permission) => requirement.scope.includes(permission)) : true;
      const kindMatches = resource ? resource.kind === requirement.kind : false;
      const ready = resource?.status === 'ready';
      const compatibility = resource && kindMatches ? await this.#compatibility(requirement, resource) : { compatible: false };
      const blocked = this.#statusBlock(requirement, binding, resource, scopeValid, kindMatches, compatibility);
      const actualSchemaId = resource ? compatibility.actualSchemaId ?? null : null;
      const actualVersion = resource ? compatibility.actualVersion ?? null : null;
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
        compatible: Boolean(binding && resource && scopeValid && kindMatches && ready && compatibility.compatible),
        blockedCode: blocked.code,
        blockedMessage: blocked.message,
        ...(requirement.kind === 'db' ? {
          expectedSchemaId: requirement.schema.id,
          expectedVersion: requirement.schema.version,
          actualSchemaId,
          actualVersion,
          targetVersion: resource ? compatibility.targetVersion ?? null : null,
          schemaMatches: actualSchemaId === requirement.schema.id,
          versionMatches: actualVersion === requirement.schema.version,
        } : {}),
      });
    }
    return statuses;
  }

  async getActorStartAdmission(args: {
    definitionName: string;
    actorInstanceId: string;
    restartIfCompatible: boolean;
  }): Promise<TActorStartAdmission> {
    this.#requireRequirementMap(args.definitionName);
    const migrationBlocks = await this.#db.dbResource.migrationBlock.listByInstance({ actorInstanceId: args.actorInstanceId });
    let shouldRestart = false;
    const unresolved: TDbResourceMigrationBlock[] = [];
    const resolvedBlockResourceIds: string[] = [];
    for (const block of migrationBlocks) {
      shouldRestart ||= block.restart_when_compatible;
      const compatible = block.reason !== 'migrationError'
        && await this.#isDefinitionCompatibleWithDbResource(args.definitionName, block.resource_id);
      if (compatible) {
        if (block.restart_when_compatible) {
          resolvedBlockResourceIds.push(block.resource_id);
        } else {
          await this.#db.dbResource.migrationBlock.remove({
            resourceId: block.resource_id,
            actorInstanceId: args.actorInstanceId,
          });
        }
      } else {
        unresolved.push(await this.#reclassifyDbMigrationBlock(args.definitionName, block));
      }
    }

    if (unresolved.length > 0) {
      const block = unresolved[0];
      const mismatch = block.reason === 'schemaMismatch'
        ? `expects schema ${block.expected_schema_id} but the resource provides ${block.actual_schema_id}`
        : block.reason === 'versionMismatch'
          ? `expects version ${block.expected_version} but the resource provides ${block.actual_version}`
          : block.reason === 'migrating'
            ? 'is waiting for a database resource migration to finish'
            : 'is waiting for database resource recovery';
      return {
        allowed: false,
        hadBlocks: true,
        shouldRestart,
        resolvedBlockResourceIds: [],
        code: block.reason === 'schemaMismatch' ? 'DB_RESOURCE_SCHEMA_MISMATCH'
          : block.reason === 'versionMismatch' ? 'DB_RESOURCE_VERSION_MISMATCH'
            : block.reason === 'migrating' ? 'DB_RESOURCE_MIGRATING' : 'DB_RESOURCE_RECOVERY_FAILED',
        message: `Actor definition "${args.definitionName}" ${mismatch}.`,
      };
    }

    const bindings = await this.#db.actorResource.listBindingsForDefinition({ definitionName: args.definitionName });
    for (const binding of bindings) {
      const resource = await this.#readResource(binding.resource_id);
      if (!resource || resource.kind !== 'db') continue;
      const configuration = await this.#db.dbResource.configuration.get({ resourceId: resource.id });
      const requirement = this.#requireRequirementMap(args.definitionName)[binding.slot_name];
      const lifecycleBlocked = resource.status === 'migrating' || this.#blockedResources.has(resource.id);
      const incompatible = resource.status === 'ready'
        && requirement?.kind === 'db'
        && (
          !configuration
          || configuration.applied_version !== configuration.target_version
          || configuration.schema_id !== requirement.schema.id
          || configuration.applied_version !== requirement.schema.version
        );
      if (!lifecycleBlocked && !incompatible) continue;
      if (configuration && requirement?.kind === 'db') {
        await this.#db.dbResource.migrationBlock.upsert({
          resourceId: resource.id,
          actorInstanceId: args.actorInstanceId,
          reason: lifecycleBlocked
            ? 'migrating'
            : configuration.schema_id === requirement.schema.id ? 'versionMismatch' : 'schemaMismatch',
          restartWhenCompatible: args.restartIfCompatible,
          expectedSchemaId: requirement.schema.id,
          expectedVersion: requirement.schema.version,
          actualSchemaId: configuration.schema_id,
          actualVersion: configuration.applied_version,
        });
      }
      return {
        allowed: false,
        hadBlocks: true,
        shouldRestart: args.restartIfCompatible,
        resolvedBlockResourceIds: [],
        code: lifecycleBlocked
          ? 'DB_RESOURCE_MIGRATING'
          : requirement?.kind === 'db' && configuration?.schema_id === requirement.schema.id
            ? 'DB_RESOURCE_VERSION_MISMATCH'
            : 'DB_RESOURCE_SCHEMA_MISMATCH',
        message: lifecycleBlocked
          ? `Actor definition "${args.definitionName}" is waiting for DbResource "${resource.name}" to finish migrating.`
          : `DbResource "${resource.name}" provides ${configuration?.schema_id ?? 'unknown'}@${configuration?.applied_version ?? 'unknown'}, but actor definition "${args.definitionName}" expects ${requirement?.kind === 'db' ? `${requirement.schema.id}@${requirement.schema.version}` : 'a different schema'}. Update and republish the widget definition before restarting its actors.`,
      };
    }

    return {
      allowed: true,
      hadBlocks: migrationBlocks.length > 0,
      shouldRestart,
      resolvedBlockResourceIds,
      code: null,
      message: null,
    };
  }

  async completeActorStart(args: { actorInstanceId: string; resourceIds: readonly string[] }): Promise<void> {
    for (const resourceId of new Set(args.resourceIds)) {
      await this.#db.dbResource.migrationBlock.remove({
        resourceId,
        actorInstanceId: args.actorInstanceId,
      });
    }
  }

  call(call: TActorResourceCall): Promise<unknown> {
    if (this.#closed) return Promise.reject(new ActorResourceError('RESOURCE_CALL_CANCELLED', 'Actor resource gateway is closed.'));
    return this.#trackGatewayCall(this.#cancelOnGatewayClose(this.#resolveCall(call)));
  }

  async #resolveCall(call: TActorResourceCall): Promise<unknown> {
    const requirement = this.#requireRequirement(call.definitionName, call.slot);
    if (requirement.kind !== call.kind) throw new ActorResourceError('RESOURCE_KIND_MISMATCH', `Slot "${call.slot}" is not a ${call.kind} resource.`);
    const binding = (await this.#db.actorResource.listBindingsForDefinition({ definitionName: call.definitionName }))
      .find((candidate) => candidate.slot_name === call.slot);
    if (!binding) throw new ActorResourceError('RESOURCE_NOT_BOUND', `Resource slot "${call.slot}" is not bound.`);
    return this.#track(binding.resource_id, this.#resolveBoundCall(call, requirement, binding));
  }

  async #resolveBoundCall(
    call: TActorResourceCall,
    requirement: TActorResourceRequirement,
    binding: TActorResourceBinding,
  ): Promise<unknown> {
    const resource = await this.#requireResource(binding.resource_id);
    if (resource.kind !== requirement.kind) throw new ActorResourceError('RESOURCE_KIND_MISMATCH', `Bound resource kind does not match slot "${call.slot}".`);
    if (resource.status !== 'ready' || this.#blockedResources.has(resource.id)) this.#throwCallUnavailable(resource);
    return this.#dispatchResolvedCall(call, requirement, binding, resource);
  }

  async #dispatchResolvedCall(
    call: TActorResourceCall,
    requirement: TActorResourceRequirement,
    binding: TActorResourceBinding,
    resource: TActorResource,
  ): Promise<unknown> {
    if (this.#blockedResources.has(resource.id)) this.#throwCallUnavailable(resource);
    const compatibility = await this.#compatibility(requirement, resource);
    if (!compatibility.compatible) {
      const code = compatibility.code === 'DB_RESOURCE_SCHEMA_MISMATCH'
        ? 'DB_RESOURCE_SCHEMA_MISMATCH'
        : compatibility.code === 'DB_RESOURCE_UNAVAILABLE'
          ? 'DB_RESOURCE_UNAVAILABLE'
          : compatibility.code === 'RESOURCE_SCHEMA_MISMATCH'
            ? 'RESOURCE_SCHEMA_MISMATCH'
            : compatibility.code === 'DB_RESOURCE_VERSION_MISMATCH'
              ? 'DB_RESOURCE_VERSION_MISMATCH'
              : 'RESOURCE_VERSION_MISMATCH';
      throw new ActorResourceError(code, compatibility.message ?? `Resource slot "${call.slot}" is incompatible.`);
    }
    const provider = this.#provider(resource.kind);
    const effect = provider.effect(call.operation, requirement, call.args);
    if (!effect) throw new ActorResourceError('RESOURCE_PROVIDER_UNAVAILABLE', `Unknown ${resource.kind} operation "${call.operation}".`);
    const canRead = call.functionClass !== 'fn' && requirement.scope.includes('read') && binding.allow_read;
    const canWrite = call.functionClass === 'tx' && requirement.scope.includes('write') && binding.allow_write;
    if (effect === 'read' && !canRead) throw new ActorResourceError('RESOURCE_READ_NOT_ALLOWED', `Read access is not allowed for resource slot "${call.slot}".`);
    if (effect === 'write' && !canWrite) throw new ActorResourceError('RESOURCE_WRITE_NOT_ALLOWED', `Write access is not allowed for resource slot "${call.slot}".`);

    return provider.dispatch({ resource, requirement, binding, functionClass: call.functionClass, slot: call.slot, canRead, canWrite }, call.operation, call.args);
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#closePromise = (async () => {
      const cancellation = new ActorResourceError('RESOURCE_CALL_CANCELLED', 'Actor resource gateway closed before the operation completed.');
      for (const cancel of [...this.#gatewayCancellations]) cancel(cancellation);
      await this.#settleWithin([...this.#lifecycleOperations], SHUTDOWN_DRAIN_TIMEOUT_MS);
      await this.#settleWithin([...this.#gatewayCalls], SHUTDOWN_DRAIN_TIMEOUT_MS);
      await this.#settleWithin(
        [...this.#inflight.keys()].map((resourceId) => this.#drain(resourceId)),
        SHUTDOWN_DRAIN_TIMEOUT_MS,
      );
      await this.#settleWithin(
        [...this.#providers.values()].map((provider) => provider.close?.() ?? Promise.resolve()),
        SHUTDOWN_DRAIN_TIMEOUT_MS,
      );
    })();
    return this.#closePromise;
  }

  drainResource(resourceId: string): Promise<void> {
    return this.#drain(resourceId);
  }

  coordinateResourceMigration<T>(
    resourceId: string,
    operation: (resource: TActorResource) => Promise<T>,
  ): Promise<T> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#coordinateResourceMigration(resourceId, operation));
  }

  async #coordinateResourceMigration<T>(
    resourceId: string,
    operation: (resource: TActorResource) => Promise<T>,
  ): Promise<T> {
    const resource = await this.#requireResource(resourceId);
    if (resource.kind !== 'db') {
      throw new ActorResourceError('RESOURCE_KIND_MISMATCH', `Resource "${resourceId}" is not a DbResource.`);
    }
    if (resource.status !== 'ready' || this.#blockedResources.has(resourceId)) {
      this.#throwUnavailable(resource);
    }
    this.#blockedResources.add(resourceId);
    try {
      const migrating = await this.#db.actorResource.updateProviderState({
        id: resourceId,
        status: 'migrating',
        lastError: null,
      });
      if (!migrating) {
        throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource catalog row disappeared before migration.');
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
  }

  #provider(kind: TActorResourceKind): IActorResourceProvider {
    const provider = this.#providers.get(kind);
    if (!provider) throw new ActorResourceError('RESOURCE_PROVIDER_UNAVAILABLE', `No provider is registered for resource kind "${kind}".`);
    return provider;
  }

  async #requireResource(id: string): Promise<TActorResource> {
    const resource = await this.#readResource(id);
    if (!resource) throw new ActorResourceError('RESOURCE_NOT_FOUND', `Resource "${id}" was not found.`);
    return resource;
  }

  #readResource(id: string): Promise<TActorResource | null> {
    return this.#db.actorResource.get({ id })
      .catch((error) => { throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource catalog state could not be read.'); });
  }

  #requireRequirement(definitionName: string, slot: string): TActorResourceRequirement {
    const requirement = this.#requireRequirementMap(definitionName)[slot];
    if (!requirement) throw new ActorResourceError('RESOURCE_SLOT_UNKNOWN', `Actor definition "${definitionName}" has no resource slot named "${slot}".`);
    return requirement;
  }

  #requireRequirementMap(definitionName: string): Record<string, TActorResourceRequirement> {
    const definition = this.#getDefinition(definitionName);
    if (!definition) throw new ActorResourceError('RESOURCE_DEFINITION_NOT_FOUND', `Actor definition "${definitionName}" was not found.`);
    return definition.actor.resources ?? {};
  }

  async #isDefinitionCompatibleWithDbResource(definitionName: string, resourceId: string): Promise<boolean> {
    const resource = await this.#readResource(resourceId);
    if (!resource || resource.kind !== 'db' || resource.status !== 'ready') return false;
    const configuration = await this.#db.dbResource.configuration.get({ resourceId });
    if (!configuration || configuration.applied_version !== configuration.target_version) return false;
    const bindings = (await this.#db.actorResource.listBindingsForDefinition({ definitionName }))
      .filter((binding) => binding.resource_id === resourceId);
    if (bindings.length === 0) return true;
    const requirements = this.#requireRequirementMap(definitionName);
    return bindings.every((binding) => {
      const requirement = requirements[binding.slot_name];
      return requirement?.kind === 'db'
        && requirement.schema.id === configuration.schema_id
        && requirement.schema.version === configuration.applied_version;
    });
  }

  async #reclassifyDbMigrationBlock(
    definitionName: string,
    block: TDbResourceMigrationBlock,
  ): Promise<TDbResourceMigrationBlock> {
    if (block.reason !== 'migrating') return block;
    const resource = await this.#readResource(block.resource_id);
    const configuration = await this.#db.dbResource.configuration.get({ resourceId: block.resource_id });
    if (!resource || !configuration || resource.status === 'migrating') return block;
    const bindings = (await this.#db.actorResource.listBindingsForDefinition({ definitionName }))
      .filter((binding) => binding.resource_id === block.resource_id);
    const requirements = this.#requireRequirementMap(definitionName);
    const requirement = bindings
      .map((binding) => requirements[binding.slot_name])
      .find((candidate) => candidate?.kind === 'db');
    if (!requirement || requirement.kind !== 'db') return block;
    return this.#db.dbResource.migrationBlock.upsert({
      resourceId: block.resource_id,
      actorInstanceId: block.actor_instance_id,
      reason: resource.status === 'error'
        ? 'migrationError'
        : configuration.schema_id === requirement.schema.id ? 'versionMismatch' : 'schemaMismatch',
      restartWhenCompatible: block.restart_when_compatible,
      expectedSchemaId: requirement.schema.id,
      expectedVersion: requirement.schema.version,
      actualSchemaId: configuration.schema_id,
      actualVersion: configuration.applied_version,
    });
  }

  async #compatibility(requirement: TActorResourceRequirement, resource: TActorResource) {
    const provider = this.#provider(resource.kind);
    if (provider.compatibility) {
      return provider.compatibility(requirement, resource)
        .catch((error) => { throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource compatibility could not be checked.'); });
    }
    if (requirement.kind !== 'db') return { compatible: true };
    throw new ActorResourceError(
      'RESOURCE_PROVIDER_UNAVAILABLE',
      'DbResource provider does not expose compatibility information.',
    );
  }

  #statusBlock(requirement: TActorResourceRequirement, binding: TActorResourceBinding | null, resource: TActorResource | null, scopeValid: boolean, kindMatches: boolean, compatibility: { compatible: boolean; code?: string; message?: string }): { code: string | null; message: string | null } {
    if (!binding) return { code: requirement.required ? 'RESOURCE_NOT_BOUND' : null, message: requirement.required ? 'Required resource slot is not bound.' : null };
    if (!resource) return { code: 'RESOURCE_NOT_FOUND', message: 'The bound resource no longer exists.' };
    if (!scopeValid) return { code: 'RESOURCE_SCOPE_INVALID', message: 'The binding scope broadens the manifest scope.' };
    if (!kindMatches) return { code: 'RESOURCE_KIND_MISMATCH', message: 'The bound resource kind does not match the slot.' };
    if (resource.status === 'migrating') return { code: 'RESOURCE_MIGRATING', message: 'The resource is migrating.' };
    if (resource.status !== 'ready') return { code: 'RESOURCE_NOT_READY', message: `The resource is ${resource.status}.` };
    if (!compatibility.compatible) return { code: compatibility.code ?? 'RESOURCE_VERSION_MISMATCH', message: compatibility.message ?? 'The resource is incompatible.' };
    return { code: null, message: null };
  }

  #throwUnavailable(resource: TActorResource): never {
    if (resource.status === 'migrating') throw new ActorResourceError('RESOURCE_MIGRATING', `Resource "${resource.name}" is migrating.`);
    throw new ActorResourceError('RESOURCE_NOT_READY', `Resource "${resource.name}" is ${resource.status}.`);
  }

  #throwCallUnavailable(resource: TActorResource): never {
    if (resource.status === 'migrating') throw new ActorResourceError('RESOURCE_MIGRATING', `Resource "${resource.name}" is migrating.`);
    throw new ActorResourceError('RESOURCE_UNAVAILABLE', `Resource "${resource.name}" is unavailable.`);
  }

  #assertOpen(): void {
    if (this.#closed) throw new ActorResourceError('RESOURCE_PROVIDER_UNAVAILABLE', 'Actor resource manager is closed.');
  }

  async #markResourceError(id: string, error: unknown): Promise<void> {
    try {
      await this.#db.actorResource.updateProviderState({ id, status: 'error', lastError: safeLifecycleError(error) });
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

  #cancelOnGatewayClose<T>(operation: Promise<T>): Promise<T> {
    let cancel!: (error: ActorResourceError) => void;
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

  async #settleWithin(operations: readonly Promise<unknown>[], timeoutMs: number): Promise<void> {
    if (operations.length === 0) return;
    const settled = Promise.allSettled(operations);
    await Promise.race([
      settled,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
}

export type { TBindResourceArgs, TCreateResourceArgs };
