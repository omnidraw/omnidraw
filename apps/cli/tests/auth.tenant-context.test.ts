import { describe, expect, test } from 'bun:test';
import { OSS_FAKE_SESSION, OSS_TENANT_CONTEXT_PROVIDER } from '../src/plugins/auth/AuthPlugin';
import { fnAssertOssTenantPlacement } from '../src/plugins/auth/fn.oss-tenant-context';

describe('trusted OSS tenant boundary', () => {
  test('derives and freezes authority from the trusted session only', async () => {
    const tenant = await OSS_TENANT_CONTEXT_PROVIDER.resolveTenantContext({
      requestId: 'request-a',
      session: OSS_FAKE_SESSION,
      canvasId: 'canvas-a',
    });

    expect(tenant.orgId).toBe(OSS_FAKE_SESSION.orgId);
    expect(tenant.accountId).toBe(OSS_FAKE_SESSION.accountId);
    expect(tenant.canvasId).toBe('canvas-a');
    expect(Object.isFrozen(tenant)).toBe(true);
    expect(Object.isFrozen(tenant.roles)).toBe(true);
    expect(Object.isFrozen(tenant.capabilities)).toBe(true);
  });

  test('rejects caller-shaped session copies and stale placement epochs', async () => {
    await expect(OSS_TENANT_CONTEXT_PROVIDER.resolveTenantContext({
      requestId: 'request-b',
      session: { ...OSS_FAKE_SESSION },
    })).rejects.toThrow('Unauthenticated tenant session.');

    const current = await OSS_TENANT_CONTEXT_PROVIDER.resolveTenantContext({
      requestId: 'request-c',
      session: OSS_FAKE_SESSION,
    });
    expect(() => fnAssertOssTenantPlacement({
      ...current,
      placementEpoch: OSS_FAKE_SESSION.placementEpoch + 1,
    })).toThrow('Stale tenant placement.');
  });
});
