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

  test('supports an organization placement key for one shared physical owner', async () => {
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

  test('retains a failed-start child when ownership cleanup must be retried', async () => {
    let createCount = 0;
    let stopCount = 0;
    const pool = new TenantServicePool('startup-cleanup-pool', {
      create: () => {
        createCount += 1;
        return {
          start: async () => { throw new Error('startup failed'); },
          stop: async () => {
            stopCount += 1;
            if (stopCount < 3) throw new Error('owner close failed');
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

  test('retains a child after failed shutdown so ownership cleanup can be retried', async () => {
    let failStop = true;
    let stopCount = 0;
    const pool = new TenantServicePool('fail-closed-pool', {
      create: () => ({
        stop: async () => {
          stopCount += 1;
          if (failStop) throw new Error('owner close failed');
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
});
