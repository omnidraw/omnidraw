import { describe, expect, test } from 'bun:test';
import { WidgetRuntimeLoadAdmission } from '../src/shell/widget/WidgetRuntimeLoadAdmission';

function deferred(): Readonly<{ promise: Promise<void>; resolve(): void }> {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function expectedDiagnostics(
  activeLoadsGlobal = 0,
  activeCleanupGlobal = 0,
) {
  return {
    activeGlobal: activeLoadsGlobal + activeCleanupGlobal,
    activeLoadsGlobal,
    activeCleanupGlobal,
  };
}

describe('WidgetRuntimeLoadAdmission', () => {
  test('enforces the global concurrency limit and reclaims settled leases', async () => {
    const admission = new WidgetRuntimeLoadAdmission({
      maxGlobal: 2,
      deadlineMs: 10_000,
    });
    const gateA = deferred();
    const gateB = deferred();
    const activeA = admission.run(undefined, async () => gateA.promise);
    const activeB = admission.run(undefined, async () => gateB.promise);

    await expect(admission.run(undefined, async () => undefined)).rejects.toMatchObject({
      code: 'WIDGET_RUNTIME_LOAD_CAPACITY',
    });
    expect(admission.diagnostics()).toEqual(expectedDiagnostics(2));

    gateA.resolve();
    await activeA;
    await expect(admission.run(undefined, async () => 'ready')).resolves.toBe('ready');
    expect(admission.diagnostics()).toEqual(expectedDiagnostics(1));
    gateB.resolve();
    await activeB;
    expect(admission.diagnostics()).toEqual(expectedDiagnostics());
  });

  test('rejects callers at cancellation or deadline while retaining the lease until work settles', async () => {
    const admission = new WidgetRuntimeLoadAdmission({
      maxGlobal: 1,
      deadlineMs: 20,
    });
    const gate = deferred();
    let lifetimeSignal: AbortSignal | undefined;
    const timedOut = admission.run(undefined, async (signal) => {
      lifetimeSignal = signal;
      await gate.promise;
      return 'late';
    });
    const timedOutAssertion = expect(timedOut).rejects.toMatchObject({
      code: 'WIDGET_RUNTIME_LOAD_TIMEOUT',
    });

    await timedOutAssertion;
    expect(lifetimeSignal?.aborted).toBe(true);
    expect(admission.diagnostics()).toEqual(expectedDiagnostics(1));
    await expect(admission.run(undefined, async () => undefined)).rejects.toMatchObject({
      code: 'WIDGET_RUNTIME_LOAD_CAPACITY',
    });

    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(admission.diagnostics()).toEqual(expectedDiagnostics());

    const cancelAdmission = new WidgetRuntimeLoadAdmission({
      maxGlobal: 1,
      deadlineMs: 10_000,
    });
    const request = new AbortController();
    const cancelGate = deferred();
    const cancelled = cancelAdmission.run(
      request.signal,
      async () => cancelGate.promise,
    );
    await Promise.resolve();
    request.abort();
    await expect(cancelled).rejects.toMatchObject({
      code: 'WIDGET_RUNTIME_LOAD_CANCELLED',
    });
    expect(cancelAdmission.diagnostics()).toEqual(expectedDiagnostics(1));
    cancelGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelAdmission.diagnostics()).toEqual(expectedDiagnostics());

    request.abort();
    await expect(cancelAdmission.run(request.signal, async () => 'unreachable'))
      .rejects.toMatchObject({ code: 'WIDGET_RUNTIME_LOAD_CANCELLED' });
  });

  test('transfers an admitted lease to cleanup without delaying the response', async () => {
    const admission = new WidgetRuntimeLoadAdmission({
      maxGlobal: 1,
      deadlineMs: 10_000,
    });
    const cleanupGate = deferred();

    await expect(admission.run(
      undefined,
      async (_signal, deferCleanup) => {
        deferCleanup(() => cleanupGate.promise);
        return 'authorized';
      },
    )).resolves.toBe('authorized');
    expect(admission.diagnostics()).toEqual(expectedDiagnostics(0, 1));
    await expect(admission.run(undefined, async () => 'unreachable'))
      .rejects.toMatchObject({ code: 'WIDGET_RUNTIME_LOAD_CAPACITY' });

    cleanupGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(admission.diagnostics()).toEqual(expectedDiagnostics());
    await expect(admission.run(undefined, async () => 'ready'))
      .resolves.toBe('ready');
  });

  test('observes failed cleanup and releases its retained capacity lease', async () => {
    const admission = new WidgetRuntimeLoadAdmission({
      maxGlobal: 1,
      deadlineMs: 10_000,
    });

    await expect(admission.run(
      undefined,
      async (_signal, deferCleanup) => {
        deferCleanup(async () => { throw new Error('release failed'); });
        return 'authorized';
      },
    )).resolves.toBe('authorized');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(admission.diagnostics()).toEqual(expectedDiagnostics());
    await expect(admission.run(undefined, async () => 'ready'))
      .resolves.toBe('ready');
  });

  test('enforces and reclaims the production 64 global cleanup limit', async () => {
    const admission = new WidgetRuntimeLoadAdmission();
    const cleanupGates: Array<ReturnType<typeof deferred>> = [];
    const loadTarget = (target: string) => admission.run(
      undefined,
      async (_signal, deferCleanup) => {
        const cleanupGate = deferred();
        cleanupGates.push(cleanupGate);
        deferCleanup(() => cleanupGate.promise);
        return target;
      },
    );

    for (let index = 0; index < 64; index += 1) {
      await expect(loadTarget(`canvas-${index}`)).resolves.toBe(`canvas-${index}`);
    }
    await expect(loadTarget('canvas-64')).rejects.toMatchObject({
      code: 'WIDGET_RUNTIME_LOAD_CAPACITY',
    });

    expect(cleanupGates).toHaveLength(64);
    expect(admission.diagnostics()).toEqual(expectedDiagnostics(0, 64));

    for (const cleanupGate of cleanupGates) cleanupGate.resolve();
    await Promise.all(cleanupGates.map((cleanupGate) => cleanupGate.promise));
    await Promise.resolve();
    expect(admission.diagnostics()).toEqual(expectedDiagnostics());
    await expect(admission.run(undefined, async () => 'ready'))
      .resolves.toBe('ready');
  });

  test('bounds never-settling cleanup promises', async () => {
    const admission = new WidgetRuntimeLoadAdmission({
      maxGlobal: 2,
      deadlineMs: 10_000,
    });
    const neverSettles = new Promise<void>(() => {});
    let cleanupStarts = 0;
    const loadSameTarget = () => admission.run(
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
    expect(admission.diagnostics()).toEqual(expectedDiagnostics(0, 2));
  });
});
