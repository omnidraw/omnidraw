import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { describe, expect, test, vi } from 'vitest';
import type { TWidgetBrowserFunctionDescriptor } from '@vibecanvas/widget-contract';
import type { TElement } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import { WidgetUiArtifactCache } from '../../src/widget-runtime/WidgetUiArtifactCache';
import { WidgetUiRuntime } from '../../src/widget-runtime/WidgetUiRuntime';
import type {
  TWidgetArtifactCodecPort,
  TWidgetCollaborativeStatePort,
  TWidgetCollaborativeStateSession,
  TWidgetRuntimeIdentity,
  TWidgetRuntimeLocalTarget,
  TWidgetRuntimeTransportPort,
  TVerifiedWidgetUiArtifact,
} from '../../src/widget-runtime/interface';

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function artifact(source = 'export default "ready";', outputDigest?: string) {
  const outputBytes = Buffer.from(source, 'utf8');
  const envelopeBytes = Buffer.from(JSON.stringify({
    format: 'vibecanvas.widget-artifact.v1',
    kind: 'ui',
    entry: 'ui/main.ts',
    sourceDigestSha256: 'c'.repeat(64),
    builderIdentity: 'bun-browser-v1',
    runtimeAbi: null,
    outputs: [{
      path: 'output-0.js',
      loader: 'js',
      kind: 'entry-point',
      digestSha256: outputDigest ?? digest(outputBytes),
      bytesBase64: outputBytes.toString('base64'),
    }],
  }), 'utf8');
  return {
    digestSha256: digest(envelopeBytes),
    bytesBase64: envelopeBytes.toString('base64'),
  };
}

const identity: TWidgetRuntimeIdentity = Object.freeze({
  orgId: 'org-a',
  canvasId: 'canvas-a',
  elementId: 'element-a',
  widgetInstanceId: 'instance-a',
  definitionId: 'definition-a',
  revisionId: 'revision-a',
});

function functionDescriptor(exportName: string, timeoutMs: number): TWidgetBrowserFunctionDescriptor {
  return {
    schemaVersion: 1,
    exportName,
    effect: 'fn',
    inputSchema: {},
    outputSchema: {},
    resources: [],
    limits: {
      timeoutMs,
      memoryTier: 'small',
      outputByteLimit: 1_024,
      logByteLimit: 1_024,
    },
    retry: {
      mode: 'none',
      maxAttempts: 1,
      initialBackoffMs: 0,
      maxBackoffMs: 0,
    },
  };
}

function functionInvocation(status: 'queued' | 'succeeded') {
  return {
    id: 'invocation-a',
    functionName: 'count',
    widgetRevisionId: identity.revisionId,
    widgetInstanceId: identity.widgetInstanceId,
    status,
    output: status === 'succeeded' ? { count: 2 } : null,
    failure: null,
    createdAtMs: 1,
    startedAtMs: status === 'succeeded' ? 2 : null,
    finishedAtMs: status === 'succeeded' ? 3 : null,
  };
}

function element(
  candidate: TWidgetRuntimeIdentity = identity,
  stateDocumentId?: string,
): TElement {
  return {
    id: candidate.elementId,
    x: 0,
    y: 0,
    rotation: 0,
    zIndex: '',
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    style: {},
    data: {
      type: 'widget-instance',
      definitionId: candidate.definitionId,
      revisionId: candidate.revisionId,
      instanceId: candidate.widgetInstanceId,
      ...(stateDocumentId === undefined ? {} : { stateDocumentId }),
      w: 320,
      h: 240,
      expanded: true,
      window: 'contained',
    },
  };
}

