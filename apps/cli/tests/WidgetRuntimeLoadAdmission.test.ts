import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@omnidraw/tenant-core';
import { WidgetRuntimeLoadAdmission } from '../src/services/WidgetRuntimeLoadAdmission';

function tenant(orgId: string, accountId: string): TTenantContext {
  return Object.freeze({
    orgId,
    accountId,
    cellId: 'cell-a',
    placementEpoch: 1,
    roles: Object.freeze(['member']),
    capabilities: Object.freeze(['canvas:read']),
    requestId: `${orgId}:${accountId}`,
  });
}

function deferred(): Readonly<{ promise: Promise<void>; resolve(): void }> {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function expectedDiagnostics(
  activeLoadOrganizations: Readonly<Record<string, number>> = {},
  activeCleanupOrganizations: Readonly<Record<string, number>> = {},
) {
  const activeLoadsGlobal = Object.values(activeLoadOrganizations)
    .reduce((total, count) => total + count, 0);
  const activeCleanupGlobal = Object.values(activeCleanupOrganizations)
    .reduce((total, count) => total + count, 0);
  const activeOrganizations: Record<string, number> = { ...activeLoadOrganizations };
  for (const [orgId, count] of Object.entries(activeCleanupOrganizations)) {
    activeOrganizations[orgId] = (activeOrganizations[orgId] ?? 0) + count;
  }
  return {
    activeGlobal: activeLoadsGlobal + activeCleanupGlobal,
    activeOrganizations,
    activeLoadsGlobal,
    activeLoadOrganizations,
    activeCleanupGlobal,
    activeCleanupOrganizations,
  };
}

describe('WidgetRuntimeLoadAdmission', () => {
  test('enforces global and organization concurrency without retaining zero-count keys', async () => {
    const admission = new WidgetRuntimeLoadAdmission({
      maxGlobal: 2,
      maxPerOrganization: 1,
      deadlineMs: 10_000,
    });
    const tenantA = tenant('org-a', 'account-a');
    const tenantB = tenant('org-b', 'account-b');
    const tenantC = tenant('org-c', 'account-c');
    const gateA = deferred();
    const gateB = deferred();
    const activeA = admission.run(tenantA, undefined, async () => gateA.promise);

    await expect(admission.run(tenantA, undefined, async () => undefined)).rejects.toMatchObject({
      code: 'WIDGET_RUNTIME_LOAD_CAPACITY',
    });
    const activeB = admission.run(tenantB, undefined, async () => gateB.promise);
    await expect(admission.run(tenantC, undefined, async () => undefined)).rejects.toMatchObject({
      code: 'WIDGET_RUNTIME_LOAD_CAPACITY',
    });
    expect(admission.diagnostics()).toEqual(expectedDiagnostics({
      'org-a': 1,
      'org-b': 1,
    }));

    gateA.resolve();
    await activeA;
    await expect(admission.run(tenantC, undefined, async () => 'ready')).resolves.toBe('ready');
    expect(admission.diagnostics()).toEqual(expectedDiagnostics({ 'org-b': 1 }));
    gateB.resolve();
    await activeB;
    expect(admission.diagnostics()).toEqual(expectedDiagnostics());
  });

  test('rejects callers at cancellation or deadline while retaining the lease until work settles', async () => {
    const admission = new WidgetRuntimeLoadAdmission({
      maxGlobal: 1,
      maxPerOrganization: 1,
      deadlineMs: 20,
    });
    const currentTenant = tenant('org-a', 'account-a');
    const gate = deferred();
    let lifetimeSignal: AbortSignal | undefined;
    const timedOut = admission.run(currentTenant, undefined, async (signal) => {
      lifetimeSignal = signal;
      await gate.promise;
      return 'late';
    });
    const timedOutAssertion = expect(timedOut).rejects.toMatchObject({
      code: 'WIDGET_RUNTIME_LOAD_TIMEOUT',
    });

    await timedOutAssertion;
    expect(lifetimeSignal?.aborted).toBe(true);
    expect(admission.diagnostics()).toEqual(expectedDiagnostics({ 'org-a': 1 }));
    await expect(admission.run(currentTenant, undefined, async () => undefined)).rejects.toMatchObject({
      code: 'WIDGET_RUNTIME_LOAD_CAPACITY',
    });

    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(admission.diagnostics()).toEqual(expectedDiagnostics());

    const cancelAdmission = new WidgetRuntimeLoadAdmission({
      maxGlobal: 1,
      maxPerOrganization: 1,
      deadlineMs: 10_000,
    });
    const request = new AbortController();
    const cancelGate = deferred();
    const cancelled = cancelAdmission.run(
      currentTenant,
      request.signal,
      async () => cancelGate.promise,
    );
    await Promise.resolve();
    request.abort();
    await expect(cancelled).rejects.toMatchObject({
      code: 'WIDGET_RUNTIME_LOAD_CANCELLED',
    });
    expect(cancelAdmission.diagnostics()).toEqual(expectedDiagnostics({ 'org-a': 1 }));
    cancelGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelAdmission.diagnostics()).toEqual(expectedDiagnostics());

    request.abort();
    await expect(cancelAdmission.run(currentTenant, request.signal, async () => 'unreachable'))
      .rejects.toMatchObject({ code: 'WIDGET_RUNTIME_LOAD_CANCELLED' });
  });

  test('transfers an admitted lease to cleanup without delaying the response', async () => {
    const admission = new WidgetRuntimeLoadAdmission({
      maxGlobal: 1,
      maxPerOrganization: 1,
      deadlineMs: 10_000,
    });
    const currentTenant = tenant('org-a', 'account-a');
    const cleanupGate = deferred();

    await expect(admission.run(
      currentTenant,
      undefined,
      async (_signal, deferCleanup) => {
        deferCleanup(() => cleanupGate.promise);
        return 'authorized';
      },
    )).resolves.toBe('authorized');
    expect(admission.diagnostics()).toEqual(expectedDiagnostics({}, { 'org-a': 1 }));
    await expect(admission.run(currentTenant, undefined, async () => 'unreachable'))
      .rejects.toMatchObject({ code: 'WIDGET_RUNTIME_LOAD_CAPACITY' });

    cleanupGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(admission.diagnostics()).toEqual(expectedDiagnostics());
    await expect(admission.run(currentTenant, undefined, async () => 'ready'))
      .resolves.toBe('ready');
  });

  test('observes failed cleanup and releases its retained capacity lease', async () => {
    const admission = new WidgetRuntimeLoadAdmission({
      maxGlobal: 1,
      maxPerOrganization: 1,
      deadlineMs: 10_000,
    });
    const currentTenant = tenant('org-a', 'account-a');

    await expect(admission.run(
      currentTenant,
      undefined,
      async (_signal, deferCleanup) => {
        deferCleanup(async () => { throw new Error('release failed'); });
        return 'authorized';
      },
    )).resolves.toBe('authorized');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(admission.diagnostics()).toEqual(expectedDiagnostics());
    await expect(admission.run(currentTenant, undefined, async () => 'ready'))
      .resolves.toBe('ready');
  });

  test('enforces and reclaims the production 64 global and 32 organization cleanup limits', async () => {
    const admission = new WidgetRuntimeLoadAdmission();
    const tenantA = tenant('org-a', 'account-a');
    const tenantB = tenant('org-b', 'account-b');
    const tenantC = tenant('org-c', 'account-c');
    const cleanupGates: Array<ReturnType<typeof deferred>> = [];
    const loadTarget = (currentTenant: TTenantContext, target: string) => admission.run(
      currentTenant,
      undefined,
      async (_signal, deferCleanup) => {
        const cleanupGate = deferred();
        cleanupGates.push(cleanupGate);
        deferCleanup(() => cleanupGate.promise);
        return target;
      },
    );

    for (let index = 0; index < 32; index += 1) {
      await expect(loadTarget(tenantA, `canvas-a-${index}`)).resolves.toBe(`canvas-a-${index}`);
    }
    await expect(loadTarget(tenantA, 'canvas-a-32')).rejects.toMatchObject({
      code: 'WIDGET_RUNTIME_LOAD_CAPACITY',
    });
    for (let index = 0; index < 32; index += 1) {
      await expect(loadTarget(tenantB, `canvas-b-${index}`)).resolves.toBe(`canvas-b-${index}`);
    }
    await expect(loadTarget(tenantC, 'canvas-c-0')).rejects.toMatchObject({
      code: 'WIDGET_RUNTIME_LOAD_CAPACITY',
    });

    expect(cleanupGates).toHaveLength(64);
    expect(admission.diagnostics()).toEqual(expectedDiagnostics({}, {
      'org-a': 32,
      'org-b': 32,
    }));

    for (const cleanupGate of cleanupGates) cleanupGate.resolve();
    await Promise.all(cleanupGates.map((cleanupGate) => cleanupGate.promise));
    await Promise.resolve();
    expect(admission.diagnostics()).toEqual(expectedDiagnostics());
    await expect(admission.run(tenantC, undefined, async () => 'ready'))
      .resolves.toBe('ready');
  });

  test('bounds never-settling cleanup churn across unique targets', async () => {
    const admission = new WidgetRuntimeLoadAdmission({
      maxGlobal: 3,
      maxPerOrganization: 2,
      deadlineMs: 10_000,
    });
    const tenantA = tenant('org-a', 'account-a');
    const tenantB = tenant('org-b', 'account-b');
    const tenantC = tenant('org-c', 'account-c');
    const neverSettles = new Promise<void>(() => {});
    const startedTargets: string[] = [];
    const loadTarget = (currentTenant: TTenantContext, target: string) => admission.run(
      currentTenant,
      undefined,
      async (_signal, deferCleanup) => {
        deferCleanup(() => {
          startedTargets.push(target);
          return neverSettles;
        });
        return target;
      },
    );

    for (let index = 0; index < 2; index += 1) {
      await expect(loadTarget(tenantA, `canvas-a-${index}`)).resolves.toBe(`canvas-a-${index}`);
    }
    for (let index = 2; index < 66; index += 1) {
      await expect(loadTarget(tenantA, `canvas-a-${index}`)).rejects.toMatchObject({
        code: 'WIDGET_RUNTIME_LOAD_CAPACITY',
      });
    }
    await expect(loadTarget(tenantB, 'canvas-b-0')).resolves.toBe('canvas-b-0');
    for (let index = 0; index < 64; index += 1) {
      await expect(loadTarget(tenantC, `canvas-c-${index}`)).rejects.toMatchObject({
        code: 'WIDGET_RUNTIME_LOAD_CAPACITY',
      });
    }

    expect(startedTargets).toEqual(['canvas-a-0', 'canvas-a-1', 'canvas-b-0']);
    expect(admission.diagnostics()).toEqual(expectedDiagnostics({}, {
      'org-a': 2,
      'org-b': 1,
    }));
  });

  test('bounds never-settling duplicate-target cleanup promises', async () => {
    const admission = new WidgetRuntimeLoadAdmission({
      maxGlobal: 2,
      maxPerOrganization: 2,
      deadlineMs: 10_000,
    });
    const currentTenant = tenant('org-a', 'account-a');
    const neverSettles = new Promise<void>(() => {});
    let cleanupStarts = 0;
    const loadSameTarget = () => admission.run(
      currentTenant,
      undefined,
      async (_signal, deferCleanup) => {
        deferCleanup(() => {
          cleanupStarts += 1;
          return neverSettles;
        });
        return 'canvas-a';
      },
    );

    await expect(loadSameTarget()).resolves.toBe('canvas-a');
    await expect(loadSameTarget()).resolves.toBe('canvas-a');
    for (let index = 0; index < 128; index += 1) {
      await expect(loadSameTarget()).rejects.toMatchObject({
        code: 'WIDGET_RUNTIME_LOAD_CAPACITY',
      });
    }

    expect(cleanupStarts).toBe(2);
    expect(admission.diagnostics()).toEqual(expectedDiagnostics({}, { 'org-a': 2 }));
  });
});
