import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { describe, expect, test, vi } from 'vitest';
import type { TWidgetFrameNode } from '@omnidraw/cangine';
import { CANVAS_WIDGET_EXTENSION_KEY } from '@omnidraw/canvas-contract';
import { WidgetUiArtifactCache } from '../../src/widget-runtime/WidgetUiArtifactCache';
import { WidgetUiRuntime } from '../../src/widget-runtime/WidgetUiRuntime';
import type {
  TWidgetCollaborativeStatePort,
  TWidgetCollaborativeStateSession,
  TWidgetRuntimeIdentity,
  TWidgetRuntimeLocalTarget,
  TWidgetRuntimeTransportPort,
  TWidgetUiRuntimeHandle,
} from '../../src/widget-runtime/interface';

const CAPSULE_HASH = `sha256:${'a'.repeat(64)}` as const;
const CAPSULE_BUNDLE_DIGEST = `sha256:${'b'.repeat(64)}` as const;
const identity: TWidgetRuntimeIdentity = Object.freeze({
  orgId: 'org-a',
  canvasId: 'canvas-a',
  elementId: 'element-a',
  widgetInstanceId: 'instance-a',
  definitionId: 'definition-a',
  revisionId: 'revision-a',
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function element(
  candidate: TWidgetRuntimeIdentity = identity,
  uiProps?: Record<string, unknown>,
): TWidgetFrameNode {
  return {
    id: candidate.elementId,
    kind: 'widget-frame',
    parentId: null,
    orderKey: 'a0',
    transform: {
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
    size: { width: 320, height: 240 },
    portal: { portalId: `portal:${candidate.elementId}` },
    extensions: {
      [CANVAS_WIDGET_EXTENSION_KEY]: {
        schemaVersion: 1,
        type: 'widget-instance',
        definitionId: candidate.definitionId,
        revisionId: candidate.revisionId,
        instanceId: candidate.widgetInstanceId,
        ...(uiProps === undefined ? {} : { uiProps }),
      },
    },
  };
}

function runtimeHandle() {
  const destroy = vi.fn(async () => undefined);
  const freeze = vi.fn(async () => undefined);
  const resume = vi.fn(async () => undefined);
  const setSchedulingMode = vi.fn(async () => undefined);
  const handle: TWidgetUiRuntimeHandle = {
    ready: vi.fn(async () => undefined),
    setProps: vi.fn(),
    setTheme: vi.fn(),
    setViewport: vi.fn(),
    focus: vi.fn(),
    freeze,
    resume,
    setSchedulingMode,
    diagnostics: vi.fn(() => ({ artifactHash: CAPSULE_HASH }) as never),
    destroy,
  };
  return { destroy, freeze, handle, resume, setSchedulingMode };
}

function manualClock() {
  let nowMs = 0;
  let nextTimer = 1;
  const timers = new Map<number, Readonly<{
    atMs: number;
    callback: () => void;
  }>>();
  const setTimeout = vi.fn((callback: () => void, timeoutMs: number): number => {
    const timer = nextTimer;
    nextTimer += 1;
    timers.set(timer, {
      atMs: nowMs + timeoutMs,
      callback,
    });
    return timer;
  });
  const clearTimeout = vi.fn((timer: unknown): void => {
    if (typeof timer === 'number') timers.delete(timer);
  });
  return {
    now: () => nowMs,
    setTimeout,
    clearTimeout,
    async advanceBy(durationMs: number): Promise<void> {
      nowMs += durationMs;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.atMs <= nowMs)
          .sort((left, right) => left[1].atMs - right[1].atMs)[0];
        if (due === undefined) return;
        timers.delete(due[0]);
        due[1].callback();
        await Promise.resolve();
      }
    },
  };
}

function fixture(args: Readonly<{
  cache?: WidgetUiArtifactCache;
  clock?: ReturnType<typeof manualClock>;
  collaborativeState?: TWidgetCollaborativeStatePort;
  collaborativeStateEnabled?: boolean;
  apis?: readonly ('DOM' | 'CANVAS_2D' | 'WEBGL' | 'WEBGPU')[];
  organizationId?: () => string;
  tenantAuthorityKey?: () => string;
  isTargetCurrent?(target: TWidgetRuntimeLocalTarget): boolean;
  maxConcurrentLoads?: number;
  maxQueuedLoads?: number;
  digestSha256?(bytes: Uint8Array): Promise<string>;
  load?: TWidgetRuntimeTransportPort['api']['widget']['runtime']['load'];
}> = {}) {
  const bytes = new Uint8Array([9, 8, 7, 6]);
  const apis = Object.freeze([...(args.apis ?? ['DOM' as const])]);
  const response = {
    identity: {
      canvasId: identity.canvasId,
      elementId: identity.elementId,
      widgetInstanceId: identity.widgetInstanceId,
      definitionId: identity.definitionId,
      revisionId: identity.revisionId,
    },
    manifest: {
      schemaVersion: 3 as const,
      name: 'Pinned widget',
      slug: 'pinned-widget',
      ui: {
        runtime: 'capsule' as const,
        entry: 'ui/main.ts',
        apis,
        ...(args.collaborativeStateEnabled === true
          ? {
              state: {
                collaborative: true,
                localStore: 'none' as const,
              },
            }
          : {}),
      },
    },
    artifact: {
      digestSha256: digest(bytes),
      byteSize: bytes.byteLength,
      bytesBase64: Buffer.from(bytes).toString('base64'),
    },
    runtimeDescriptor: {
      format: 'omnidraw.capsule-runtime.v2' as const,
      capsuleArtifactHash: CAPSULE_HASH,
      apiContract: {
        format: 'capsule-api-groups-v1' as const,
        groups: apis,
        bundleDigest: CAPSULE_BUNDLE_DIGEST,
      },
      budgets: {},
      capabilityRequests: [],
      channels: null,
      parkability: { parkable: false as const },
      signatureKeyIds: ['release-key'],
    },
    functionDescriptors: [],
    browserFunctionDescriptorsDigestSha256: 'e'.repeat(64),
  };
  const load = args.load ?? vi.fn(async () => [undefined, response] as never);
  const mounted = runtimeHandle();
  const mountedHandles: ReturnType<typeof runtimeHandle>[] = [];
  const mount = vi.fn(async () => {
    const next = mountedHandles.length === 0 ? mounted : runtimeHandle();
    mountedHandles.push(next);
    return next.handle;
  });
  const destroyMount = vi.fn(async () => undefined);
  const digestSha256 = vi.fn(args.digestSha256 ?? (async (value) => digest(value)));
  const clock = args.clock ?? manualClock();
  const runtime = new WidgetUiRuntime({
    transport: {
      api: {
        widget: { runtime: { load } },
        function: { invoke: vi.fn(), get: vi.fn() },
      },
    } as unknown as TWidgetRuntimeTransportPort,
    codec: {
      decodeBase64: (value) => Buffer.from(value, 'base64'),
      digestSha256,
    },
    mount: { mount, destroy: destroyMount },
    createIdempotencyKey: () => 'host-key',
    organizationId: args.organizationId ?? (() => identity.orgId),
    tenantAuthorityKey: args.tenantAuthorityKey ?? (() => 'authority-a'),
    nowMs: clock.now,
    scheduleTimeout: clock.setTimeout,
    cancelTimeout: clock.clearTimeout,
    wait: async () => undefined,
    cache: args.cache,
    collaborativeState: args.collaborativeState,
    isTargetCurrent: args.isTargetCurrent,
    maxConcurrentLoads: args.maxConcurrentLoads,
    maxQueuedLoads: args.maxQueuedLoads,
  });
  return {
    bytes,
    clock,
    destroyMount,
    digestSha256,
    load,
    mount,
    mounted,
    mountedHandles,
    response,
    runtime,
  };
}

async function renderReady(
  runtime: WidgetUiRuntime,
  uiProps?: Record<string, unknown>,
) {
  const root = document.createElement('div');
  const cleanup = runtime.render({
    root,
    canvasId: identity.canvasId,
    element: element(identity, uiProps),
  });
  await vi.waitFor(() => expect(root.dataset.widgetRuntimeStatus).toBe('ready'));
  return { cleanup, root };
}

function collaborativeSession(): TWidgetCollaborativeStateSession {
  return {
    identity,
    get: vi.fn(async () => ({ version: 1, value: null })),
    change: vi.fn(),
    next: vi.fn(),
    cancel: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('WidgetUiRuntime Capsule ownership', () => {
  test('removes the loading message after the Capsule mount appends its shell', async () => {
    const current = fixture();
    current.mount.mockImplementationOnce(async (args) => {
      const shell = args.root.ownerDocument.createElement('div');
      shell.textContent = 'Mounted widget';
      args.root.append(shell);
      current.mountedHandles.push(current.mounted);
      return current.mounted.handle;
    });

    const rendered = await renderReady(current.runtime);

    expect(rendered.root.textContent).toBe('Mounted widget');
    rendered.cleanup();
    await current.runtime.destroy();
  });

  test('mounts the persisted widget-instance UI props as the initial channel value', async () => {
    const current = fixture();
    const rendered = await renderReady(
      current.runtime,
      { count: 1, label: 'initial' },
    );

    expect(current.mount).toHaveBeenCalledWith(expect.objectContaining({
      props: { count: 1, label: 'initial' },
      browserFunctionDescriptorsDigestSha256: 'e'.repeat(64),
    }));
    expect(current.mounted.handle.setProps).toHaveBeenCalledWith({
      count: 1,
      label: 'initial',
    });
    rendered.cleanup();
    await current.runtime.destroy();
  });

  test('remounts an owner after its shared host catalog is invalidated', async () => {
    const current = fixture();
    const rendered = await renderReady(current.runtime);
    const onFatal = current.mount.mock.calls[0]![0].onFatal;

    onFatal(Object.assign(new Error('catalog changed'), {
      code: 'WIDGET_CAPSULE_CATALOG_INVALIDATED',
      reason: 'catalog-generation-changed',
    }));

    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledTimes(2));
    expect(current.mountedHandles[0]!.destroy).toHaveBeenCalledWith(
      'catalog-generation-changed',
    );
    expect(rendered.root.dataset.widgetRuntimeStatus).toBe('ready');

    rendered.cleanup();
    await current.runtime.destroy();
  });

  test('renders the product-safe message from a mapped Capsule error', async () => {
    const current = fixture();
    const rendered = await renderReady(current.runtime);
    const onFatal = current.mount.mock.calls[0]![0].onFatal;

    onFatal({
      format: 'omnidraw.capsule-error.v1',
      phase: 'runtime',
      category: 'guest',
      capsuleCode: 'CALL_FAILED',
      fatal: true,
      message: 'The widget runtime failed.',
    });

    expect(rendered.root.dataset.widgetRuntimeStatus).toBe('error');
    expect(rendered.root.textContent).toBe('The widget runtime failed.');
    rendered.cleanup();
    await current.runtime.destroy();
  });

  test('caches exact opaque signed bytes by revision, digest, and Capsule hash', async () => {
    const cache = new WidgetUiArtifactCache();
    const current = fixture({ cache });
    const first = await renderReady(current.runtime);
    first.cleanup();
    await vi.waitFor(() => expect(current.mounted.destroy).toHaveBeenCalledOnce());
    const second = await renderReady(current.runtime);

    expect(current.digestSha256).toHaveBeenCalledOnce();
    expect(current.mount).toHaveBeenCalledTimes(2);
    expect(current.mount.mock.calls[0]![0].artifact.bytes).toEqual(current.bytes);
    expect(current.mount.mock.calls[0]![0].artifact.runtimeDescriptor)
      .toBe(current.response.runtimeDescriptor);
    second.cleanup();
    await current.runtime.destroy();
  });

  test('does not reuse decoded artifact bytes across tenant-authority generations', async () => {
    let authority = 'authority-a';
    const current = fixture({
      cache: new WidgetUiArtifactCache(),
      tenantAuthorityKey: () => authority,
    });
    const first = await renderReady(current.runtime);
    first.cleanup();
    await vi.waitFor(() => expect(current.mounted.destroy).toHaveBeenCalledOnce());
    authority = 'authority-b';
    const second = await renderReady(current.runtime);

    expect(current.digestSha256).toHaveBeenCalledTimes(2);
    second.cleanup();
    await current.runtime.destroy();
  });

  test('coalesces concurrent exact-byte decoding without limiting live handles', async () => {
    let resolveDigest!: (value: string) => void;
    const current = fixture({
      digestSha256: async () => await new Promise((resolve) => {
        resolveDigest = resolve;
      }),
      maxConcurrentLoads: 2,
    });
    const firstRoot = document.createElement('div');
    const secondRoot = document.createElement('div');
    const firstCleanup = current.runtime.render({
      root: firstRoot,
      canvasId: identity.canvasId,
      element: element(),
    });
    const secondCleanup = current.runtime.render({
      root: secondRoot,
      canvasId: identity.canvasId,
      element: element(),
    });
    await vi.waitFor(() => expect(current.digestSha256).toHaveBeenCalledOnce());
    resolveDigest(current.response.artifact.digestSha256);
    await vi.waitFor(() => {
      expect(firstRoot.dataset.widgetRuntimeStatus).toBe('ready');
      expect(secondRoot.dataset.widgetRuntimeStatus).toBe('ready');
    });
    expect(current.runtime.diagnostics()).toMatchObject({
      activeLoadCount: 0,
      queuedLoadCount: 0,
      mountedOwnerCount: 2,
    });
    firstCleanup();
    secondCleanup();
    await current.runtime.destroy();
  });

  test('wakes one overflowed owner when an earlier queued owner is destroyed', async () => {
    const digestGate = deferred<string>();
    const current = fixture({
      digestSha256: async () => await digestGate.promise,
      maxConcurrentLoads: 1,
      maxQueuedLoads: 1,
    });
    const roots = [0, 1, 2].map(() => document.createElement('div'));
    const owners = roots.map((root) => current.runtime.renderOwned({
      root,
      canvasId: identity.canvasId,
      element: element(),
    }));
    expect(roots[2]!.dataset.widgetRuntimeStatus).toBe('deferred');
    await vi.waitFor(() => {
      expect(current.runtime.diagnostics()).toMatchObject({
        activeLoadCount: 1,
        queuedLoadCount: 1,
      });
    });
    await owners[1]!.destroy();
    await vi.waitFor(() => {
      expect(current.runtime.diagnostics()).toMatchObject({
        activeLoadCount: 1,
        queuedLoadCount: 1,
        mountedOwnerCount: 2,
      });
    });

    await owners[2]!.resume('still-visible');
    await owners[2]!.resume('duplicate-visible-hint');
    expect(current.load).toHaveBeenCalledOnce();
    digestGate.resolve(current.response.artifact.digestSha256);
    await vi.waitFor(() => {
      expect(roots[0]!.dataset.widgetRuntimeStatus).toBe('ready');
      expect(roots[2]!.dataset.widgetRuntimeStatus).toBe('ready');
    });
    expect(current.load).toHaveBeenCalledTimes(2);
    expect(current.mount).toHaveBeenCalledTimes(2);
    expect(current.runtime.diagnostics()).toMatchObject({
      activeLoadCount: 0,
      queuedLoadCount: 0,
      mountedOwnerCount: 2,
    });
    await owners[0]!.destroy();
    await owners[2]!.destroy();
    await current.runtime.destroy();
  });

  test('keeps an overflowed hidden owner passive until visibility resumes', async () => {
    const digestGate = deferred<string>();
    const current = fixture({
      digestSha256: async () => await digestGate.promise,
      maxConcurrentLoads: 1,
      maxQueuedLoads: 0,
    });
    const firstRoot = document.createElement('div');
    const hiddenRoot = document.createElement('div');
    const first = current.runtime.renderOwned({
      root: firstRoot,
      canvasId: identity.canvasId,
      element: element(),
    });
    const hidden = current.runtime.renderOwned({
      root: hiddenRoot,
      canvasId: identity.canvasId,
      element: element(),
    });
    hidden.setViewport({
      width: 320,
      height: 240,
      scale: 1,
      visibility: 'hidden',
      distance: 500,
      priority: -50,
      occlusion: 1,
    });
    await hidden.freeze('offscreen');
    expect(hiddenRoot.dataset.widgetRuntimeStatus).toBe('deferred');

    digestGate.resolve(current.response.artifact.digestSha256);
    await vi.waitFor(() => expect(firstRoot.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(current.load).toHaveBeenCalledOnce();
    expect(hiddenRoot.dataset.widgetRuntimeStatus).toBe('deferred');

    hidden.setViewport({
      width: 320,
      height: 240,
      scale: 1,
      visibility: 'visible',
      distance: 0,
      priority: 60,
      occlusion: 0,
    });
    expect(current.load).toHaveBeenCalledOnce();
    await hidden.resume('visible-again');
    await hidden.resume('duplicate-resume');
    await vi.waitFor(() => expect(hiddenRoot.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(current.load).toHaveBeenCalledTimes(2);
    expect(current.mount).toHaveBeenCalledTimes(2);

    await first.destroy();
    await hidden.destroy();
    await current.runtime.destroy();
  });

  test('keeps ten thousand initially offscreen owners outside bounded load admission', async () => {
    const current = fixture({
      maxConcurrentLoads: 1,
      maxQueuedLoads: 1,
    });
    const owners = [];
    let visibleRoot: HTMLDivElement | undefined;
    for (let index = 0; index < 10_000; index += 1) {
      const root = document.createElement('div');
      const owner = current.runtime.renderOwned({
        root,
        canvasId: identity.canvasId,
        element: element(),
        initialViewport: {
          width: 320,
          height: 240,
          scale: 1,
          visibility: 'hidden',
          distance: index + 1,
          priority: -50,
          occlusion: 1,
        },
        initiallyFrozen: true,
      });
      owners.push(owner);
      visibleRoot = root;
    }

    expect(current.load).not.toHaveBeenCalled();
    expect(current.runtime.diagnostics()).toMatchObject({
      activeLoadCount: 0,
      queuedLoadCount: 0,
      mountedOwnerCount: 10_000,
    });
    expect(() => current.runtime.renderOwned({
      root: document.createElement('div'),
      canvasId: identity.canvasId,
      element: element(),
      initiallyFrozen: true,
    })).toThrow('Widget UI runtime inert-owner capacity is exhausted.');
    const visible = owners.at(-1)!;
    visible.setViewport({
      width: 320,
      height: 240,
      scale: 1,
      visibility: 'visible',
      distance: 0,
      priority: 60,
      occlusion: 0,
    });
    await visible.resume('visible-again');
    await vi.waitFor(() => expect(visibleRoot?.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(current.load).toHaveBeenCalledOnce();
    expect(current.mount).toHaveBeenCalledOnce();

    await current.runtime.destroy();
    expect(current.runtime.diagnostics()).toMatchObject({
      activeLoadCount: 0,
      queuedLoadCount: 0,
      mountedOwnerCount: 0,
    });
  }, 10_000);

  test('enforces aggregate Capsule population ceilings through the fake host', async () => {
    const light = fixture();
    for (let index = 0; index < 600; index += 1) {
      light.runtime.renderOwned({
        root: document.createElement('div'),
        canvasId: identity.canvasId,
        element: element(),
      });
    }
    await vi.waitFor(() => {
      expect(light.runtime.diagnostics()).toMatchObject({
        mountedOwnerCount: 600,
        reprioritizationCandidateCount: 512,
        activeRuntimeCount: 16,
        throttledRuntimeCount: 8,
        frozenRuntimeCount: 0,
        liveRuntimeCount: 24,
        heavyRuntimeCount: 0,
        gpuRuntimeCount: 0,
      });
    });
    const lightModes = light.mountedHandles.flatMap(({ setSchedulingMode }) => (
      setSchedulingMode.mock.calls.map(([mode]) => mode)
    ));
    expect(lightModes.filter((mode) => mode === 'active')).toHaveLength(16);
    expect(lightModes.filter((mode) => mode === 'throttled')).toHaveLength(8);
    expect(light.mount).toHaveBeenCalledTimes(24);
    await light.runtime.destroy();

    const heavy = fixture({ apis: ['DOM', 'CANVAS_2D'] });
    for (let index = 0; index < 12; index += 1) {
      heavy.runtime.renderOwned({
        root: document.createElement('div'),
        canvasId: identity.canvasId,
        element: element(),
      });
    }
    await vi.waitFor(() => {
      expect(heavy.runtime.diagnostics()).toMatchObject({
        activeRuntimeCount: 8,
        throttledRuntimeCount: 0,
        liveRuntimeCount: 8,
        heavyRuntimeCount: 8,
        gpuRuntimeCount: 0,
      });
    });
    expect(heavy.mount).toHaveBeenCalledTimes(8);
    await heavy.runtime.destroy();

    const gpu = fixture({ apis: ['DOM', 'WEBGPU'] });
    for (let index = 0; index < 12; index += 1) {
      gpu.runtime.renderOwned({
        root: document.createElement('div'),
        canvasId: identity.canvasId,
        element: element(),
      });
    }
    await vi.waitFor(() => {
      expect(gpu.runtime.diagnostics()).toMatchObject({
        activeRuntimeCount: 2,
        throttledRuntimeCount: 0,
        liveRuntimeCount: 2,
        heavyRuntimeCount: 2,
        gpuRuntimeCount: 2,
      });
    });
    expect(gpu.mount).toHaveBeenCalledTimes(2);
    await gpu.runtime.destroy();
  }, 10_000);

  test('shares the live population across published and Preview owners with one swap candidate', async () => {
    const current = fixture();
    for (let index = 0; index < 23; index += 1) {
      current.runtime.renderOwned({
        root: document.createElement('div'),
        canvasId: identity.canvasId,
        element: element(),
      });
    }
    const previewMount = vi.fn(async () => runtimeHandle().handle);
    const onError = vi.fn();
    const preview = current.runtime.renderPreloadedOwned({
      apis: ['DOM'],
      mount: previewMount,
      onError,
    });
    await preview.ready();
    await vi.waitFor(() => {
      expect(current.runtime.diagnostics()).toMatchObject({
        mountedOwnerCount: 24,
        liveRuntimeCount: 24,
      });
    });
    expect(current.mount).toHaveBeenCalledTimes(23);
    expect(previewMount).toHaveBeenCalledOnce();

    const overflowMount = vi.fn(async () => runtimeHandle().handle);
    const overflow = current.runtime.renderPreloadedOwned({
      apis: ['DOM'],
      mount: overflowMount,
      onError,
    });
    void overflow.ready().catch(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(current.runtime.diagnostics().liveRuntimeCount).toBe(24);
    expect(overflowMount).not.toHaveBeenCalled();

    const firstSwapMount = vi.fn(async () => runtimeHandle().handle);
    const firstSwap = current.runtime.renderPreloadedOwned({
      apis: ['DOM'],
      swapFrom: preview,
      mount: firstSwapMount,
      onError,
    });
    await firstSwap.ready();
    await vi.waitFor(() => {
      expect(current.runtime.diagnostics()).toMatchObject({
        mountedOwnerCount: 26,
        liveRuntimeCount: 25,
      });
    });
    expect(firstSwapMount).toHaveBeenCalledOnce();

    const secondSwapMount = vi.fn(async () => runtimeHandle().handle);
    const secondSwap = current.runtime.renderPreloadedOwned({
      apis: ['DOM'],
      swapFrom: preview,
      mount: secondSwapMount,
      onError,
    });
    void secondSwap.ready().catch(() => undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(current.runtime.diagnostics()).toMatchObject({
      mountedOwnerCount: 27,
      liveRuntimeCount: 25,
    });
    expect(secondSwapMount).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    await current.runtime.destroy();
  }, 10_000);

  test('freezes offscreen owners after two seconds, destroys far owners, and remounts', async () => {
    const current = fixture();
    const owners = Array.from({ length: 24 }, () => current.runtime.renderOwned({
      root: document.createElement('div'),
      canvasId: identity.canvasId,
      element: element(),
    }));
    await vi.waitFor(() => {
      expect(current.runtime.diagnostics()).toMatchObject({
        activeRuntimeCount: 16,
        throttledRuntimeCount: 8,
        frozenRuntimeCount: 0,
        liveRuntimeCount: 24,
      });
    });
    owners.at(-1)!.setFocused(true, { preventScroll: true });
    expect(current.mountedHandles.at(-1)!.handle.focus)
      .toHaveBeenCalledWith({ preventScroll: true });
    owners.at(-1)!.setFocused(false);
    const farViewport = {
      width: 320,
      height: 240,
      scale: 1,
      visibility: 'hidden' as const,
      distance: 3_000,
      priority: -50,
      occlusion: 1,
    };
    for (const owner of owners) owner.setViewport(farViewport);
    await vi.waitFor(() => {
      expect(current.clock.setTimeout).toHaveBeenLastCalledWith(
        expect.any(Function),
        2_000,
      );
    });

    await current.clock.advanceBy(1_999);
    await Promise.resolve();
    expect(current.mountedHandles.reduce(
      (count, mounted) => count + mounted.freeze.mock.calls.length,
      0,
    )).toBe(0);

    await current.clock.advanceBy(1);
    await vi.waitFor(() => {
      expect(current.runtime.diagnostics()).toMatchObject({
        activeRuntimeCount: 0,
        throttledRuntimeCount: 0,
        frozenRuntimeCount: 16,
        liveRuntimeCount: 16,
      });
    });
    expect(current.mountedHandles.reduce(
      (count, mounted) => count + mounted.freeze.mock.calls.length,
      0,
    )).toBe(16);
    expect(current.mountedHandles.reduce(
      (count, mounted) => count + mounted.destroy.mock.calls.length,
      0,
    )).toBe(8);

    await current.clock.advanceBy(28_000);
    await vi.waitFor(() => {
      expect(current.runtime.diagnostics()).toMatchObject({
        frozenRuntimeCount: 0,
        liveRuntimeCount: 0,
      });
    });
    expect(current.mountedHandles.reduce(
      (count, mounted) => count + mounted.destroy.mock.calls.length,
      0,
    )).toBe(24);

    owners.at(-1)!.setViewport({
      ...farViewport,
      visibility: 'visible',
      distance: 0,
      priority: 100,
      occlusion: 0,
    });
    await owners.at(-1)!.resume('fullscreen-visible');
    await vi.waitFor(() => {
      expect(current.runtime.diagnostics()).toMatchObject({
        activeRuntimeCount: 1,
        liveRuntimeCount: 1,
      });
    });
    expect(current.mount).toHaveBeenCalledTimes(25);
    expect(current.mountedHandles.at(-1)!.handle.focus).not.toHaveBeenCalled();
    expect(current.mountedHandles.at(-1)!.setSchedulingMode)
      .toHaveBeenLastCalledWith('active');

    await current.runtime.destroy();
  });

  test('never wakes an overflowed owner destroyed before admission frees', async () => {
    const digestGate = deferred<string>();
    const current = fixture({
      digestSha256: async () => await digestGate.promise,
      maxConcurrentLoads: 1,
      maxQueuedLoads: 0,
    });
    const firstRoot = document.createElement('div');
    const discardedRoot = document.createElement('div');
    const first = current.runtime.renderOwned({
      root: firstRoot,
      canvasId: identity.canvasId,
      element: element(),
    });
    const discarded = current.runtime.renderOwned({
      root: discardedRoot,
      canvasId: identity.canvasId,
      element: element(),
    });
    expect(discardedRoot.dataset.widgetRuntimeStatus).toBe('deferred');

    await discarded.destroy('removed-before-wakeup');
    expect(discardedRoot.dataset.widgetRuntimeStatus).toBeUndefined();
    digestGate.resolve(current.response.artifact.digestSha256);
    await vi.waitFor(() => expect(firstRoot.dataset.widgetRuntimeStatus).toBe('ready'));
    await Promise.resolve();
    expect(current.load).toHaveBeenCalledOnce();
    expect(current.mount).toHaveBeenCalledOnce();
    expect(current.runtime.diagnostics()).toMatchObject({
      activeLoadCount: 0,
      queuedLoadCount: 0,
      mountedOwnerCount: 1,
    });

    await first.destroy();
    await current.runtime.destroy();
    expect(current.runtime.diagnostics()).toMatchObject({
      activeLoadCount: 0,
      queuedLoadCount: 0,
      mountedOwnerCount: 0,
    });
  });

  test('opens collaborative state only for the exact manifest-enabled instance identity', async () => {
    const state = collaborativeSession();
    const open = vi.fn(async () => state);
    const current = fixture({
      collaborativeState: {
        open,
      },
      collaborativeStateEnabled: true,
    });
    const rendered = await renderReady(current.runtime);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      identity,
      signal: expect.any(AbortSignal),
    }));
    expect(open.mock.calls[0]![0].isCurrent()).toBe(true);
    expect(current.mount.mock.calls[0]![0].collaborativeStateBridge).toBe(state);
    rendered.cleanup();
    await vi.waitFor(() => expect(state.dispose).toHaveBeenCalled());
    await current.runtime.destroy();
  });

  test('fences a tenant authority change while exact bytes are being verified', async () => {
    let authority = 'authority-a';
    let resolveDigest!: (value: string) => void;
    const current = fixture({
      tenantAuthorityKey: () => authority,
      isTargetCurrent: () => true,
      digestSha256: async () => await new Promise((resolve) => {
        resolveDigest = resolve;
      }),
    });
    const root = document.createElement('div');
    current.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(),
    });
    await vi.waitFor(() => expect(current.digestSha256).toHaveBeenCalledOnce());
    authority = 'authority-b';
    resolveDigest(current.response.artifact.digestSha256);
    await vi.waitFor(() => expect(root.dataset.widgetRuntimeStatus).toBe('error'));
    expect(root.textContent).toContain('tenant scope changed');
    expect(current.mount).not.toHaveBeenCalled();
    await current.runtime.destroy();
  });

  test('destroys every handle and then the shared mount coordinator once', async () => {
    const current = fixture();
    await renderReady(current.runtime);
    await current.runtime.destroy('tenant-authority-changed');
    await current.runtime.destroy('again');
    expect(current.mounted.destroy).toHaveBeenCalledWith('tenant-authority-changed');
    expect(current.destroyMount).toHaveBeenCalledOnce();
    expect(current.runtime.diagnostics()).toMatchObject({
      mountedOwnerCount: 0,
    });
  });
});
