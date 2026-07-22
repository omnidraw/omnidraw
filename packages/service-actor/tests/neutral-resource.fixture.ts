import type { IResourceUseCoordinator } from '@vibecanvas/resource-runtime';
import type { TDatabaseFactory } from '@vibecanvas/resource-runtime/local';
import type { DbServiceTurso, TTenantDb } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { ResourceControlStoreTurso } from '@vibecanvas/service-db/ResourceControlStoreTurso';
import type { ITenantEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { ResourceService } from '../../../apps/cli/src/services/ResourceService';
import { TenantResourceService } from '../../../apps/cli/src/services/TenantResourceService';
import { ActorService } from '../src/ActorService';

type TTenantContext = Parameters<IResourceUseCoordinator['inspect']>[0];

type TCreateNeutralActorResourceComposition = Readonly<{
  tenant: TTenantContext;
  dbService: DbServiceTurso;
  db: TTenantDb;
  configPath: string;
  dataRoot: string;
  eventPublisherService: ITenantEventPublisherService;
  crypto: Pick<Crypto, 'randomUUID'>;
  databaseFactory?: TDatabaseFactory;
}>;

type TBindTenantMethod<TValue> = TValue extends (...args: infer TArgs) => infer TResult
  ? TArgs extends [TTenantContext, ...infer TRest]
    ? (...args: TRest) => TResult
    : never
  : never;

type TTenantBoundResourceService = Readonly<{
  [TKey in keyof ResourceService as TBindTenantMethod<ResourceService[TKey]> extends never
    ? never
    : TKey]: TBindTenantMethod<ResourceService[TKey]>;
}>;

type TNeutralActorResourceComposition = Readonly<{
  actor: ActorService;
  resourceOwner: ResourceService;
  resourceService: TTenantBoundResourceService;
  start(): Promise<void>;
  stop(): Promise<void>;
}>;

function createTenantBoundResourceService(
  owner: ResourceService,
  tenant: TTenantContext,
): TTenantBoundResourceService {
  return new Proxy({} as TTenantBoundResourceService, {
    get(_target, property) {
      const method = owner[property as keyof ResourceService];
      if (typeof method !== 'function') return method;
      return (...args: unknown[]) => Reflect.apply(method, owner, [tenant, ...args]);
    },
  });
}

/**
 * Test composition for the real neutral resource owner. ActorService receives
 * only a tenant-scoped adapter and never opens or closes resource providers.
 */
export function createNeutralActorResourceComposition(
  args: TCreateNeutralActorResourceComposition,
): TNeutralActorResourceComposition {
  let actor: ActorService | null = null;
  const requireActor = (): ActorService => {
    if (!actor) throw new Error('Actor resource-use coordinator is not attached.');
    return actor;
  };
  const useCoordinator: IResourceUseCoordinator = {
    inspect: (_tenant, resourceId) => requireActor().inspectResourceUses(resourceId),
    drain: (_tenant, request) => requireActor().drainResourceUses(request),
    release: (_tenant, lease, mode) => requireActor().releaseResourceUses(lease, mode),
  };
  const resourceOwner = new ResourceService({
    tenant: args.tenant,
    db: args.db,
    controlStore: new ResourceControlStoreTurso(args.dbService.db),
    dataRoot: args.dataRoot,
    useCoordinator,
    crypto: args.crypto,
    ...(args.databaseFactory ? { databaseFactory: args.databaseFactory } : {}),
  });
  const actorResourceBridge = new TenantResourceService(resourceOwner, args.tenant);
  const resourceService = createTenantBoundResourceService(resourceOwner, args.tenant);
  actor = new ActorService({
    db: args.db,
    configPath: args.configPath,
    crypto: args.crypto,
    resourceService: actorResourceBridge,
    eventPublisherService: args.eventPublisherService,
  });

  return {
    actor,
    resourceOwner,
    resourceService,
    async start(): Promise<void> {
      await resourceOwner.start({ config: {}, hooks: {} });
      try {
        await actor!.start({} as never);
      } catch (error) {
        await resourceOwner.stop().catch(() => undefined);
        throw error;
      }
    },
    async stop(): Promise<void> {
      let failure: unknown = null;
      try {
        await actor!.stop();
      } catch (error) {
        failure = error;
      }
      try {
        await resourceOwner.stop();
      } catch (error) {
        failure ??= error;
      }
      if (failure !== null) throw failure;
    },
  };
}

export type { TNeutralActorResourceComposition };
