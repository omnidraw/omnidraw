import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type {
  TActorResource,
  TActorResourceBinding,
  TActorResourceKind,
  TActorResourceStatus,
  TJson,
} from '@vibecanvas/service-db/model';
import { ActorResourceError, toActorResourceError } from './ActorResourceError';
import type {
  IActorResourceProvider,
  TActorManifestResolver,
  TActorResourceBindingStatus,
  TActorResourceCall,
  TActorResourceDirectBinding,
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

type TActorStartReservation = {
  readonly admission: TActorStartAdmission;
  readonly definitionName: string;
  readonly release: () => void;
  readonly settled: Promise<void>;
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
  readonly #resourceGateTails = new Map<string, Promise<void>>();
  readonly #definitionGateTails = new Map<string, Promise<void>>();
  readonly #actorStartAdmissionGateTails = new Map<string, Promise<void>>();
  readonly #actorStartReservations = new Map<string, TActorStartReservation>();
  readonly #definitionStartLeases = new Map<string, Set<Promise<void>>>();
  readonly #bindingIntents = new Map<string, Set<Promise<void>>>();
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
      const provider = this.#provider(resource.kind);
      if (resource.status === 'ready' && !provider.reconcileReady) continue;
      if (resource.kind === 'db' && resource.status === 'migrating') continue;
      this.#blockedResources.add(resource.id);
      try {
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
    return this.#trackLifecycle(this.#withResourceGate(args.id, async () => {
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
        throw new ActorResourceError('RESOURCE_NOT_READY', `Resource "${resource.name}" already has a lifecycle operation in progress.`);
      }
      if (resource.kind === 'db') {
        const [activeDraft, ...activeApplyPages] = await Promise.all([
          this.#db.dbResource.draft.getActive({ resourceId: id }),
          ...(['preparing', 'stopping', 'applying', 'restarting'] as const).map((status) => (
            this.#db.dbResource.apply.list({ resourceId: id, status, limit: 1 })
          )),
        ]);
        const activeApply = activeApplyPages.some((page) => page.length > 0);
        if (activeDraft || activeApply) {
          throw new ActorResourceError('RESOURCE_NOT_READY', `DbResource "${resource.name}" has accepted draft or apply work that must finish or be discarded before deletion.`);
        }
      }
      this.#blockedResources.add(id);
      try {
        const references = await this.#db.actorResource.listBindingsForResource({ resourceId: id });
        if (references.length > 0) {
          throw new ActorResourceError('RESOURCE_STILL_BOUND', `Resource "${resource.name}" is still bound to ${references.length} definition slot(s).`, {
            resourceId: id,
            bindingCount: references.length,
          });
        }
        const deleting = await this.#db.actorResource.beginDelete({ id })
          .catch((error) => { throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource deletion could not begin.'); });
        if (!deleting) {
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
    });
  }

  listResourceReferences(resourceId: string): Promise<TActorResourceBinding[]> {
    return this.#db.actorResource.listBindingsForResource({ resourceId })
      .catch((error) => { throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource references could not be listed.'); });
  }

  async bindResource(args: TBindResourceArgs): Promise<TActorResourceBinding> {
    this.#assertOpen();
    const releaseIntent = this.#registerBindingIntent(args.resourceId);
    try {
      return await this.#trackLifecycle(this.#withDefinitionGate(args.definitionName, async () => {
        await this.#drainDefinitionStarts(args.definitionName);
        this.#assertOpen();
        const requirement = this.#requireRequirement(args.definitionName, args.slot);
        const existing = (await this.#db.actorResource.listBindingsForDefinition({ definitionName: args.definitionName }))
          .find((binding) => binding.slot_name === args.slot);
        const resourceIds = existing ? [existing.resource_id, args.resourceId] : [args.resourceId];
        return this.#withResourceGates(resourceIds, async () => {
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
          for (const resourceId of resourceIds) {
            if (this.#blockedResources.has(resourceId)) {
              throw new ActorResourceError('RESOURCE_NOT_READY', `Resource "${resource.name}" is busy with a lifecycle operation.`);
            }
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
      const existing = (await this.#db.actorResource.listBindingsForDefinition({ definitionName: args.definitionName }))
        .find((binding) => binding.slot_name === args.slot);
      if (!existing) return false;
      return this.#withResourceGate(existing.resource_id, async () => {
        if (this.#blockedResources.has(existing.resource_id)) {
          throw new ActorResourceError('RESOURCE_NOT_READY', 'Resource is busy with a lifecycle operation.');
        }
        return this.#db.actorResource.removeBinding({ definitionName: args.definitionName, slotName: args.slot })
          .catch((error) => { throw toActorResourceError(error, 'RESOURCE_PROVIDER_UNAVAILABLE', 'Resource binding could not be removed.'); });
      });
    }));
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

  getActorStartAdmission(args: {
    definitionName: string;
    actorInstanceId: string;
    restartIfCompatible: boolean;
  }): Promise<TActorStartAdmission> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#withActorStartAdmissionGate(args.actorInstanceId, async () => {
      const existingReservation = this.#actorStartReservations.get(args.actorInstanceId);
      if (existingReservation) {
        await existingReservation.settled;
        this.#assertOpen();
      }
      return this.#withDefinitionGate(args.definitionName, async () => {
        const requirements = this.#requireRequirementMap(args.definitionName);
        const bindings = await this.#db.actorResource.listBindingsForDefinition({ definitionName: args.definitionName });
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
                message: `Required ${requirement.kind} resource slot "${slot}" is not bound for actor definition "${args.definitionName}".`,
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
                  ? `Actor definition "${args.definitionName}" is waiting for ${resource.kind} resource "${resource.name}" to finish a lifecycle operation.`
                  : `${resource.kind} resource "${resource.name}" bound to slot "${slot}" is ${resource.status}.`,
                lifecycleBlocked,
              });
            }
          }

          const interrupted = await this.#resolvedActorApplyBlocks(args.actorInstanceId, admittedDbResourceIds);
          const admission: TActorStartAdmission = {
            allowed: true,
            hadBlocks: interrupted.length > 0,
            shouldRestart: args.restartIfCompatible || interrupted.length > 0,
            resolvedBlockResourceIds: interrupted,
            code: null,
            message: null,
          };
          this.#reserveActorStart(args.actorInstanceId, args.definitionName, admittedResourceIds, admission);
          return admission;
        });
      });
    }));
  }

  async completeActorStart(args: {
    actorInstanceId: string;
    resourceIds: readonly string[];
    succeeded: boolean;
  }): Promise<void> {
    const reservation = this.#actorStartReservations.get(args.actorInstanceId);
    if (reservation) {
      this.#actorStartReservations.delete(args.actorInstanceId);
      reservation.release();
    }
    if (this.#closed && !reservation) return;
    if (!args.succeeded) return;
    const resolved = new Set(args.resourceIds);
    if (resolved.size === 0) return;
    const handledResources = new Set<string>();
    const results = await this.#db.dbResource.apply.instanceResult.listByInstance({ actorInstanceId: args.actorInstanceId });
    for (const result of results) {
      const apply = await this.#db.dbResource.apply.get({ id: result.apply_id });
      if (!apply || !resolved.has(apply.resource_id) || handledResources.has(apply.resource_id)) continue;
      handledResources.add(apply.resource_id);
      if (!result.was_running || result.status === 'restarted' || result.status === 'notRunning') continue;
      await this.#db.dbResource.apply.instanceResult.upsert({
        applyId: result.apply_id,
        actorInstanceId: result.actor_instance_id,
        actorDefinitionName: result.actor_definition_name,
        wasRunning: true,
        status: 'restarted',
        error: null,
      });
    }
  }

  withReadyResource<T>(
    resourceId: string,
    operation: (resource: TActorResource) => Promise<T>,
  ): Promise<T> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#withResourceGate(resourceId, async () => {
      const resource = await this.#requireResource(resourceId);
      if (resource.status !== 'ready' || this.#blockedResources.has(resourceId)) this.#throwUnavailable(resource);
      return operation(resource);
    }));
  }

  call(call: TActorResourceCall): Promise<unknown> {
    if (this.#closed) return Promise.reject(new ActorResourceError('RESOURCE_CALL_CANCELLED', 'Actor resource gateway is closed.'));
    return this.#trackGatewayCall(this.#cancelOnGatewayClose(this.#resolveCall(call)));
  }

  callWithDirectBinding(call: TActorResourceCall, direct: TActorResourceDirectBinding): Promise<unknown> {
    if (this.#closed) return Promise.reject(new ActorResourceError('RESOURCE_CALL_CANCELLED', 'Actor resource gateway is closed.'));
    const resolving = (async () => {
      if (direct.requirement.kind !== call.kind) {
        throw new ActorResourceError('RESOURCE_KIND_MISMATCH', `Slot "${call.slot}" is not a ${call.kind} resource.`);
      }
      const scope = validateScope(direct.scope, direct.requirement);
      const binding: TActorResourceBinding = {
        actor_definition_name: call.definitionName,
        slot_name: call.slot,
        resource_id: direct.resourceId,
        allow_read: scope.includes('read'),
        allow_write: scope.includes('write'),
        created_at: '',
        updated_at: '',
      };
      return this.#track(direct.resourceId, this.#resolveBoundCall(call, direct.requirement, binding));
    })();
    return this.#trackGatewayCall(this.#cancelOnGatewayClose(resolving));
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
      await this.#settleWithin(
        [...this.#actorStartReservations.values()].map((reservation) => reservation.settled),
        SHUTDOWN_DRAIN_TIMEOUT_MS,
      );
      for (const reservation of this.#actorStartReservations.values()) reservation.release();
      this.#actorStartReservations.clear();
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

  coordinateResourceApply<T>(
    resourceId: string,
    operation: (resource: TActorResource) => Promise<T>,
  ): Promise<T> {
    this.#assertOpen();
    return this.#trackLifecycle(this.#coordinateResourceApply(resourceId, operation));
  }

  async #coordinateResourceApply<T>(
    resourceId: string,
    operation: (resource: TActorResource) => Promise<T>,
  ): Promise<T> {
    await this.#drainBindingIntents(resourceId);
    this.#assertOpen();
    return this.#withResourceGate(resourceId, async () => {
      const resource = await this.#requireResource(resourceId);
      if (resource.kind !== 'db') {
        throw new ActorResourceError('RESOURCE_KIND_MISMATCH', `Resource "${resourceId}" is not a DbResource.`);
      }
      if (resource.status !== 'ready' || this.#blockedResources.has(resourceId)) {
        this.#throwUnavailable(resource);
      }
      this.#blockedResources.add(resourceId);
      try {
        await this.#drain(resourceId);
        const migrating = await this.#db.actorResource.updateProviderState({
          id: resourceId,
          status: 'migrating',
          lastError: null,
        });
        if (!migrating) {
          throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource catalog row disappeared before apply.');
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

  async #resolvedActorApplyBlocks(actorInstanceId: string, resourceIds: readonly string[]): Promise<string[]> {
    if (resourceIds.length === 0) return [];
    const resourceIdSet = new Set(resourceIds);
    const resolved = new Set<string>();
    const handledResources = new Set<string>();
    const results = await this.#db.dbResource.apply.instanceResult.listByInstance({ actorInstanceId });
    for (const result of results) {
      const apply = await this.#db.dbResource.apply.get({ id: result.apply_id });
      if (!apply || !resourceIdSet.has(apply.resource_id) || handledResources.has(apply.resource_id)) continue;
      handledResources.add(apply.resource_id);
      if (result.was_running && result.status !== 'restarted' && result.status !== 'notRunning') {
        resolved.add(apply.resource_id);
      }
    }
    return [...resolved].sort();
  }

  #reserveActorStart(
    actorInstanceId: string,
    definitionName: string,
    resourceIds: readonly string[],
    admission: TActorStartAdmission,
  ): void {
    if (this.#actorStartReservations.has(actorInstanceId)) return;
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
    this.#actorStartReservations.set(actorInstanceId, {
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

  async #withActorStartAdmissionGate<T>(actorInstanceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#actorStartAdmissionGateTails.get(actorInstanceId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    this.#actorStartAdmissionGateTails.set(actorInstanceId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.#actorStartAdmissionGateTails.get(actorInstanceId) === tail) {
        void tail.finally(() => {
          if (this.#actorStartAdmissionGateTails.get(actorInstanceId) === tail) this.#actorStartAdmissionGateTails.delete(actorInstanceId);
        });
      }
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

  #statusBlock(requirement: TActorResourceRequirement, binding: TActorResourceBinding | null, resource: TActorResource | null, scopeValid: boolean, kindMatches: boolean): { code: string | null; message: string | null } {
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
  ): TActorStartAdmission {
    return {
      allowed: false,
      hadBlocks: blocked.lifecycleBlocked,
      shouldRestart: args.restartIfCompatible,
      resolvedBlockResourceIds: [],
      code: blocked.code,
      message: blocked.message,
    };
  }

  #notBoundCode(kind: TActorResourceKind): string {
    if (kind === 'db') return 'DB_RESOURCE_NOT_BOUND';
    if (kind === 'kv') return 'KV_RESOURCE_NOT_BOUND';
    return 'SECRET_STORE_NOT_BOUND';
  }

  #unavailableCode(kind: TActorResourceKind): string {
    if (kind === 'db') return 'DB_RESOURCE_UNAVAILABLE';
    if (kind === 'kv') return 'KV_RESOURCE_UNAVAILABLE';
    return 'SECRET_STORE_UNAVAILABLE';
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
