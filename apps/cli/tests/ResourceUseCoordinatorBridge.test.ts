import { describe, expect, test } from 'bun:test';
import type {
  TResourceDrainLease,
  TResourceDrainRequest,
  TResourceDrainResult,
  TResourceUse,
} from '@vibecanvas/resource-runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ResourceUseCoordinatorBridge,
  type TResourceUseConsumer,
} from '../src/services/ResourceUseCoordinatorBridge';

const TENANT: TTenantContext = {
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'request-a',
};

function lease(
  resourceId: string,
  leaseId: string,
  expiresAtMs = Number.MAX_SAFE_INTEGER,
): TResourceDrainLease {
  return {
    resourceId,
    leaseId,
    leaseEpoch: 1,
    expiresAtMs,
    drainedUses: [{ id: leaseId, kind: 'function-invocation', state: 'drained' }],
  };
}

function consumer(args: Readonly<{
  id: string;
  drain?: (request: TResourceDrainRequest) => Promise<TResourceDrainResult>;
  inspect?: (resourceId: string) => Promise<Readonly<{ resourceId: string; uses: readonly TResourceUse[] }>>;
  release?: (drainLease: TResourceDrainLease, mode: 'resume' | 'hold') => Promise<Readonly<{
    resourceId: string;
    released: boolean;
    mode: 'resume' | 'hold';
    resumedUseIds: readonly string[];
  }>>;
}>): TResourceUseConsumer {
  return {
    inspectResourceUses: args.inspect ?? (async (resourceId) => ({ resourceId, uses: [] })),
    drainResourceUses: args.drain ?? (async (request) => ({
      ok: true,
      lease: lease(request.resourceId, `child-${args.id}`),
    })),
    releaseResourceUses: args.release ?? (async (drainLease, mode) => ({
      resourceId: drainLease.resourceId,
      released: true,
      mode,
      resumedUseIds: mode === 'resume' ? drainLease.drainedUses.map((use) => use.id) : [],
    })),
  };
}

