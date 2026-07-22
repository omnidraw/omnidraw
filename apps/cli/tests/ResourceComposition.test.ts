import { describe, expect, test } from 'bun:test';
import { router } from '@vibecanvas/api/router';
import type {
  TResourceDrainLease,
  TResourceDrainRequest,
  TResourceUse,
} from '@vibecanvas/resource-runtime';
import { ActorService, type IActorResourceService } from '@vibecanvas/service-actor';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createOrpcTenantContext,
  type TOrpcTenantContextServices,
} from '../src/plugins/orpc/OrpcPlugin';
import type { ResourceService } from '../src/services/ResourceService';
import {
  createResourceServiceCapabilities,
  ResourceServicePool,
} from '../src/services/ResourceServicePool';
import {
  ResourceUseCoordinatorBridge,
  type TResourceUseConsumer,
} from '../src/services/ResourceUseCoordinatorBridge';

function tenant(
  accountId: string,
  cellId = 'cell-a',
  placementEpoch = 1,
): TTenantContext {
  return {
    orgId: 'org-a',
    accountId,
    cellId,
    placementEpoch,
    roles: ['owner'],
    capabilities: ['*'],
    requestId: `request-${accountId}-${cellId}-${placementEpoch}`,
  };
}

describe('resource runtime composition', () => {
  test('shares one physical service across accounts at one organization placement', async () => {
    let ownerCount = 0;
    const pool = new ResourceServicePool({
      create: (context) => ({
        ownerNumber: ++ownerCount,
        placement: `${context.orgId}:${context.cellId}:${context.placementEpoch}`,
      }) as unknown as ResourceService,
    });
    pool.start({ config: {}, hooks: {} });

    const accountA = await pool.forTenant(tenant('account-a'));
    const accountB = await pool.forTenant(tenant('account-b'));
    const nextPlacement = await pool.forTenant(tenant('account-a', 'cell-b', 2));

    expect(accountB).toBe(accountA);
    expect(nextPlacement).not.toBe(accountA);
    expect(ownerCount).toBe(2);
    expect(pool.getTenantCount()).toBe(2);
    await pool.stop();
  });

  test('forwards each account request context through one shared physical owner', async () => {
    const seen: Array<Pick<TTenantContext, 'accountId' | 'capabilities' | 'requestId'>> = [];
    const pool = new ResourceServicePool({
      create: () => ({
        listResources: async (context: TTenantContext) => {
          await Promise.resolve();
          seen.push({
            accountId: context.accountId,
            capabilities: context.capabilities,
            requestId: context.requestId,
          });
          return [];
        },
        revealSecret: async (context: TTenantContext) => {
          seen.push({
            accountId: context.accountId,
            capabilities: context.capabilities,
            requestId: context.requestId,
          });
          return { kind: 'secretStore' as const, name: 'token', value: 'secret', revision: 1 };
        },
      }) as unknown as ResourceService,
    });
    pool.start({ config: {}, hooks: {} });
    const capabilities = createResourceServiceCapabilities(pool);
    const accountA = tenant('account-a');
    const accountB = {
      ...tenant('account-b'),
      capabilities: ['resource:secret:reveal'],
      requestId: 'request-account-b-explicit',
    };

    await Promise.all([
      capabilities.resource.listResources(accountA, {}),
      capabilities.resource.listResources(accountB, {}),
    ]);
    await capabilities.humanSecret.revealSecret(accountB, {
      resourceId: 'resource-a',
      name: 'token',
    });

    expect(capabilities.resource).not.toBe(capabilities.humanSecret);
    expect(Object.isFrozen(capabilities.resource)).toBe(true);
    expect(Object.isFrozen(capabilities.humanSecret)).toBe(true);
    expect('revealSecret' in capabilities.resource).toBe(false);
    expect('forTenant' in capabilities.resource).toBe(false);
    expect('listResources' in capabilities.humanSecret).toBe(false);
    expect('forTenant' in capabilities.humanSecret).toBe(false);

    expect(seen).toContainEqual({
      accountId: accountA.accountId,
      capabilities: accountA.capabilities,
      requestId: accountA.requestId,
    });
    expect(seen.filter((context) => context.accountId === accountB.accountId)).toEqual([
      {
        accountId: accountB.accountId,
        capabilities: accountB.capabilities,
        requestId: accountB.requestId,
      },
      {
        accountId: accountB.accountId,
        capabilities: accountB.capabilities,
        requestId: accountB.requestId,
      },
    ]);
    expect(pool.getTenantCount()).toBe(1);
    await pool.stop();
  });

  test('fans lifecycle coordination across multiple account consumers', async () => {
    const bridge = new ResourceUseCoordinatorBridge();
    const releases: string[] = [];
    const consumer = (id: string): TResourceUseConsumer => ({
      async inspectResourceUses(resourceId) {
        return {
          resourceId,
          uses: [{ id, kind: 'legacy-actor', state: 'active' }],
        };
      },
      async drainResourceUses(request: TResourceDrainRequest) {
        const drainedUses: readonly TResourceUse[] = [{
          id,
          kind: 'legacy-actor',
          state: 'stopped',
        }];
        return {
          ok: true as const,
          lease: {
            resourceId: request.resourceId,
            leaseId: `child-${id}`,
            leaseEpoch: 1,
            expiresAtMs: Number.MAX_SAFE_INTEGER,
            drainedUses,
          },
        };
      },
      async releaseResourceUses(lease: TResourceDrainLease, mode) {
        releases.push(`${lease.leaseId}:${mode}`);
        return {
          resourceId: lease.resourceId,
          released: true,
          mode,
          resumedUseIds: lease.drainedUses.map((use) => use.id),
        };
      },
    });
    bridge.attach(consumer('actor-a'));
    bridge.attach(consumer('actor-b'));

    const inspection = await bridge.inspect(tenant('account-a'), 'resource-a');
    expect(inspection.uses.map((use) => use.id).sort()).toEqual(['actor-a', 'actor-b']);
    const drained = await bridge.drain(tenant('account-a'), {
      resourceId: 'resource-a',
      reason: 'schema_apply',
      timeoutMs: 1_000,
    });
    expect(drained.ok).toBe(true);
    if (!drained.ok) throw new Error('Expected resource uses to drain.');
    const released = await bridge.release(tenant('account-a'), drained.lease, 'resume');
    expect(released.resumedUseIds.sort()).toEqual(['actor-a', 'actor-b']);
    expect(releases.sort()).toEqual(['child-actor-a:resume', 'child-actor-b:resume']);
  });

  test('shared ActorService mode neither constructs nor closes physical resource providers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-shared-actor-resource-'));
    const resourceAccesses: PropertyKey[] = [];
    let attached = false;
    let detached = false;
    let stoppedCleanup = false;
    const resourceService = new Proxy({
      attachConsumer() {
        attached = true;
        return () => { detached = true; };
      },
      async listResourceData() {
        return {
          kind: 'kv' as const,
          entries: [{
            key: 'theme',
            valuePreview: '"dark"',
            valueTruncated: false,
            revision: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          }],
          nextCursor: null,
        };
      },
      async inspectDbResource() {
        return {
          resourceId: 'database-a',
          target: 'live' as const,
          draftId: null,
          objects: [],
        };
      },
    }, {
      get(target, property, receiver) {
        resourceAccesses.push(property);
        if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
        return () => Promise.reject(new Error(`Unexpected resource call: ${String(property)}`));
      },
    }) as unknown as IActorResourceService;

    try {
      const actor = new ActorService({
        tenant: tenant('account-a'),
        db: {} as never,
        configPath: root,
        resourceService,
        eventPublisherService: {} as never,
      });
      expect(attached).toBe(true);
      await expect(actor.listResourceData({ resourceId: 'settings' })).resolves.toMatchObject({
        kind: 'kv',
        entries: [{ key: 'theme' }],
      });
      await expect(actor.inspectDbResource({ resourceId: 'database-a', target: 'live' })).resolves.toMatchObject({
        resourceId: 'database-a',
        target: 'live',
      });
      actor.addStopCleanup(() => { stoppedCleanup = true; });
      await actor.stop();
      expect(detached).toBe(true);
      expect(stoppedCleanup).toBe(true);
      expect(resourceAccesses).toEqual(['attachConsumer', 'listResourceData', 'inspectDbResource']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('a top-level resource API call does not construct actor or agent services', async () => {
    let actorCreates = 0;
    let agentCreates = 0;
    const context = createOrpcTenantContext(tenant('account-a'), {
      actor: {
        forTenant: async () => {
          actorCreates += 1;
          return {};
        },
      },
      agent: {
        forTenant: async () => {
          agentCreates += 1;
          return {};
        },
      },
      resource: {
        listResources: async (receivedTenant: TTenantContext) => [{
          id: 'resource-a',
          kind: 'kv' as const,
          name: `Settings for ${receivedTenant.orgId}`,
          status: 'ready' as const,
          last_error: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        }],
      },
      humanResourceSecret: {
        revealSecret: async () => {
          throw new Error('Secret reveal must not be reached by a catalog call.');
        },
      },
      automerge: {},
      db: {},
      eventPublisher: {},
      filesystem: {},
      pty: {},
    } as unknown as TOrpcTenantContextServices);
    const listResources = router.api.resource.resources.list.callable({ context });

    await expect(listResources({})).resolves.toHaveLength(1);
    expect(actorCreates).toBe(0);
    expect(agentCreates).toBe(0);
  });
});