function fixture(args: Readonly<{
  responseIdentity?: TWidgetRuntimeIdentity;
  organizationId?: string | (() => string);
  tenantAuthorityKey?: string | (() => string);
  artifact?: ReturnType<typeof artifact>;
  cache?: WidgetUiArtifactCache;
  collaborativeState?: TWidgetCollaborativeStatePort;
  functionDescriptors?: readonly TWidgetBrowserFunctionDescriptor[];
  isTargetCurrent?(target: TWidgetRuntimeLocalTarget): boolean;
  nowMs?(): number;
  wait?(timeoutMs: number, signal?: AbortSignal): Promise<void>;
  loadRetry?: Readonly<{
    initialBackoffMs?: number;
    maxBackoffMs?: number;
  }>;
  maxActiveRenders?: number;
  maxQueuedRenders?: number;
  recoveryPaceMs?: number;
}> = {}) {
  const responseIdentity = args.responseIdentity ?? identity;
  const { orgId: _responseOrganizationId, ...publicResponseIdentity } = responseIdentity;
  const artifactValue = args.artifact ?? artifact();
  const response = {
    identity: publicResponseIdentity,
    manifest: {
      schemaVersion: 2 as const,
      name: 'Pinned widget',
      slug: 'pinned-widget',
      ui: { entry: 'ui/main.ts' },
    },
    artifact: artifactValue,
    functionDescriptors: args.functionDescriptors ?? [],
  };
  const load = vi.fn(async (
    _request: unknown,
    _options?: Readonly<{ signal?: AbortSignal }>,
  ) => [undefined, response] as const);
  const digestSha256 = vi.fn(async (bytes: Uint8Array) => digest(bytes));
  const codec: TWidgetArtifactCodecPort = {
    decodeBase64: (value) => Buffer.from(value, 'base64'),
    decodeUtf8: (value) => Buffer.from(value).toString('utf8'),
    digestSha256,
  };
  const cleanup = vi.fn();
  const mount = vi.fn(() => cleanup);
  const functionInvoke = vi.fn();
  const functionGet = vi.fn();
  const transport = {
    api: {
      widget: { runtime: { load } },
      function: {
        invoke: functionInvoke,
        get: functionGet,
      },
    },
  } as unknown as TWidgetRuntimeTransportPort;
  const runtime = new WidgetUiRuntime({
    transport,
    codec,
    mount: { mount },
    createIdempotencyKey: () => 'mount-key',
    organizationId: typeof args.organizationId === 'function'
      ? args.organizationId
      : () => args.organizationId ?? identity.orgId,
    tenantAuthorityKey: typeof args.tenantAuthorityKey === 'function'
      ? args.tenantAuthorityKey
      : () => args.tenantAuthorityKey ?? 'tenant-authority-a',
    nowMs: args.nowMs ?? (() => 0),
    wait: args.wait ?? (async () => undefined),
    cache: args.cache,
    collaborativeState: args.collaborativeState,
    isTargetCurrent: args.isTargetCurrent,
    loadRetry: args.loadRetry,
    maxActiveRenders: args.maxActiveRenders,
    maxQueuedRenders: args.maxQueuedRenders,
    recoveryPaceMs: args.recoveryPaceMs,
  });
  return {
    cleanup,
    digestSha256,
    functionGet,
    functionInvoke,
    load,
    mount,
    response,
    runtime,
  };
}

async function renderReady(
  runtime: WidgetUiRuntime,
  candidate: TWidgetRuntimeIdentity = identity,
  stateDocumentId?: string,
) {
  const root = document.createElement('div');
  const cleanup = runtime.render({
    root,
    canvasId: candidate.canvasId,
    element: element(candidate, stateDocumentId),
  });
  await vi.waitFor(() => expect(root.dataset.widgetRuntimeStatus).not.toBe('loading'));
  return { cleanup, root };
}

