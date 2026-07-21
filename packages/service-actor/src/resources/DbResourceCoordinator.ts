/**
 * @file Compatibility composition for the actor-independent DbResource coordinator.
 */

import type {
  IResourceUseCoordinator,
  TResourceDrainLease,
  TResourceDrainRequest,
  TResourceDrainResult,
  TResourceReleaseMode,
  TResourceReleaseResult,
  TResourceUse,
  TResourceUseInspection,
} from '@vibecanvas/resource-runtime';
import {
  DbResourceCoordinator as LocalDbResourceCoordinator,
} from '@vibecanvas/resource-runtime/local';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_CELL_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '@vibecanvas/service-db/CONSTANTS';
import type { TTenantDb } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { ActorSupervisor } from '../ActorSupervisor';
import type { ActorResourceManager } from './ActorResourceManager';
import type { DbResource } from './DbResource';

type TTenantContext = Parameters<IResourceUseCoordinator['inspect']>[0];

const LEGACY_ACTOR_TENANT = Object.freeze({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: DEFAULT_OSS_CELL_ID,
  placementEpoch: 1,
  roles: Object.freeze(['owner']),
  capabilities: Object.freeze(['*']),
  requestId: 'legacy-actor-resource-coordinator',
}) satisfies TTenantContext;

type TDbResourceCoordinatorConfig = {
  readonly db: TTenantDb;
  readonly resourceManager: ActorResourceManager;
  readonly supervisor: ActorSupervisor;
  readonly dbResource: DbResource;
  readonly crypto: Pick<Crypto, 'randomUUID'>;
  readonly tenant?: TTenantContext;
};

class ActorResourceUseCoordinator implements IResourceUseCoordinator {
  readonly #db: TTenantDb;
  readonly #supervisor: ActorSupervisor;
  #leaseEpoch = 0;

  constructor(db: TTenantDb, supervisor: ActorSupervisor) {
    this.#db = db;
    this.#supervisor = supervisor;
  }

  async inspect(_tenant: TTenantContext, resourceId: string): Promise<TResourceUseInspection> {
    const instances = await this.#db.dbResource.listAffectedInstances({ resourceId });
    return {
      resourceId,
      uses: instances.flatMap((instance): readonly TResourceUse[] => (
        this.#supervisor.isInstanceRunning(instance.id)
          ? [{
            id: instance.id,
            kind: 'legacy-actor',
            state: 'active',
            label: instance.actor_definition_name,
          }]
          : []
      )),
    };
  }

  async drain(
    tenant: TTenantContext,
    request: TResourceDrainRequest,
  ): Promise<TResourceDrainResult> {
    const inspection = await this.inspect(tenant, request.resourceId);
    const drainedUses: TResourceUse[] = [];
    for (const use of inspection.uses) {
      if (!await this.#supervisor.stopInstanceForResourceApply(use.id)) {
        await this.#resumeUses(drainedUses);
        return {
          ok: false,
          code: 'RESOURCE_DRAIN_TIMEOUT',
          inspection: await this.inspect(tenant, request.resourceId),
        };
      }
      drainedUses.push({ ...use, state: 'stopped' });
    }
    this.#leaseEpoch += 1;
    return {
      ok: true,
      lease: {
        resourceId: request.resourceId,
        leaseId: `legacy-actor-resource:${this.#leaseEpoch}`,
        leaseEpoch: this.#leaseEpoch,
        expiresAtMs: Number.MAX_SAFE_INTEGER,
        drainedUses,
      },
    };
  }

  async release(
    _tenant: TTenantContext,
    lease: TResourceDrainLease,
    mode: TResourceReleaseMode,
  ): Promise<TResourceReleaseResult> {
    const resumedUseIds = mode === 'resume'
      ? await this.#resumeUses(lease.drainedUses)
      : [];
    return {
      resourceId: lease.resourceId,
      released: true,
      mode,
      resumedUseIds,
    };
  }

  async #resumeUses(uses: readonly TResourceUse[]): Promise<string[]> {
    const resumedUseIds: string[] = [];
    for (const use of uses) {
      try {
        const actor = await this.#supervisor.restartInstanceAfterResourceApply(use.id);
        if (actor !== null && this.#supervisor.isInstanceRunning(use.id)) resumedUseIds.push(use.id);
      } catch {
        // The neutral release result reports only successfully resumed uses.
      }
    }
    return resumedUseIds;
  }
}

export class DbResourceCoordinator extends LocalDbResourceCoordinator {
  constructor(config: TDbResourceCoordinatorConfig) {
    super({
      tenant: config.tenant ?? LEGACY_ACTOR_TENANT,
      controlStore: config.db,
      resourceManager: config.resourceManager,
      useCoordinator: new ActorResourceUseCoordinator(config.db, config.supervisor),
      dbResource: config.dbResource,
      crypto: config.crypto,
    });
  }
}