describe('ResourceUseCoordinatorBridge', () => {
  test('fences altered, overlapping, unknown, and double-released leases', async () => {
    const bridge = new ResourceUseCoordinatorBridge({ nowMs: () => 100 });
    bridge.attach(consumer({ id: 'a' }));
    const drained = await bridge.drain(TENANT, {
      resourceId: 'resource-a',
      reason: 'schema_apply',
      timeoutMs: 1_000,
    });
    expect(drained.ok).toBe(true);
    if (!drained.ok) throw new Error('Expected a drain lease.');

    await expect(bridge.drain(TENANT, {
      resourceId: 'resource-a',
      reason: 'restore',
      timeoutMs: 1_000,
    })).rejects.toMatchObject({ code: 'RESOURCE_LIFECYCLE_CONFLICT' });
    await expect(bridge.release(TENANT, {
      ...drained.lease,
      resourceId: 'resource-b',
    }, 'resume')).rejects.toMatchObject({ code: 'RESOURCE_LIFECYCLE_CONFLICT' });
    await expect(bridge.release(TENANT, {
      ...drained.lease,
      leaseEpoch: drained.lease.leaseEpoch + 1,
    }, 'resume')).rejects.toMatchObject({ code: 'RESOURCE_LIFECYCLE_CONFLICT' });
    await expect(bridge.release(TENANT, {
      ...drained.lease,
      expiresAtMs: drained.lease.expiresAtMs - 1,
    }, 'resume')).rejects.toMatchObject({ code: 'RESOURCE_LIFECYCLE_CONFLICT' });

    await expect(bridge.release(TENANT, drained.lease, 'resume')).resolves.toMatchObject({
      resourceId: 'resource-a',
      released: true,
    });
    await expect(bridge.release(TENANT, drained.lease, 'resume')).rejects.toMatchObject({
      code: 'RESOURCE_LIFECYCLE_CONFLICT',
    });
    await expect(bridge.release(TENANT, lease('resource-a', 'unknown'), 'resume')).rejects.toMatchObject({
      code: 'RESOURCE_LIFECYCLE_CONFLICT',
    });
  });

  test('rejects an expired bridge lease without releasing a child under stale authority', async () => {
    let nowMs = 100;
    let releases = 0;
    const bridge = new ResourceUseCoordinatorBridge({ nowMs: () => nowMs });
    bridge.attach(consumer({
      id: 'a',
      drain: async (request) => ({ ok: true, lease: lease(request.resourceId, 'child-a', 150) }),
      release: async (drainLease, mode) => {
        releases += 1;
        return { resourceId: drainLease.resourceId, released: true, mode, resumedUseIds: [] };
      },
    }));
    const drained = await bridge.drain(TENANT, {
      resourceId: 'resource-a',
      reason: 'schema_apply',
      timeoutMs: 1_000,
    });
    expect(drained.ok).toBe(true);
    if (!drained.ok) throw new Error('Expected a drain lease.');

    nowMs = 150;
    await expect(bridge.release(TENANT, drained.lease, 'resume')).rejects.toMatchObject({
      code: 'RESOURCE_LIFECYCLE_CONFLICT',
    });
    expect(releases).toBe(0);
  });

  test('rolls back every already-drained consumer when a later consumer fails', async () => {
    const released: string[] = [];
    const bridge = new ResourceUseCoordinatorBridge();
    bridge.attach(consumer({
      id: 'a',
      release: async (drainLease, mode) => {
        released.push(`${drainLease.leaseId}:${mode}`);
        return { resourceId: drainLease.resourceId, released: true, mode, resumedUseIds: [] };
      },
    }));
    bridge.attach(consumer({
      id: 'b',
      drain: async () => { throw new Error('consumer failed'); },
    }));

    await expect(bridge.drain(TENANT, {
      resourceId: 'resource-a',
      reason: 'restore',
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ ok: false, code: 'RESOURCE_DRAIN_TIMEOUT' });
    expect(released).toEqual(['child-a:resume']);
  });

  test('rejects success at the exact deadline and rolls back every child', async () => {
    let nowMs = 100;
    const released: string[] = [];
    const bridge = new ResourceUseCoordinatorBridge({ nowMs: () => nowMs });
    bridge.attach(consumer({
      id: 'a',
      drain: async (request) => {
        nowMs = 110;
        return { ok: true, lease: lease(request.resourceId, 'child-a') };
      },
      release: async (drainLease, mode) => {
        released.push(`${drainLease.leaseId}:${mode}`);
        return { resourceId: drainLease.resourceId, released: true, mode, resumedUseIds: [] };
      },
    }));

    await expect(bridge.drain(TENANT, {
      resourceId: 'resource-a',
      reason: 'restore',
      timeoutMs: 10,
    })).resolves.toMatchObject({ ok: false, code: 'RESOURCE_DRAIN_TIMEOUT' });
    expect(released).toEqual(['child-a:resume']);
  });

  test('bounds the full drain and rolls back a consumer that completes after timeout', async () => {
    let resolveLate!: (result: TResourceDrainResult) => void;
    const late = new Promise<TResourceDrainResult>((resolve) => { resolveLate = resolve; });
    const released: string[] = [];
    const bridge = new ResourceUseCoordinatorBridge();
    const releasingConsumer = (id: string, drain?: TResourceUseConsumer['drainResourceUses']) => consumer({
      id,
      ...(drain ? { drain } : {}),
      release: async (drainLease, mode) => {
        released.push(`${drainLease.leaseId}:${mode}`);
        return { resourceId: drainLease.resourceId, released: true, mode, resumedUseIds: [] };
      },
    });
    bridge.attach(releasingConsumer('a'));
    bridge.attach(releasingConsumer('b', () => late));

    const result = await bridge.drain(TENANT, {
      resourceId: 'resource-a',
      reason: 'schema_apply',
      timeoutMs: 5,
    });
    expect(result).toMatchObject({ ok: false, code: 'RESOURCE_DRAIN_TIMEOUT' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(released).toContain('child-a:resume');

    resolveLate({ ok: true, lease: lease('resource-a', 'child-b') });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(released).toContain('child-b:resume');
  });

  test('bounds public inspection when a consumer never responds', async () => {
    const bridge = new ResourceUseCoordinatorBridge({ inspectionTimeoutMs: 5 });
    bridge.attach(consumer({
      id: 'a',
      inspect: () => new Promise(() => undefined),
    }));

    await expect(bridge.inspect(TENANT, 'resource-a')).rejects.toMatchObject({
      code: 'RESOURCE_DRAIN_TIMEOUT',
    });
  });

  test('rejects a child lease for a different resource and resumes it best-effort', async () => {
    const released: string[] = [];
    const bridge = new ResourceUseCoordinatorBridge();
    bridge.attach(consumer({
      id: 'a',
      drain: async () => ({ ok: true, lease: lease('resource-b', 'child-a') }),
      release: async (drainLease, mode) => {
        released.push(`${drainLease.resourceId}:${mode}`);
        return { resourceId: drainLease.resourceId, released: true, mode, resumedUseIds: [] };
      },
    }));

    await expect(bridge.drain(TENANT, {
      resourceId: 'resource-a',
      reason: 'schema_apply',
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ ok: false, code: 'RESOURCE_DRAIN_TIMEOUT' });
    expect(released).toEqual(['resource-b:resume']);
  });

  test('releases stored child leases after their consumer detaches', async () => {
    const released: string[] = [];
    const bridge = new ResourceUseCoordinatorBridge({ nowMs: () => 100 });
    const detach = bridge.attach(consumer({
      id: 'a',
      release: async (drainLease, mode) => {
        released.push(`${drainLease.leaseId}:${mode}`);
        return { resourceId: drainLease.resourceId, released: true, mode, resumedUseIds: [] };
      },
    }));
    const drained = await bridge.drain(TENANT, {
      resourceId: 'resource-a',
      reason: 'restore',
      timeoutMs: 1_000,
    });
    expect(drained.ok).toBe(true);
    if (!drained.ok) throw new Error('Expected a drain lease.');

    detach();
    await bridge.release(TENANT, drained.lease, 'resume');
    expect(released).toEqual(['child-a:resume']);
  });

  test('retains only failed child leases for a fenced same-mode release retry', async () => {
    const attempts = new Map<string, number>();
    const bridge = new ResourceUseCoordinatorBridge({ nowMs: () => 100 });
    const retryingConsumer = (id: string, failFirst: boolean) => consumer({
      id,
      release: async (drainLease, mode) => {
        const attempt = (attempts.get(id) ?? 0) + 1;
        attempts.set(id, attempt);
        if (failFirst && attempt === 1) throw new Error('temporary release failure');
        return {
          resourceId: drainLease.resourceId,
          released: true,
          mode,
          resumedUseIds: [`${id}-resumed`],
        };
      },
    });
    bridge.attach(retryingConsumer('a', false));
    bridge.attach(retryingConsumer('b', true));
    const drained = await bridge.drain(TENANT, {
      resourceId: 'resource-a',
      reason: 'schema_apply',
      timeoutMs: 1_000,
    });
    expect(drained.ok).toBe(true);
    if (!drained.ok) throw new Error('Expected a drain lease.');

    await expect(bridge.release(TENANT, drained.lease, 'resume')).rejects.toMatchObject({
      code: 'RESOURCE_PROVIDER_UNAVAILABLE',
    });
    expect(Object.fromEntries(attempts)).toEqual({ a: 1, b: 1 });
    await expect(bridge.release(TENANT, drained.lease, 'hold')).rejects.toMatchObject({
      code: 'RESOURCE_LIFECYCLE_CONFLICT',
    });
    expect(Object.fromEntries(attempts)).toEqual({ a: 1, b: 1 });

    await expect(bridge.release(TENANT, drained.lease, 'resume')).resolves.toEqual({
      resourceId: 'resource-a',
      released: true,
      mode: 'resume',
      resumedUseIds: ['a-resumed', 'b-resumed'],
    });
    expect(Object.fromEntries(attempts)).toEqual({ a: 1, b: 2 });
    await expect(bridge.release(TENANT, drained.lease, 'resume')).rejects.toMatchObject({
      code: 'RESOURCE_LIFECYCLE_CONFLICT',
    });
  });
});
