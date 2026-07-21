import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { TenantServicePool } from '../src/services/TenantServicePool';

const tenant = (orgId: string): TTenantContext => ({
  orgId,
  accountId: 'account',
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
});