function collaborativeSession(
  stateDocumentId: string,
  overrides: Partial<TWidgetCollaborativeStateSession> = {},
): TWidgetCollaborativeStateSession {
  return {
    identity: Object.freeze({ ...identity, stateDocumentId }),
    get: vi.fn(async () => ({ version: 1, value: null })),
    change: vi.fn(async (value) => ({ version: 2, value })),
    next: vi.fn(() => new Promise(() => {})),
    cancel: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
}

describe('WidgetUiRuntime', () => {
  test('pins cache entries by org, definition, revision, and verified digest', async () => {
    const cache = new WidgetUiArtifactCache();
    const first = fixture({ cache });
    const one = await renderReady(first.runtime);
    expect(one.root.dataset.widgetRuntimeStatus).toBe('ready');
    expect(first.digestSha256).toHaveBeenCalledTimes(2);
    one.cleanup();

    const two = await renderReady(first.runtime);
    expect(two.root.dataset.widgetRuntimeStatus).toBe('ready');
    expect(first.load).toHaveBeenCalledTimes(2);
    expect(first.digestSha256).toHaveBeenCalledTimes(2);
    expect(first.mount).toHaveBeenCalledTimes(2);
    const cachedArtifact = first.mount.mock.calls[0]?.[0].artifact;
    expect(cachedArtifact.retainedByteSize).toBeGreaterThan(cachedArtifact.outputs[0]!.bytes.byteLength);

    const second = fixture({ cache, organizationId: 'org-b' });
    const root = document.createElement('div');
    second.runtime.render({ root, canvasId: identity.canvasId, element: element(identity) });
    await vi.waitFor(() => expect(root.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(second.digestSha256).toHaveBeenCalledTimes(2);

    const nextIdentity = {
      ...identity,
      revisionId: 'revision-b',
    };
    const third = fixture({ cache, responseIdentity: nextIdentity });
    await renderReady(third.runtime, nextIdentity);
    expect(third.digestSha256).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(3);
  });

  test('coalesces concurrent verification of the same exact artifact key', async () => {
    const current = fixture();
    const firstRoot = document.createElement('div');
    const secondRoot = document.createElement('div');
    current.runtime.render({ root: firstRoot, canvasId: identity.canvasId, element: element() });
    current.runtime.render({ root: secondRoot, canvasId: identity.canvasId, element: element() });

    await vi.waitFor(() => {
      expect(firstRoot.dataset.widgetRuntimeStatus).toBe('ready');
      expect(secondRoot.dataset.widgetRuntimeStatus).toBe('ready');
    });
    expect(current.load).toHaveBeenCalledTimes(2);
    expect(current.digestSha256).toHaveBeenCalledTimes(2);
  });

  test('binds the exact loaded function descriptor timeout policy into the mounted bridge', async () => {
    let nowMs = 0;
    const current = fixture({
      functionDescriptors: [functionDescriptor('count', 30_000)],
      nowMs: () => nowMs,
      wait: async (timeoutMs) => { nowMs += timeoutMs; },
    });
    current.functionInvoke.mockResolvedValue([undefined, functionInvocation('queued')]);
    current.functionGet.mockImplementation(async () => [
      undefined,
      nowMs >= 31_000 ? functionInvocation('succeeded') : functionInvocation('queued'),
    ] as never);
    const rendered = await renderReady(current.runtime);
    const functionBridge = current.mount.mock.calls[0]?.[0].functionBridge;

    await expect(functionBridge.invoke({
      functionName: 'count',
      input: {},
      idempotencyKey: 'key-a',
    })).resolves.toEqual({ count: 2 });
    expect(nowMs).toBeGreaterThanOrEqual(31_000);
    await expect(functionBridge.invoke({
      functionName: 'notPublished',
      input: {},
      idempotencyKey: 'key-b',
    })).rejects.toThrow('not declared by this revision');
    expect(current.functionInvoke).toHaveBeenCalledOnce();
    rendered.cleanup();
  });

  test('bounds active render lifetimes and skips cancelled queued hosts', async () => {
    const current = fixture({ maxActiveRenders: 2 });
    const pendingLoads: Array<(value: readonly [undefined, typeof current.response]) => void> = [];
    current.load.mockImplementation(() => new Promise((resolve) => {
      pendingLoads.push(resolve);
    }));
    const roots = Array.from({ length: 4 }, () => document.createElement('div'));
    const cleanups = roots.map((root) => current.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(),
    }));

    await vi.waitFor(() => expect(current.load).toHaveBeenCalledTimes(2));
    expect(roots.every((root) => root.dataset.widgetRuntimeStatus === 'loading')).toBe(true);
    pendingLoads[0]!([undefined, current.response]);
    await vi.waitFor(() => expect(roots[0]!.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(current.load).toHaveBeenCalledTimes(2);

    cleanups[0]!();
    await vi.waitFor(() => expect(current.load).toHaveBeenCalledTimes(3));
    cleanups[3]!();
    cleanups[1]!();
    await Promise.resolve();
    expect(current.load).toHaveBeenCalledTimes(3);

    pendingLoads[2]!([undefined, current.response]);
    await vi.waitFor(() => expect(roots[2]!.dataset.widgetRuntimeStatus).toBe('ready'));
    pendingLoads[1]!([undefined, current.response]);
    await Promise.resolve();
    cleanups[2]!();
  });

  test('bounds queued render hosts and retries deferred work only after a fresh mount', async () => {
    const current = fixture({ maxActiveRenders: 1, maxQueuedRenders: 2 });
    const pendingLoads: Array<(value: readonly [undefined, typeof current.response]) => void> = [];
    current.load.mockImplementation(() => new Promise((resolve) => {
      pendingLoads.push(resolve);
    }));
    const roots = Array.from({ length: 10 }, () => document.createElement('div'));
    const cleanups = roots.map((root) => current.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(),
    }));

    await vi.waitFor(() => expect(current.load).toHaveBeenCalledOnce());
    expect(roots.filter((root) => root.dataset.widgetRuntimeStatus === 'loading')).toHaveLength(3);
    expect(roots.filter((root) => root.dataset.widgetRuntimeStatus === 'deferred')).toHaveLength(7);
    expect(current.mount).not.toHaveBeenCalled();

    cleanups[0]!();
    expect(current.load).toHaveBeenCalledTimes(1);
    pendingLoads[0]!([undefined, current.response]);
    await vi.waitFor(() => expect(current.load).toHaveBeenCalledTimes(2));
    cleanups[1]!();
    expect(current.load).toHaveBeenCalledTimes(2);
    pendingLoads[1]!([undefined, current.response]);
    await vi.waitFor(() => expect(current.load).toHaveBeenCalledTimes(3));
    cleanups[2]!();
    pendingLoads[2]!([undefined, current.response]);
    await vi.waitFor(() => expect(current.runtime.diagnostics().activeRenderCount).toBe(0));
    expect(current.load).toHaveBeenCalledTimes(3);

    cleanups[3]!();
    const retryCleanup = current.runtime.render({
      root: roots[3]!,
      canvasId: identity.canvasId,
      element: element(),
    });
    await vi.waitFor(() => expect(current.load).toHaveBeenCalledTimes(4));
    expect(roots[3]!.dataset.widgetRuntimeStatus).toBe('loading');

    retryCleanup();
    pendingLoads[3]!([undefined, current.response]);
    for (const cleanup of cleanups.slice(4)) cleanup();
  });

  test('releases a fatal sandbox lifetime so a queued healthy widget can render', async () => {
    const current = fixture({ maxActiveRenders: 32 });
    const roots = Array.from({ length: 33 }, () => document.createElement('div'));
    const cleanups = roots.map((root) => current.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(),
    }));

    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledTimes(32));
    expect(current.load).toHaveBeenCalledTimes(32);
    expect(roots[32]!.dataset.widgetRuntimeStatus).toBe('loading');

    current.mount.mock.calls[0]![0].onFatal(new Error('sandbox boot failed'));
    current.mount.mock.calls[0]![0].onFatal(new Error('duplicate fatal'));

    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledTimes(33));
    expect(current.load).toHaveBeenCalledTimes(33);
    expect(roots[0]!.dataset.widgetRuntimeStatus).toBe('error');
    expect(roots[0]!.textContent).toContain('sandbox boot failed');
    expect(roots[32]!.dataset.widgetRuntimeStatus).toBe('ready');
    for (const cleanup of cleanups) cleanup();
  });

  test('fences an in-flight load when its render host is torn down', async () => {
    let resolveLoad!: (value: readonly [undefined, ReturnType<typeof fixture>['response']]) => void;
    const pendingLoad = new Promise<readonly [undefined, ReturnType<typeof fixture>['response']]>(
      (resolve) => { resolveLoad = resolve; },
    );
    const current = fixture();
    current.load.mockImplementation(() => pendingLoad);
    const root = document.createElement('div');
    const cleanup = current.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(),
    });

    cleanup();
    resolveLoad([undefined, current.response]);
    await Promise.resolve();
    await Promise.resolve();

    expect(root.childElementCount).toBe(0);
    expect(root.dataset.widgetRuntimeStatus).toBeUndefined();
    expect(current.load.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(current.digestSha256).not.toHaveBeenCalled();
    expect(current.mount).not.toHaveBeenCalled();
  });

  test('aborts every orphaned artifact RPC during repeated mount churn', async () => {
    const current = fixture({ maxActiveRenders: 1 });
    const signals: AbortSignal[] = [];
    let activeRpcCount = 0;
    current.load.mockImplementation((_request, options) => new Promise((resolve) => {
      const signal = options?.signal;
      if (!signal) throw new Error('Widget runtime load did not receive a cancellation signal.');
      signals.push(signal);
      activeRpcCount += 1;
      signal.addEventListener('abort', () => {
        activeRpcCount -= 1;
        resolve([{ code: 'CANCELLED' }, undefined] as never);
      }, { once: true });
    }));

    for (let index = 0; index < 64; index += 1) {
      const root = document.createElement('div');
      const cleanup = current.runtime.render({
        root,
        canvasId: identity.canvasId,
        element: element(),
      });
      await vi.waitFor(() => expect(signals).toHaveLength(index + 1));
      cleanup();
      await vi.waitFor(() => expect(activeRpcCount).toBe(0));
    }

    expect(current.load).toHaveBeenCalledTimes(64);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(current.digestSha256).not.toHaveBeenCalled();
    expect(current.mount).not.toHaveBeenCalled();
  });

  test('holds render leases until stalled artifact verification settles under unique-target churn', async () => {
    const current = fixture({ maxActiveRenders: 2, maxQueuedRenders: 0 });
    current.load.mockImplementation(async (request) => [undefined, {
      ...current.response,
      identity: request as typeof current.response.identity,
    }] as const);
    const digestResolvers: Array<(value: string) => void> = [];
    let digestCallCount = 0;
    current.digestSha256.mockImplementation((bytes) => {
      digestCallCount += 1;
      if (digestCallCount <= 2) {
        return new Promise<string>((resolve) => { digestResolvers.push(resolve); });
      }
      return Promise.resolve(digest(bytes));
    });
    const candidate = (index: number): TWidgetRuntimeIdentity => ({
      ...identity,
      elementId: `element-${index}`,
      widgetInstanceId: `instance-${index}`,
      revisionId: `revision-${index}`,
    });
    const firstRoots = [document.createElement('div'), document.createElement('div')];
    const firstCleanups = firstRoots.map((root, index) => current.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(candidate(index)),
    }));
    await vi.waitFor(() => expect(digestResolvers).toHaveLength(2));
    expect(current.runtime.diagnostics()).toMatchObject({
      activeRenderCount: 2,
      queuedRenderCount: 0,
      inFlightArtifactVerificationCount: 2,
    });

    for (const cleanup of firstCleanups) cleanup();
    const churnRoots = Array.from({ length: 64 }, () => document.createElement('div'));
    const churnCleanups = churnRoots.map((root, index) => current.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(candidate(index + 10)),
    }));
    expect(churnRoots.every((root) => root.dataset.widgetRuntimeStatus === 'deferred')).toBe(true);
    expect(current.load).toHaveBeenCalledTimes(2);
    expect(current.runtime.diagnostics()).toMatchObject({
      activeRenderCount: 2,
      queuedRenderCount: 0,
      inFlightArtifactVerificationCount: 2,
    });

    for (const resolve of digestResolvers) resolve(current.response.artifact.digestSha256);
    await vi.waitFor(() => expect(current.runtime.diagnostics()).toMatchObject({
      activeRenderCount: 0,
      inFlightArtifactVerificationCount: 0,
    }));

    const retryRoot = document.createElement('div');
    const retryCleanup = current.runtime.render({
      root: retryRoot,
      canvasId: identity.canvasId,
      element: element(candidate(100)),
    });
    await vi.waitFor(() => expect(retryRoot.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(current.load).toHaveBeenCalledTimes(3);
    retryCleanup();
    for (const cleanup of churnCleanups) cleanup();
  });

  test('fences a load when the injected browser tenant changes before the response', async () => {
    let activeTenantAuthorityKey = 'tenant-authority-a';
    let resolveLoad!: (value: readonly [undefined, ReturnType<typeof fixture>['response']]) => void;
    const current = fixture({
      tenantAuthorityKey: () => activeTenantAuthorityKey,
    });
    current.load.mockImplementation(() => new Promise((resolve) => {
      resolveLoad = resolve;
    }));
    const root = document.createElement('div');
    current.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(),
    });
    await vi.waitFor(() => expect(current.load).toHaveBeenCalledOnce());

    activeTenantAuthorityKey = 'tenant-authority-b';
    resolveLoad([undefined, current.response]);
    await vi.waitFor(() => expect(root.dataset.widgetRuntimeStatus).toBe('error'));

    expect(root.textContent).toContain('tenant scope changed');
    expect(current.digestSha256).not.toHaveBeenCalled();
    expect(current.mount).not.toHaveBeenCalled();
  });

  test('fences a tenant switch while artifact verification is pending', async () => {
    let activeTenantAuthorityKey = 'tenant-authority-a';
    let resolveDigest!: (value: string) => void;
    const pendingDigest = new Promise<string>((resolve) => {
      resolveDigest = resolve;
    });
    const current = fixture({
      tenantAuthorityKey: () => activeTenantAuthorityKey,
    });
    current.digestSha256.mockImplementationOnce(() => pendingDigest);
    const root = document.createElement('div');
    current.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(),
    });
    await vi.waitFor(() => expect(current.digestSha256).toHaveBeenCalledOnce());

    activeTenantAuthorityKey = 'tenant-authority-b';
    resolveDigest(current.response.artifact.digestSha256);
    await vi.waitFor(() => expect(root.dataset.widgetRuntimeStatus).toBe('error'));

    expect(root.textContent).toContain('tenant scope changed');
    expect(current.mount).not.toHaveBeenCalled();
  });

  test('fences ready function and collaborative-state bridges after tenant activation changes', async () => {
    let activeTenantAuthorityKey = 'tenant-authority-a';
    const stateDocumentId = 'automerge:state-a';
    const state = collaborativeSession(stateDocumentId);
    const open = vi.fn(async () => state);
    const current = fixture({
      collaborativeState: { open },
      functionDescriptors: [functionDescriptor('count', 1_000)],
      tenantAuthorityKey: () => activeTenantAuthorityKey,
    });
    const rendered = await renderReady(current.runtime, identity, stateDocumentId);
    const functionBridge = current.mount.mock.calls[0]?.[0].functionBridge;
    const stateOpenArgs = open.mock.calls[0]?.[0];
    expect(stateOpenArgs.isCurrent()).toBe(true);

    activeTenantAuthorityKey = 'tenant-authority-b';

    expect(stateOpenArgs.isCurrent()).toBe(false);
    await expect(functionBridge.invoke({
      functionName: 'count',
      input: {},
      idempotencyKey: 'tenant-switch-key',
    })).rejects.toThrow('target is no longer current');
    expect(current.functionInvoke).not.toHaveBeenCalled();
    rendered.cleanup();
  });

  test('rejects active/latest identity substitution before cache or mount', async () => {
    const latest = { ...identity, revisionId: 'revision-latest' };
    const { load, mount, runtime } = fixture({ responseIdentity: latest });
    const { root } = await renderReady(runtime);

    expect(root.dataset.widgetRuntimeStatus).toBe('error');
    expect(root.textContent).toContain('different pinned identity');
    expect(load).toHaveBeenCalledWith(
      {
        canvasId: identity.canvasId,
        elementId: identity.elementId,
        widgetInstanceId: identity.widgetInstanceId,
        definitionId: identity.definitionId,
        revisionId: identity.revisionId,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(mount).not.toHaveBeenCalled();
  });

  test('rejects tampered outer envelopes before decoding or mounting', async () => {
    const valid = artifact();
    const tampered = {
      digestSha256: 'f'.repeat(64),
      bytesBase64: valid.bytesBase64,
    };
    const { mount, runtime } = fixture({ artifact: tampered });
    const { root } = await renderReady(runtime);

    expect(root.dataset.widgetRuntimeStatus).toBe('error');
    expect(root.textContent).toContain('artifact digest mismatch');
    expect(mount).not.toHaveBeenCalled();
  });

  test('rejects tampered output bytes even when the outer envelope digest is valid', async () => {
    const tampered = artifact('export default "tampered";', digest(Buffer.from('export default "original";')));
    const { mount, runtime } = fixture({ artifact: tampered });
    const { root } = await renderReady(runtime);

    expect(root.dataset.widgetRuntimeStatus).toBe('error');
    expect(root.textContent).toContain('output digest mismatch');
    expect(mount).not.toHaveBeenCalled();
  });

  test('rejects strict-envelope extensions without leaking server bytes or paths', async () => {
    const envelopeBytes = Buffer.from(JSON.stringify({
      format: 'vibecanvas.widget-artifact.v1',
      kind: 'ui',
      entry: 'ui/main.ts',
      sourceDigestSha256: 'c'.repeat(64),
      builderIdentity: 'bun-browser-v1',
      runtimeAbi: null,
      outputs: [{
        path: 'output-0.js', loader: 'js', kind: 'entry-point', digestSha256: digest(Buffer.from('')), bytesBase64: '',
      }],
      serverPath: '/private/server.js',
    }), 'utf8');
    const { mount, runtime } = fixture({
      artifact: {
        digestSha256: digest(envelopeBytes),
        bytesBase64: envelopeBytes.toString('base64'),
      },
    });
    const { root } = await renderReady(runtime);

    expect(root.dataset.widgetRuntimeStatus).toBe('error');
    expect(root.textContent).toContain('invalid shape');
    expect(root.textContent).not.toContain('/private/server.js');
    expect(mount).not.toHaveBeenCalled();
  });

  test('never opens collaborative state for an instance without a state document', async () => {
    const open = vi.fn();
    const current = fixture({ collaborativeState: { open } });
    const rendered = await renderReady(current.runtime);

    expect(rendered.root.dataset.widgetRuntimeStatus).toBe('ready');
    expect(open).not.toHaveBeenCalled();
    expect(current.mount.mock.calls[0]?.[0].collaborativeStateBridge).toBeNull();
    rendered.cleanup();
  });

  test('opens only the exact scoped state identity and tears it down on unmount', async () => {
    const stateDocumentId = 'automerge:state-a';
    const session = collaborativeSession(stateDocumentId);
    const open = vi.fn(async () => session);
    let targetCurrent = true;
    const current = fixture({
      collaborativeState: { open },
      isTargetCurrent: () => targetCurrent,
    });
    const rendered = await renderReady(current.runtime, identity, stateDocumentId);

    expect(rendered.root.dataset.widgetRuntimeStatus).toBe('ready');
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]?.[0].identity).toEqual({ ...identity, stateDocumentId });
    expect(open.mock.calls[0]?.[0].isCurrent()).toBe(true);
    expect(current.mount.mock.calls[0]?.[0].collaborativeStateBridge).toBe(session);

    targetCurrent = false;
    expect(open.mock.calls[0]?.[0].isCurrent()).toBe(false);

    rendered.cleanup();
    expect(session.dispose).toHaveBeenCalledOnce();
  });

  test('fails closed when an injected state port returns a foreign identity', async () => {
    const stateDocumentId = 'automerge:state-a';
    const foreign = collaborativeSession(stateDocumentId, {
      identity: { ...identity, widgetInstanceId: 'foreign-instance', stateDocumentId },
    });
    const current = fixture({
      collaborativeState: { open: vi.fn(async () => foreign) },
    });
    const rendered = await renderReady(current.runtime, identity, stateDocumentId);

    expect(rendered.root.dataset.widgetRuntimeStatus).toBe('error');
    expect(rendered.root.textContent).toContain('identity mismatch');
    expect(foreign.dispose).toHaveBeenCalledOnce();
    expect(current.mount).not.toHaveBeenCalled();
  });

  test('retries temporary projection lag only while the exact local target remains current', async () => {
    const waits: number[] = [];
    const current = fixture({
      isTargetCurrent: () => true,
      wait: async (timeoutMs) => { waits.push(timeoutMs); },
      loadRetry: { initialBackoffMs: 10, maxBackoffMs: 20 },
    });
    current.load
      .mockResolvedValueOnce([{ code: 'NOT_FOUND' }, undefined] as never)
      .mockResolvedValueOnce([{ code: 'NOT_FOUND' }, undefined] as never);

    const rendered = await renderReady(current.runtime);
    expect(rendered.root.dataset.widgetRuntimeStatus).toBe('ready');
    expect(current.load).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([10, 100, 20, 100]);
  });

  test('recovers the same committed host after transport loss and delayed projection convergence', async () => {
    const waits: Array<Readonly<{
      timeoutMs: number;
      resolve(): void;
    }>> = [];
    const wait = vi.fn((timeoutMs: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new Error('cancelled'));
      signal?.addEventListener('abort', onAbort, { once: true });
      waits.push({
        timeoutMs,
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
      });
    }));
    let projectionConverged = false;
    const current = fixture({
      isTargetCurrent: () => true,
      wait,
      loadRetry: { initialBackoffMs: 1, maxBackoffMs: 2 },
    });
    current.load.mockImplementation(async () => {
      if (projectionConverged) return [undefined, current.response] as const;
      if (current.load.mock.calls.length === 1) throw new Error('socket disconnected');
      return [{ code: 'NOT_FOUND' }, undefined] as never;
    });
    const root = document.createElement('div');
    const cleanup = current.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(),
    });

    await vi.waitFor(() => expect(waits).toHaveLength(1));
    expect(waits[0]?.timeoutMs).toBe(1);
    expect(root.dataset.widgetRuntimeStatus).toBe('loading');
    expect(root.textContent).toContain('Waiting for widget sync');
    expect(current.runtime.diagnostics()).toMatchObject({
      activeRenderCount: 0,
      recoveringRenderCount: 1,
    });

    waits[0]!.resolve();
    await vi.waitFor(() => expect(waits).toHaveLength(2));
    expect(waits[1]?.timeoutMs).toBe(100);
    waits[1]!.resolve();
    await vi.waitFor(() => expect(current.load).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(waits).toHaveLength(3));
    expect(waits[2]?.timeoutMs).toBe(2);
    expect(waits.filter((entry) => entry.timeoutMs === 100)).toHaveLength(1);

    projectionConverged = true;
    waits[2]!.resolve();
    await vi.waitFor(() => expect(waits).toHaveLength(4));
    expect(waits[3]?.timeoutMs).toBe(100);
    waits[3]!.resolve();
    await vi.waitFor(() => expect(root.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(current.load).toHaveBeenCalledTimes(3);
    expect(current.mount).toHaveBeenCalledOnce();
    expect(current.mount.mock.calls[0]?.[0].identity).toEqual(identity);
    cleanup();
  });

  test('requeues a capacity-limited load and mounts after admission becomes available', async () => {
    const releases: Array<() => void> = [];
    const wait = vi.fn(() => new Promise<void>((resolve) => {
      releases.push(resolve);
    }));
    const current = fixture({
      isTargetCurrent: () => true,
      wait,
    });
    current.load
      .mockResolvedValueOnce([{ code: 'TOO_MANY_REQUESTS' }, undefined] as never)
      .mockResolvedValueOnce([undefined, current.response]);
    const root = document.createElement('div');
    const cleanup = current.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(),
    });

    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
    expect(current.runtime.diagnostics()).toMatchObject({
      activeRenderCount: 0,
      recoveringRenderCount: 1,
    });
    releases[0]!();
    await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(2));
    releases[1]!();
    await vi.waitFor(() => expect(root.dataset.widgetRuntimeStatus).toBe('ready'));
    expect(current.load).toHaveBeenCalledTimes(2);
    expect(current.mount).toHaveBeenCalledOnce();
    cleanup();
  });

  test('counts recovery waiters against the shared active and queued render admission bound', async () => {
    const wait = vi.fn((_timeoutMs: number, signal?: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }));
    const current = fixture({
      isTargetCurrent: () => true,
      wait,
      maxActiveRenders: 2,
      maxQueuedRenders: 2,
    });
    current.load.mockResolvedValue([{ code: 'NOT_FOUND' }, undefined] as never);
    const admittedRoots = Array.from({ length: 4 }, () => document.createElement('div'));
    const admittedCleanups = admittedRoots.map((root) => current.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(),
    }));

    await vi.waitFor(() => expect(current.runtime.diagnostics()).toMatchObject({
      activeRenderCount: 2,
      queuedRenderCount: 0,
      recoveringRenderCount: 2,
    }));
    const overflowRoots = Array.from({ length: 16 }, () => document.createElement('div'));
    const overflowCleanups = overflowRoots.map((root) => current.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(),
    }));
    expect(overflowRoots.every((root) => root.dataset.widgetRuntimeStatus === 'deferred')).toBe(true);
    expect(current.load).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(3);

    for (const cleanup of [...admittedCleanups, ...overflowCleanups]) cleanup();
  });

  test('paces many recovering hosts through one fixed-rate retry-start gate', async () => {
    const waits: Array<{
      timeoutMs: number;
      resolve(): void;
    }> = [];
    const wait = vi.fn((timeoutMs: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new Error('cancelled'));
      signal?.addEventListener('abort', onAbort, { once: true });
      waits.push({
        timeoutMs,
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
      });
    }));
    const current = fixture({
      isTargetCurrent: () => true,
      wait,
      maxActiveRenders: 8,
      maxQueuedRenders: 8,
      recoveryPaceMs: 100,
    });
    current.load.mockResolvedValue([{ code: 'NOT_FOUND' }, undefined] as never);
    const roots = Array.from({ length: 16 }, () => document.createElement('div'));
    const cleanups = roots.map((root) => current.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(),
    }));

    await vi.waitFor(() => expect(waits.filter((entry) => entry.timeoutMs === 1_000)).toHaveLength(8));
    expect(current.load).toHaveBeenCalledTimes(8);
    await vi.waitFor(() => expect(waits.filter((entry) => entry.timeoutMs === 100)).toHaveLength(1));

    for (let retry = 1; retry <= 4; retry += 1) {
      const paceWaits = waits.filter((entry) => entry.timeoutMs === 100);
      paceWaits[retry - 1]!.resolve();
      await vi.waitFor(() => expect(current.load).toHaveBeenCalledTimes(8 + retry));
      await vi.waitFor(() => expect(waits.filter((entry) => entry.timeoutMs === 100)).toHaveLength(retry + 1));
      expect(current.load).toHaveBeenCalledTimes(8 + retry);
    }

    expect(current.runtime.diagnostics()).toMatchObject({
      activeRenderCount: 4,
      recoveringRenderCount: 12,
    });
    for (const cleanup of cleanups) cleanup();
  });

  test('cancels retry waits and late state opens when the host is torn down', async () => {
    let waitSignal: AbortSignal | undefined;
    const wait = vi.fn((_timeoutMs: number, signal?: AbortSignal) => new Promise<void>((_resolve, reject) => {
      waitSignal = signal;
      signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }));
    const retrying = fixture({
      isTargetCurrent: () => true,
      wait,
    });
    retrying.load.mockResolvedValue([{ code: 'NOT_FOUND' }, undefined] as never);
    const root = document.createElement('div');
    const cleanup = retrying.runtime.render({
      root,
      canvasId: identity.canvasId,
      element: element(),
    });
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
    cleanup();
    expect(waitSignal?.aborted).toBe(true);
    await Promise.resolve();
    expect(retrying.load).toHaveBeenCalledOnce();
    expect(retrying.mount).not.toHaveBeenCalled();

    let resolveOpen!: (session: TWidgetCollaborativeStateSession) => void;
    let openSignal: AbortSignal | undefined;
    const pendingOpen = new Promise<TWidgetCollaborativeStateSession>((resolve) => {
      resolveOpen = resolve;
    });
    const stateDocumentId = 'automerge:state-a';
    const state = collaborativeSession(stateDocumentId);
    const opening = fixture({
      collaborativeState: {
        open: vi.fn(({ signal }) => {
          openSignal = signal;
          return pendingOpen;
        }),
      },
    });
    const stateRoot = document.createElement('div');
    const stateCleanup = opening.runtime.render({
      root: stateRoot,
      canvasId: identity.canvasId,
      element: element(identity, stateDocumentId),
    });
    await vi.waitFor(() => expect(opening.load).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(openSignal).toBeDefined());
    stateCleanup();
    resolveOpen(state);
    await Promise.resolve();
    await Promise.resolve();
    expect(openSignal?.aborted).toBe(true);
    expect(state.dispose).toHaveBeenCalledOnce();
    expect(opening.mount).not.toHaveBeenCalled();
  });

  test('treats a successful foreign load response as terminal without retrying', async () => {
    const current = fixture({
      responseIdentity: { ...identity, revisionId: 'foreign-revision' },
      isTargetCurrent: () => true,
      wait: vi.fn(async () => undefined),
    });
    const rendered = await renderReady(current.runtime);

    expect(rendered.root.dataset.widgetRuntimeStatus).toBe('error');
    expect(rendered.root.textContent).toContain('different pinned identity');
    expect(current.load).toHaveBeenCalledOnce();
  });

  test('does not retry non-NOT_FOUND transport or server failures', async () => {
    const wait = vi.fn(async () => undefined);
    const current = fixture({
      isTargetCurrent: () => true,
      wait,
    });
    current.load.mockResolvedValueOnce([
      { code: 'INTERNAL_SERVER_ERROR' },
      undefined,
    ] as never);
    const rendered = await renderReady(current.runtime);

    expect(rendered.root.dataset.widgetRuntimeStatus).toBe('error');
    expect(current.load).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });
});

describe('WidgetUiArtifactCache limits', () => {
  function cachedArtifact(retainedByteSize: number): TVerifiedWidgetUiArtifact {
    return {
      digestSha256: String(retainedByteSize).padStart(64, '0'),
      envelope: {} as TVerifiedWidgetUiArtifact['envelope'],
      outputs: [],
      retainedByteSize,
    };
  }

  test('evicts least-recently-used artifacts by retained bytes and skips oversize entries', () => {
    const cache = new WidgetUiArtifactCache({ maxEntries: 8, maxBytes: 10 });
    cache.set('a', cachedArtifact(6));
    cache.set('b', cachedArtifact(6));

    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).not.toBeNull();
    expect(cache.totalBytes).toBe(6);
    cache.set('oversize', cachedArtifact(11));
    expect(cache.get('oversize')).toBeNull();
    expect(cache.get('b')).not.toBeNull();
    expect(cache.totalBytes).toBe(6);
  });
});
