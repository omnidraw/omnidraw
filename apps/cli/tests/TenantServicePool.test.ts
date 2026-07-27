import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { TenantServicePool } from '../src/services/TenantServicePool';

const tenant = (orgId: string, accountId = 'account'): TTenantContext => ({
  orgId,
  accountId,
  cellId: 'cell',
  placementEpoch: 1,
  roles: ['member'],
  capabilities: [],
  requestId: `request-${orgId}`,
});

const movedTenant = (
  orgId: string,
  placementEpoch: number,
  cellId = `cell-${placementEpoch}`,
): TTenantContext => ({
  ...tenant(orgId),
  cellId,
  placementEpoch,
  requestId: `request-${orgId}-${placementEpoch}`,
});

describe('TenantServicePool', () => {
  test('deduplicates one child per tenant and isolates identical child state', async () => {
    const stopped: string[] = [];
    const pool = new TenantServicePool('test-pool', {
      create: (context) => ({
        orgId: context.orgId,
        stop: () => { stopped.push(context.orgId); },
      }),
    });
    pool.start({ config: {}, hooks: {} });

    const a1 = await pool.forTenant(tenant('org-a'));
    const a2 = await pool.forTenant(tenant('org-a'));
    const b = await pool.forTenant(tenant('org-b'));

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1.orgId).toBe('org-a');
    expect(b.orgId).toBe('org-b');
    expect(pool.getTenantCount()).toBe(2);
    await pool.stop();
    expect(stopped.sort()).toEqual(['org-a', 'org-b']);
  });

  test('fails closed when bounded tenant capacity is exhausted', async () => {
    const pool = new TenantServicePool('bounded', {
      maxTenants: 1,
      create: () => ({}),
    });
    pool.start({ config: {}, hooks: {} });
    await pool.forTenant(tenant('org-a'));
    await expect(pool.forTenant(tenant('org-b'))).rejects.toThrow('tenant capacity reached');
  });

  test('supports an organization placement key for one shared physical service', async () => {
    let createCount = 0;
    const pool = new TenantServicePool('resource-store-pool', {
      key: (context) => [context.orgId, context.cellId, context.placementEpoch].join(':'),
      create: () => ({ owner: ++createCount }),
    });
    pool.start({ config: {}, hooks: {} });

    const firstAccount = await pool.forTenant(tenant('org-a', 'account-a'));
    const secondAccount = await pool.forTenant(tenant('org-a', 'account-b'));

    expect(secondAccount).toBe(firstAccount);
    expect(createCount).toBe(1);
    expect(pool.getTenantCount()).toBe(1);
  });

  test('retires an old organization placement before starting its higher epoch', async () => {
    const events: string[] = [];
    let markOldStopEntered: (() => void) | undefined;
    const oldStopEntered = new Promise<void>((resolve) => {
      markOldStopEntered = resolve;
    });
    let releaseOldStop: (() => void) | undefined;
    const oldStopBlocked = new Promise<void>((resolve) => {
      releaseOldStop = resolve;
    });
    const pool = new TenantServicePool('placement-pool', {
      key: (context) => [context.orgId, context.cellId, context.placementEpoch].join(':'),
      singlePlacementPerOrganization: true,
      create: (context) => ({
        epoch: context.placementEpoch,
        start: async () => { events.push(`start:${context.placementEpoch}`); },
        stop: async () => {
          events.push(`stop:${context.placementEpoch}`);
          if (context.placementEpoch === 1) {
            markOldStopEntered?.();
            await oldStopBlocked;
          }
        },
      }),
    });
    pool.start({ config: {}, hooks: {} });

    await pool.forTenant(movedTenant('org-a', 1));
    const replacement = pool.forTenant(movedTenant('org-a', 2));
    await oldStopEntered;

    expect(events).toEqual(['start:1', 'stop:1']);
    expect(pool.getTenantCount()).toBe(1);
    releaseOldStop?.();
    await expect(replacement).resolves.toMatchObject({ epoch: 2 });
    expect(events).toEqual(['start:1', 'stop:1', 'start:2']);
    expect(pool.getTenantCount()).toBe(1);
    await expect(pool.forTenant(movedTenant('org-a', 1))).rejects.toThrow(
      'rejected stale organization placement epoch 1; current epoch is 2',
    );
    await pool.stop();
  });

  test('fails placement turnover closed until old-placement shutdown succeeds', async () => {
    const created: number[] = [];
    let failOldStop = true;
    const pool = new TenantServicePool('placement-cleanup-pool', {
      key: (context) => [context.orgId, context.cellId, context.placementEpoch].join(':'),
      singlePlacementPerOrganization: true,
      create: (context) => {
        created.push(context.placementEpoch);
        return {
          epoch: context.placementEpoch,
          stop: async () => {
            if (context.placementEpoch === 1 && failOldStop) {
              throw new Error('old owner still running');
            }
          },
        };
      },
    });
    pool.start({ config: {}, hooks: {} });

    await pool.forTenant(movedTenant('org-a', 1));
    await expect(pool.forTenant(movedTenant('org-a', 2))).rejects.toThrow(
      'old owner still running',
    );
    expect(created).toEqual([1]);
    expect(pool.getTenantCount()).toBe(1);
    await expect(pool.forTenant(movedTenant('org-a', 1))).rejects.toThrow(
      'rejected stale organization placement epoch 1; current epoch is 2',
    );

    failOldStop = false;
    await expect(pool.forTenant(movedTenant('org-a', 2))).resolves.toMatchObject({ epoch: 2 });
    expect(created).toEqual([1, 2]);
    expect(pool.getTenantCount()).toBe(1);
    await pool.stop();
  });

  test('coalesces superseded placement transitions without starting an intermediate epoch', async () => {
    const events: string[] = [];
    let markOldStopEntered: (() => void) | undefined;
    const oldStopEntered = new Promise<void>((resolve) => {
      markOldStopEntered = resolve;
    });
    let releaseOldStop: (() => void) | undefined;
    const oldStopBlocked = new Promise<void>((resolve) => {
      releaseOldStop = resolve;
    });
    const pool = new TenantServicePool('placement-coalescing-pool', {
      key: (context) => [context.orgId, context.cellId, context.placementEpoch].join(':'),
      singlePlacementPerOrganization: true,
      create: (context) => ({
        epoch: context.placementEpoch,
        start: async () => { events.push(`start:${context.placementEpoch}`); },
        stop: async () => {
          events.push(`stop:${context.placementEpoch}`);
          if (context.placementEpoch === 1) {
            markOldStopEntered?.();
            await oldStopBlocked;
          }
        },
      }),
    });
    pool.start({ config: {}, hooks: {} });

    await pool.forTenant(movedTenant('org-a', 1));
    const epochTwo = pool.forTenant(movedTenant('org-a', 2));
    await oldStopEntered;
    const epochThree = pool.forTenant(movedTenant('org-a', 3));
    releaseOldStop?.();

    await expect(epochTwo).rejects.toThrow(
      'rejected stale organization placement epoch 2; current epoch is 3',
    );
    await expect(epochThree).resolves.toMatchObject({ epoch: 3 });
    expect(events).toEqual(['start:1', 'stop:1', 'start:3']);
    expect(pool.getTenantCount()).toBe(1);
    await pool.stop();
  });

  test('stops and evicts a child whose startup fails', async () => {
    let createCount = 0;
    let stopCount = 0;
    const pool = new TenantServicePool('rollback-pool', {
      create: () => {
        createCount += 1;
        return {
          start: async () => { throw new Error('startup failed'); },
          stop: async () => { stopCount += 1; },
        };
      },
    });
    pool.start({ config: {}, hooks: {} });

    await expect(pool.forTenant(tenant('org-a'))).rejects.toThrow('startup failed');
    expect(stopCount).toBe(1);
    expect(pool.getTenantCount()).toBe(0);
    await expect(pool.forTenant(tenant('org-a'))).rejects.toThrow('startup failed');
    expect(createCount).toBe(2);
    expect(stopCount).toBe(2);
  });

  test('retains a failed-start child when service cleanup must be retried', async () => {
    let createCount = 0;
    let stopCount = 0;
    const pool = new TenantServicePool('startup-cleanup-pool', {
      create: () => {
        createCount += 1;
        return {
          start: async () => { throw new Error('startup failed'); },
          stop: async () => {
            stopCount += 1;
            if (stopCount < 3) throw new Error('service cleanup failed');
          },
        };
      },
    });
    pool.start({ config: {}, hooks: {} });

    await expect(pool.forTenant(tenant('org-a'))).rejects.toBeInstanceOf(AggregateError);
    expect(createCount).toBe(1);
    expect(stopCount).toBe(1);
    expect(pool.getTenantCount()).toBe(1);
    await expect(pool.forTenant(tenant('org-a'))).rejects.toBeInstanceOf(AggregateError);
    expect(createCount).toBe(1);

    await expect(pool.stop()).rejects.toBeInstanceOf(AggregateError);
    expect(stopCount).toBe(2);
    expect(pool.getTenantCount()).toBe(1);

    await expect(pool.stop()).resolves.toBeUndefined();
    expect(stopCount).toBe(3);
    expect(pool.getTenantCount()).toBe(0);
  });

  test('retains a child after failed shutdown so service cleanup can be retried', async () => {
    let failStop = true;
    let stopCount = 0;
    const pool = new TenantServicePool('fail-closed-pool', {
      create: () => ({
        stop: async () => {
          stopCount += 1;
          if (failStop) throw new Error('service cleanup failed');
        },
      }),
    });
    pool.start({ config: {}, hooks: {} });
    await pool.forTenant(tenant('org-a'));

    await expect(pool.stop()).rejects.toBeInstanceOf(AggregateError);
    expect(pool.getTenantCount()).toBe(1);
    await expect(pool.forTenant(tenant('org-b'))).rejects.toThrow('not accepting tenant work');

    failStop = false;
    await expect(pool.stop()).resolves.toBeUndefined();
    expect(stopCount).toBe(2);
    expect(pool.getTenantCount()).toBe(0);
  });

  test('lets a separate organization progress while one organization operation is blocked', async () => {
    class OperationPool extends TenantServicePool<{
      run: (operation: () => Promise<string>) => Promise<string>;
    }> {
      runForTenant(context: TTenantContext, operation: () => Promise<string>): Promise<string> {
        return this.withTenantService(context, (service) => service.run(operation));
      }
    }

    let markHotStarted: (() => void) | undefined;
    const hotStarted = new Promise<void>((resolve) => { markHotStarted = resolve; });
    let releaseHot: (() => void) | undefined;
    const hotBlocked = new Promise<void>((resolve) => { releaseHot = resolve; });
    let hotFinished = false;
    const pool = new OperationPool('noisy-neighbor-pool', {
      key: (context) => [context.orgId, context.cellId, context.placementEpoch].join(':'),
      singlePlacementPerOrganization: true,
      create: () => ({ run: async (operation) => operation() }),
    });
    pool.start({ config: {}, hooks: {} });

    const hot = pool.runForTenant(tenant('org-hot'), async () => {
      markHotStarted?.();
      await hotBlocked;
      hotFinished = true;
      return 'hot-complete';
    });
    try {
      await hotStarted;
      const separateOrganization = pool.runForTenant(
        tenant('org-independent'),
        async () => 'independent-complete',
      );
      await expect(Promise.race([
        separateOrganization,
        Bun.sleep(1_000).then(() => { throw new Error('Separate organization was blocked by noisy-neighbor work.'); }),
      ])).resolves.toBe('independent-complete');
      expect(hotFinished).toBe(false);
      expect(pool.getTenantCount()).toBe(2);

      releaseHot?.();
      await expect(hot).resolves.toBe('hot-complete');
    } finally {
      releaseHot?.();
      await hot.catch(() => undefined);
      await pool.stop();
    }
  });
});
