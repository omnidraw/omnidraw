import { describe, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type {
  CapsuleCapabilityBinding,
  CapsuleCapabilityDescriptor,
  CapsuleKernelHostStreamSink,
  CapsuleSchemaResource,
} from '@omnidraw/capsule-omnidraw/capabilities';
import type {
  CapsuleHandle,
  CapsuleHost,
  CapsuleMountErrorEvent,
  CreateCapsuleHostOptions,
} from '@omnidraw/capsule-omnidraw/host';
import { CapsuleHostError } from '@omnidraw/capsule-omnidraw/host';
import { TraceMap } from '@jridgewell/trace-mapping';
import { CapsuleWidgetHostCoordinator } from '../../src/widget-runtime/CapsuleWidgetHostCoordinator';
import { createOmnidrawGuestChannelContract } from '@omnidraw/capsule-omnidraw/capabilities';
import { createWidgetCapsuleCapabilityBindings } from '../../src/widget-runtime/create-widget-capsule-capability-bindings';
import {
  createWidgetUiArtifactMountPort as createWidgetUiArtifactMountPortBase,
} from '../../src/widget-runtime/mount-widget-ui-artifact';
import type {
  TWidgetCapsuleMountCatalog,
  TWidgetCollaborativeStateBridge,
  TWidgetFunctionHostBridge,
  TVerifiedWidgetSourceMapArtifact,
  TVerifiedWidgetUiArtifact,
} from '../../src/widget-runtime/interface';
import {
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  type TWidgetBrowserFunctionDescriptor,
  type TWidgetCapsuleApiGroup,
  type TWidgetCapsuleTheme,
} from '@omnidraw/widget-contract';
import { fnNormalizePreviewDiagnostic } from '../../src/canvas-extension/fn.preview-diagnostic';

const functionMetadata = [{
  schemaVersion: 1 as const,
  exportName: 'count',
  effect: 'fn' as const,
  inputSchema: {},
  outputSchema: {},
  resources: [],
  limits: {
    timeoutMs: 1_000,
    memoryTier: 'small' as const,
    outputByteLimit: 1_024,
    logByteLimit: 1_024,
  },
  retry: {
    mode: 'none' as const,
    maxAttempts: 1,
    initialBackoffMs: 0,
    maxBackoffMs: 0,
  },
}];

function browserFunctionDigest(
  descriptors: readonly TWidgetBrowserFunctionDescriptor[],
): string {
  return createHash('sha256')
    .update(fnCanonicalizeWidgetBrowserFunctionDescriptors(descriptors))
    .digest('hex');
}

const FUNCTION_DESCRIPTOR_DIGEST = browserFunctionDigest(functionMetadata);
const HASH_A = `sha256:${FUNCTION_DESCRIPTOR_DIGEST}` as const;
const HASH_B = `sha256:${'b'.repeat(64)}` as const;
const SCHEMA_HASH = `sha256:${'c'.repeat(64)}` as const;
const API_BUNDLE_DIGEST = `sha256:${'d'.repeat(64)}` as const;
const DOM_APIS = Object.freeze(['DOM'] as const);
const NETWORK_APIS = Object.freeze(['DOM', 'NETWORK'] as const);
const CANVAS_APIS = Object.freeze(['DOM', 'CANVAS_2D'] as const);
const BUDGETS = Object.freeze({
  cpuMs: 100,
  memoryBytes: 32 * 1_024 * 1_024,
  domNodes: 2_000,
  handles: 4_000,
  messageBytes: 64 * 1_024,
  streamBytes: 64 * 1_024,
  assetBytes: 0,
  networkBytes: 0,
  gpuBytes: 0,
  lifecycleBytes: 256 * 1_024,
});
const THEME = Object.freeze({
  format: 'omnidraw.widget-theme.v1' as const,
  appearance: 'dark' as const,
  tokens: Object.freeze({
    background: '#000',
    foreground: '#fff',
    surface: '#111',
    surfaceForeground: '#fff',
    muted: '#222',
    mutedForeground: '#aaa',
    primary: '#fc0',
    primaryForeground: '#000',
    accent: '#333',
    accentForeground: '#fff',
    destructive: '#f00',
    success: '#0f0',
    border: '#444',
  }),
});

function createWidgetUiArtifactMountPort(
  args: Omit<
    Parameters<typeof createWidgetUiArtifactMountPortBase>[0],
    'portalContentSize'
  >,
): ReturnType<typeof createWidgetUiArtifactMountPortBase> {
  return createWidgetUiArtifactMountPortBase({
    ...args,
    portalContentSize: {
      readClientWidth: (host) => host.clientWidth,
      readClientHeight: (host) => host.clientHeight,
    },
  });
}

const schema = {
  reference: { format: 'capsule-schema-v1', hash: SCHEMA_HASH },
  copyCanonicalBytes: () => new Uint8Array(),
} as CapsuleSchemaResource;

function descriptor(
  id: string,
  contractHash: typeof HASH_A | typeof HASH_B,
  operations: readonly Readonly<{ name: string; kind: 'call' | 'stream' }>[],
): CapsuleCapabilityDescriptor {
  return {
    id,
    version: '1.0.0',
    contractHash,
    operations: operations.map((operation) => ({
      ...operation,
      inputSchema: schema.reference,
      ...(operation.kind === 'stream'
        ? { eventSchema: schema.reference }
        : { outputSchema: schema.reference }),
    })),
  };
}

const functionDescriptor = descriptor(
  `omnidraw.widget.functions.h${FUNCTION_DESCRIPTOR_DIGEST}`,
  HASH_A,
  [{ name: 'count', kind: 'call' }],
);
const alternateFunctionDescriptor = descriptor(
  `omnidraw.widget.functions.h${'b'.repeat(64)}`,
  HASH_B,
  [{ name: 'count', kind: 'call' }],
);
const stateDescriptor = descriptor(
  'omnidraw.widget.collaborative_state',
  HASH_B,
  [
    { name: 'change', kind: 'call' },
    { name: 'get', kind: 'call' },
    { name: 'subscribe', kind: 'stream' },
  ],
);

function catalog(
  generation = 'catalog-a',
  capabilities = [
    { kind: 'server-functions' as const, descriptor: functionDescriptor },
    { kind: 'collaborative-state' as const, descriptor: stateDescriptor },
  ],
  allowedApis: readonly TWidgetCapsuleApiGroup[] = [
    'DOM',
    'NETWORK',
    'CANVAS_2D',
    'WEBGL',
    'WEBGPU',
  ],
): TWidgetCapsuleMountCatalog {
  return {
    generation,
    allowedApis,
    limits: BUDGETS,
    schemas: [schema],
    capabilities,
    trustedSigningKeys: new Map([
      ['preview-key', {} as CryptoKey],
      ['release-key', {} as CryptoKey],
    ]),
    previewSigningKeyId: 'preview-key',
    releaseSigningKeyId: 'release-key',
  };
}

function runtimeDescriptor(
  mode: 'preview' | 'published',
  requests = [{
    id: functionDescriptor.id,
    versionRange: '1.0.0',
    contractHash: HASH_A,
    required: true,
    operations: ['count'],
  }],
  apis: readonly TWidgetCapsuleApiGroup[] = DOM_APIS,
  channels: TVerifiedWidgetUiArtifact['runtimeDescriptor']['channels'] = null,
) {
  return {
    format: 'omnidraw.capsule-runtime.v2' as const,
    capsuleArtifactHash: HASH_A,
    apiContract: {
      format: 'capsule-api-groups-v1' as const,
      groups: apis,
      bundleDigest: API_BUNDLE_DIGEST,
    },
    budgets: {},
    capabilityRequests: requests,
    channels,
    parkability: { parkable: false as const },
    signatureKeyIds: [mode === 'preview' ? 'preview-key' : 'release-key'],
  };
}

function artifact(
  mode: 'preview' | 'published' = 'published',
  requests?: Parameters<typeof runtimeDescriptor>[1],
  apis?: Parameters<typeof runtimeDescriptor>[2],
  channels?: Parameters<typeof runtimeDescriptor>[3],
): TVerifiedWidgetUiArtifact {
  return {
    digestSha256: 'd'.repeat(64),
    bytes: new Uint8Array([1, 2, 3]),
    capsuleArtifactHash: HASH_A,
    runtimeDescriptor: runtimeDescriptor(mode, requests, apis, channels),
    retainedByteSize: 3,
  };
}

function rawHandle(
  artifactHash = HASH_A,
  apis: readonly TWidgetCapsuleApiGroup[] = DOM_APIS,
) {
  const destroy = vi.fn(async () => undefined);
  const setProps = vi.fn();
  const setTheme = vi.fn();
  const setViewport = vi.fn();
  const errorListeners = new Set<(event: CapsuleMountErrorEvent) => void>();
  const emitError = (event: CapsuleMountErrorEvent): void => {
    for (const listener of errorListeners) listener(event);
  };
  const handle = {
    ready: vi.fn(async () => undefined),
    setSchedulingMode: vi.fn(async () => undefined),
    freeze: vi.fn(async () => undefined),
    snapshot: vi.fn(),
    park: vi.fn(),
    resume: vi.fn(async () => undefined),
    focus: vi.fn(),
    setProps,
    setTheme,
    setViewport,
    destroy,
    onLifecycle: vi.fn(() => ({ unsubscribe: vi.fn() })),
    onOutput: vi.fn(() => ({ unsubscribe: vi.fn() })),
    onError: vi.fn((listener: (event: CapsuleMountErrorEvent) => void) => {
      errorListeners.add(listener);
      return {
        unsubscribe: vi.fn(() => {
          errorListeners.delete(listener);
        }),
      };
    }),
    onMetrics: vi.fn(() => ({ unsubscribe: vi.fn() })),
    diagnostics: vi.fn(() => ({
      artifactHash,
      generation: 1,
      apiContract: {
        format: 'capsule-api-groups-v1',
        bundleDigest: API_BUNDLE_DIGEST,
        requestedApis: apis,
        effectiveApis: apis,
        legacy: false,
        resourceFamilies: [],
      },
    })),
  } as unknown as CapsuleHandle;
  return { destroy, emitError, handle, setProps, setTheme, setViewport };
}

function fakeHostFactory(
  mountedArtifactHash = HASH_A,
  mountError?: unknown,
) {
  const created: Array<{
    options: CreateCapsuleHostOptions;
    host: CapsuleHost;
    mount: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    raw: ReturnType<typeof rawHandle>;
  }> = [];
  const create = vi.fn(async (options: CreateCapsuleHostOptions) => {
    const raw = rawHandle(mountedArtifactHash, options.allowedApis);
    const mount = vi.fn(async () => {
      if (mountError !== undefined) throw mountError;
      return raw.handle;
    });
    const destroy = vi.fn(async () => undefined);
    const host = {
      registerSchema: vi.fn(),
      registerCapabilityDescriptor: vi.fn((value) => ({
        descriptor: value,
        unregister: () => true,
      })),
      mount,
      destroy,
      diagnostics: () => ({ destroyed: false, mounts: 1 }),
    } as unknown as CapsuleHost;
    created.push({ options, host, mount, destroy, raw });
    return host;
  });
  return { create, created };
}

async function settleWithin<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<Readonly<
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown }
  | { status: 'timeout' }
>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      ),
      new Promise<Readonly<{ status: 'timeout' }>>((resolve) => {
        timeout = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

describe('Capsule widget mount boundary', () => {
  test('binds startup and post-mount source locations to exact Preview provenance', async () => {
    const factory = fakeHostFactory();
    const currentCatalog = catalog('catalog-a', []);
    const coordinator = new CapsuleWidgetHostCoordinator({
      document,
      catalog: () => currentCatalog,
      hostFactory: factory,
    });
    const mount = createWidgetUiArtifactMountPort({
      coordinator,
      createStreamId: () => 'stream-a',
      digestSha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
      nowMs: () => 0,
      theme: {
        read: () => THEME,
        subscribe: () => vi.fn(),
      },
      output: { notification: vi.fn() },
    });
    const revision = 'a'.repeat(64);
    const sourceMapArtifact: TVerifiedWidgetSourceMapArtifact = {
      digestSha256: 'e'.repeat(64),
      sourceRevision: revision,
      capsuleArtifactHash: HASH_A,
      authoredPaths: ['src/App.tsx'],
      maps: [{
        module: 'main.js',
        traceMap: new TraceMap({
          version: 3,
          sources: ['src/App.tsx'],
          names: [],
          mappings: 'AAAA',
        }),
      }],
      retainedByteSize: 100,
    };
    const functionBridge: TWidgetFunctionHostBridge = {
      identity: {
        kind: 'draft_preview',
        draftId: 'draft-a',
        definitionId: 'definition-a',
        revision,
      },
      invoke: vi.fn(),
      dispose: vi.fn(),
    };
    const onDiagnostic = vi.fn();
    const handle = await mount.mount({
      mode: 'preview',
      root: document.createElement('div'),
      identity: functionBridge.identity,
      artifact: artifact('preview', []),
      sourceMapArtifact,
      functionDescriptors: [],
      browserFunctionDescriptorsDigestSha256: browserFunctionDigest([]),
      functionBridge,
      collaborativeStateBridge: null,
      onDiagnostic,
      onFatal: vi.fn(),
    });
    const event = {
      format: 'capsule-mount-error-v2',
      sequence: 1,
      timestamp: 1,
      lifecycleGeneration: 1,
      category: 'vm',
      source: 'guest.module',
      code: 'GUEST_EXCEPTION',
      fatal: false,
      artifactHash: HASH_A,
      runtimeGeneration: 1,
      location: { module: 'main.js', line: 1, column: 0 },
    } satisfies CapsuleMountErrorEvent;
    factory.created[0]!.mount.mock.calls[0]![0].onError?.(event);
    factory.created[0]!.raw.emitError({ ...event, sequence: 2 });
    factory.created[0]!.raw.emitError({
      ...event,
      sequence: 3,
      runtimeGeneration: 2,
    });
    factory.created[0]!.raw.emitError({
      ...event,
      sequence: 4,
      artifactHash: HASH_B,
    });
    factory.created[0]!.raw.emitError({
      ...event,
      sequence: 5,
      lifecycleGeneration: 2,
    });
    expect(onDiagnostic.mock.calls[0]![0]).toMatchObject({
      category: 'guest',
      file: 'widget://src/App.tsx',
      line: 1,
      column: 1,
    });
    expect(onDiagnostic.mock.calls[1]![0]).toMatchObject({
      file: 'widget://src/App.tsx',
      line: 1,
      column: 1,
    });
    expect(onDiagnostic.mock.calls[2]![0]).not.toHaveProperty('file');
    expect(onDiagnostic.mock.calls[3]![0]).not.toHaveProperty('file');
    expect(onDiagnostic.mock.calls[4]![0]).not.toHaveProperty('file');

    await handle.destroy('test-complete');

    const publishedBridge: TWidgetFunctionHostBridge = {
      identity: {
        orgId: 'org-a',
        canvasId: 'canvas-a',
        elementId: 'element-a',
        widgetInstanceId: 'instance-a',
        definitionId: 'definition-a',
        revisionId: 'revision-a',
      },
      invoke: vi.fn(),
      dispose: vi.fn(),
    };
    const publishedDiagnostic = vi.fn();
    const publishedHandle = await mount.mount({
      mode: 'published',
      root: document.createElement('div'),
      identity: publishedBridge.identity,
      artifact: artifact('published', []),
      sourceMapArtifact,
      functionDescriptors: [],
      browserFunctionDescriptorsDigestSha256: browserFunctionDigest([]),
      functionBridge: publishedBridge,
      collaborativeStateBridge: null,
      onDiagnostic: publishedDiagnostic,
      onFatal: vi.fn(),
    });
    factory.created[1]!.mount.mock.calls[0]![0].onError?.(event);
    expect(publishedDiagnostic.mock.calls[0]![0]).not.toHaveProperty('file');

    await publishedHandle.destroy('test-complete');
    await coordinator.destroy();
  });

  test('maps a retained Three.js context failure without exposing guest text', async () => {
    const guestFailure = Object.assign(
      new Error('Guest execution threw an exception.'),
      {
        code: 'guest_error',
        guestMessage: 'Error creating WebGL context.',
        guestStack: '/private/widget/source.js',
      },
    );
    const factory = fakeHostFactory(
      HASH_A,
      new CapsuleHostError(
        'MOUNT_FAILED',
        'Capsule mount failed before becoming ready.',
        { cause: guestFailure },
      ),
    );
    const coordinator = new CapsuleWidgetHostCoordinator({
      document,
      catalog: () => catalog('catalog-a', []),
      hostFactory: factory,
    });
    const mount = createWidgetUiArtifactMountPort({
      coordinator,
      createStreamId: () => 'stream-a',
      digestSha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
      nowMs: () => 0,
      theme: {
        read: () => THEME,
        subscribe: () => vi.fn(),
      },
      output: { notification: vi.fn() },
    });
    const functionBridge: TWidgetFunctionHostBridge = {
      identity: {
        kind: 'draft_preview',
        draftId: 'draft-a',
        definitionId: 'definition-a',
        revision: 'revision-a',
      },
      invoke: vi.fn(),
      dispose: vi.fn(),
    };

    const outcome = await settleWithin(mount.mount({
      mode: 'preview',
      root: document.createElement('div'),
      identity: functionBridge.identity,
      artifact: artifact('preview', []),
      functionDescriptors: [],
      browserFunctionDescriptorsDigestSha256: browserFunctionDigest([]),
      functionBridge,
      collaborativeStateBridge: null,
      onFatal: vi.fn(),
    }), 1_000);

    expect(outcome).toEqual({
      status: 'rejected',
      reason: {
        format: 'omnidraw.capsule-error.v1',
        phase: 'host',
        category: 'capability',
        capsuleCode: 'WEBGL_CONTEXT_UNAVAILABLE',
        fatal: true,
        message: 'WebGL Preview requires browser WebGL2 support and the public '
          + 'WEBGL API group. Add WEBGL to ui.apis.',
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('/private/widget/source.js');
    expect(factory.created[0]!.destroy).toHaveBeenCalledOnce();
    expect(functionBridge.dispose).toHaveBeenCalledOnce();
    await coordinator.destroy();
  });

  test('sizes the initial viewport from intrinsic host dimensions', async () => {
    const factory = fakeHostFactory();
    const coordinator = new CapsuleWidgetHostCoordinator({
      document,
      catalog: () => catalog('catalog-a', []),
      hostFactory: factory,
    });
    const mount = createWidgetUiArtifactMountPort({
      coordinator,
      createStreamId: () => 'stream-a',
      digestSha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
      nowMs: () => 0,
      theme: {
        read: () => THEME,
        subscribe: () => vi.fn(),
      },
      output: { notification: vi.fn() },
    });
    const root = document.createElement('div');
    Object.defineProperties(root, {
      clientWidth: { configurable: true, value: 552 },
      clientHeight: { configurable: true, value: 874 },
    });
    const transformedBounds = vi.spyOn(root, 'getBoundingClientRect')
      .mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        right: 414,
        bottom: 655.5,
        left: 0,
        width: 414,
        height: 655.5,
        toJSON: () => ({}),
      });
    const functionBridge: TWidgetFunctionHostBridge = {
      identity: {
        kind: 'draft_preview',
        draftId: 'draft-a',
        definitionId: 'definition-a',
        revision: 'revision-a',
      },
      invoke: vi.fn(),
      dispose: vi.fn(),
    };

    const handle = await mount.mount({
      mode: 'published',
      root,
      identity: functionBridge.identity,
      artifact: artifact('published', []),
      functionDescriptors: [],
      browserFunctionDescriptorsDigestSha256: browserFunctionDigest([]),
      functionBridge,
      collaborativeStateBridge: null,
      onFatal: vi.fn(),
    });

    expect(transformedBounds).not.toHaveBeenCalled();
    expect(factory.created[0]!.raw.setViewport).toHaveBeenCalledWith({
      width: 552,
      height: 874,
      scale: root.ownerDocument.defaultView?.devicePixelRatio ?? 1,
      visibility: 'visible',
      distance: 0,
      priority: 0,
      occlusion: 0,
    });

    await handle.destroy();
    await coordinator.destroy();
  });

  test('derives artifact capability schemas and policy through the public adapter', async () => {
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest').mockResolvedValue(
      new Uint8Array(32).buffer,
    );
    const factory = fakeHostFactory();
    const baseCatalog = catalog('catalog-a', []);
    const coordinator = new CapsuleWidgetHostCoordinator({
      document,
      catalog: async () => baseCatalog,
      hostFactory: factory,
    });
    const mount = createWidgetUiArtifactMountPort({
      coordinator,
      createStreamId: () => 'stream-a',
      digestSha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
      nowMs: () => 0,
      theme: {
        read: () => THEME,
        subscribe: () => vi.fn(),
      },
      output: { notification: vi.fn() },
    });
    const functionBridge: TWidgetFunctionHostBridge = {
      identity: {
        kind: 'draft_preview',
        draftId: 'draft-a',
        definitionId: 'definition-a',
        revision: 'revision-a',
      },
      invoke: vi.fn(),
      dispose: vi.fn(),
    };

    try {
      const handle = await mount.mount({
        mode: 'published',
        root: document.createElement('div'),
        identity: functionBridge.identity,
        artifact: artifact(),
        functionDescriptors: functionMetadata,
        browserFunctionDescriptorsDigestSha256: browserFunctionDigest(functionMetadata),
        functionBridge,
        collaborativeStateBridge: null,
        onFatal: vi.fn(),
      });

      expect(factory.created).toHaveLength(1);
      expect(factory.created[0]!.options.schemas.length).toBeGreaterThan(0);
      expect(factory.created[0]!.options.capabilities).toEqual([
        expect.objectContaining({
          id: functionDescriptor.id,
          contractHash: HASH_A,
          operations: ['count'],
        }),
      ]);
      await handle.destroy();
      expect(factory.created[0]!.destroy).toHaveBeenCalledOnce();
    } finally {
      digest.mockRestore();
    }
  });

  test('pins the retained server-function binding boundary with an actionable diagnostic', async () => {
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest').mockResolvedValue(
      new Uint8Array(32).buffer,
    );
    const factory = fakeHostFactory();
    const coordinator = new CapsuleWidgetHostCoordinator({
      document,
      catalog: () => catalog('catalog-a', []),
      hostFactory: factory,
    });
    const mount = createWidgetUiArtifactMountPort({
      coordinator,
      createStreamId: () => 'stream-a',
      digestSha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
      nowMs: () => 0,
      theme: {
        read: () => THEME,
        subscribe: () => vi.fn(),
      },
      output: { notification: vi.fn() },
    });
    const revision = 'a'.repeat(64);
    const functionBridge: TWidgetFunctionHostBridge = {
      identity: {
        kind: 'draft_preview',
        draftId: 'draft-a',
        definitionId: 'definition-a',
        revision,
      },
      invoke: vi.fn(async () => Object.freeze({ doubled: 42 })),
      dispose: vi.fn(),
    };
    const onDiagnostic = vi.fn();
    const handle = await mount.mount({
      mode: 'preview',
      root: document.createElement('div'),
      identity: functionBridge.identity,
      artifact: artifact('preview'),
      functionDescriptors: functionMetadata,
      browserFunctionDescriptorsDigestSha256: browserFunctionDigest(functionMetadata),
      functionBridge,
      collaborativeStateBridge: null,
      onDiagnostic,
      onFatal: vi.fn(),
    });

    // The retained generated binding mounts before any guest interaction.
    const mountOptions = factory.created[0]!.mount.mock.calls[0]![0];
    const binding = mountOptions.capabilityBindings[0]!;
    expect(binding.descriptor.id).toBe(functionDescriptor.id);

    // A deferred click-time invocation crosses the bridge unchanged.
    await binding.invoke(
      { signal: new AbortController().signal } as never,
      'count',
      Object.freeze({ value: 21 }),
    );
    expect(functionBridge.invoke).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'count',
    }));

    // A bridge rejection names the capability and operation, never GUEST_EXCEPTION.
    const event = {
      format: 'capsule-mount-error-v2',
      sequence: 1,
      timestamp: 1,
      lifecycleGeneration: 1,
      category: 'capability',
      source: 'call.failed',
      code: 'CAPABILITY_NOT_FOUND',
      fatal: false,
      capabilityId: functionDescriptor.id,
      operation: 'count',
    } satisfies CapsuleMountErrorEvent;
    mountOptions.onError?.(event);
    factory.created[0]!.raw.emitError({ ...event, sequence: 2 });

    expect(onDiagnostic).toHaveBeenCalledTimes(2);
    const mapped = onDiagnostic.mock.calls[0]![0];
    expect(mapped).toMatchObject({
      format: 'omnidraw.capsule-error.v1',
      category: 'capability',
      capsuleCode: 'CAPABILITY_NOT_FOUND',
      capability: functionDescriptor.id,
      operation: 'count',
    });

    const diagnostic = await fnNormalizePreviewDiagnostic({
      error: mapped,
      phase: 'runtime',
      draftRevision: revision,
      previewRevisionId: 'preview-revision',
      buildSequence: 1,
      timestampMs: 123,
      encodeFingerprint: (value) => Buffer.from(value, 'utf8'),
      digestSha256: async (value) => createHash('sha256').update(value).digest('hex'),
    });
    expect(diagnostic).toMatchObject({
      origin: 'capability',
      phase: 'runtime',
      code: 'CAPABILITY_NOT_FOUND',
      capability: functionDescriptor.id,
      operation: 'count',
      remediation: 'generated-binding',
      retryability: 'non-retryable',
    });
    expect(diagnostic.code).not.toBe('GUEST_EXCEPTION');
    expect(diagnostic.message).toContain('server-function binding');

    await handle.destroy('test-complete');
    await coordinator.destroy();
    digest.mockRestore();
  });

  test('rejects browser descriptor field mutations before provider creation', async () => {
    const factory = fakeHostFactory();
    const coordinator = new CapsuleWidgetHostCoordinator({
      document,
      catalog: () => catalog('catalog-a', []),
      hostFactory: factory,
    });
    const mount = createWidgetUiArtifactMountPort({
      coordinator,
      createStreamId: () => 'stream-a',
      digestSha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
      nowMs: () => 0,
      theme: {
        read: () => THEME,
        subscribe: () => vi.fn(),
      },
      output: { notification: vi.fn() },
    });
    const expectedDigestSha256 = browserFunctionDigest(functionMetadata);
    const baseline = functionMetadata[0]!;
    const mutations: readonly TWidgetBrowserFunctionDescriptor[] = [
      { ...baseline, effect: 'tx' },
      { ...baseline, inputSchema: { type: 'string' } },
      {
        ...baseline,
        limits: { ...baseline.limits, timeoutMs: 2_000 },
      },
    ];

    for (const mutation of mutations) {
      const functionBridge: TWidgetFunctionHostBridge = {
        identity: {
          kind: 'draft_preview',
          draftId: 'draft-a',
          definitionId: 'definition-a',
          revision: 'revision-a',
        },
        invoke: vi.fn(),
        dispose: vi.fn(),
      };
      await expect(mount.mount({
        mode: 'published',
        root: document.createElement('div'),
        identity: functionBridge.identity,
        artifact: artifact(),
        functionDescriptors: [mutation],
        browserFunctionDescriptorsDigestSha256: expectedDigestSha256,
        functionBridge,
        collaborativeStateBridge: null,
        onFatal: vi.fn(),
      })).rejects.toThrow('failed integrity verification');
      expect(functionBridge.dispose).toHaveBeenCalledOnce();
    }

    const signedMismatchBridge: TWidgetFunctionHostBridge = {
      identity: {
        kind: 'draft_preview',
        draftId: 'draft-a',
        definitionId: 'definition-a',
        revision: 'revision-a',
      },
      invoke: vi.fn(),
      dispose: vi.fn(),
    };
    await expect(mount.mount({
      mode: 'published',
      root: document.createElement('div'),
      identity: signedMismatchBridge.identity,
      artifact: artifact('published', [{
        id: `omnidraw.widget.functions.h${'b'.repeat(64)}`,
        versionRange: '1.0.0',
        contractHash: HASH_B,
        required: true,
        operations: ['count'],
      }]),
      functionDescriptors: functionMetadata,
      browserFunctionDescriptorsDigestSha256: expectedDigestSha256,
      functionBridge: signedMismatchBridge,
      collaborativeStateBridge: null,
      onFatal: vi.fn(),
    })).rejects.toThrow('does not match the signed capability request');
    expect(signedMismatchBridge.dispose).toHaveBeenCalledOnce();

    expect(factory.create).not.toHaveBeenCalled();
  });

  test('delivers fixed props/theme/output channels and releases listeners at destroy', async () => {
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
      async (_algorithm, value) => {
        const bytes = ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          : new Uint8Array(value);
        return Uint8Array.from(
          createHash('sha256').update(bytes).digest(),
        ).buffer;
      },
    );
    try {
      const channelContract = await createOmnidrawGuestChannelContract({
        localStore: 'ephemeral',
      });
    const factory = fakeHostFactory();
    const coordinator = new CapsuleWidgetHostCoordinator({
      document,
      catalog: () => catalog('catalog-a', []),
      hostFactory: factory,
    });
    const themeListeners = new Set<(value: TWidgetCapsuleTheme) => void>();
    const releaseTheme = vi.fn();
    const notification = vi.fn();
    let now = 1_000;
    const mount = createWidgetUiArtifactMountPort({
      coordinator,
      createStreamId: () => 'stream-a',
      digestSha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
      nowMs: () => now,
      theme: {
        read: () => THEME,
        subscribe(listener) {
          themeListeners.add(listener);
          return () => {
            themeListeners.delete(listener);
            releaseTheme();
          };
        },
      },
      output: { notification },
    });
    const functionBridge: TWidgetFunctionHostBridge = {
      identity: {
        kind: 'draft_preview',
        draftId: 'draft-a',
        definitionId: 'definition-a',
        revision: 'revision-a',
      },
      invoke: vi.fn(),
      dispose: vi.fn(),
    };
    const handle = await mount.mount({
      mode: 'published',
      root: document.createElement('div'),
      identity: functionBridge.identity,
      artifact: artifact(
        'published',
        [],
        DOM_APIS,
        channelContract.declaration,
      ),
      functionDescriptors: [],
      browserFunctionDescriptorsDigestSha256: browserFunctionDigest([]),
      functionBridge,
      collaborativeStateBridge: null,
      props: { count: 1 },
      onFatal: vi.fn(),
    });
    const hostMount = factory.created[0]!.mount.mock.calls[0]![0];
    expect(hostMount.guestChannels).toMatchObject({
      props: {
        schema: channelContract.declaration.props,
        initial: { count: 1 },
      },
      theme: {
        schema: channelContract.declaration.theme,
        initial: THEME,
      },
      output: {
        schema: channelContract.declaration.output,
      },
      store: {
        schema: channelContract.declaration.store?.schema,
        maxEntries: 64,
      },
    });

    handle.setProps({ count: 2 });
    expect(factory.created[0]!.raw.setProps).toHaveBeenCalledWith({ count: 2 });
    const nextTheme = {
      ...THEME,
      appearance: 'light' as const,
    };
    for (const listener of themeListeners) listener(nextTheme);
    expect(factory.created[0]!.raw.setTheme).toHaveBeenCalledWith(nextTheme);

    const onOutput = hostMount.guestChannels?.output?.onOutput;
    if (onOutput === undefined) throw new Error('Expected output channel callback.');
    expect(() => onOutput({
      type: 'open-url',
      tone: 'info',
      message: 'https://example.invalid',
    })).toThrow('does not match');
    for (let index = 0; index < 8; index += 1) {
      onOutput({
        type: 'notification',
        tone: 'success',
        message: `Saved ${index}`,
      });
    }
    expect(notification).toHaveBeenCalledTimes(5);
    now += 10_000;
    onOutput({
      type: 'notification',
      tone: 'info',
      message: 'New window',
    });
    expect(notification).toHaveBeenCalledTimes(6);

      await handle.destroy('test-complete');
      expect(releaseTheme).toHaveBeenCalledOnce();
      expect(themeListeners.size).toBe(0);
      const themeCalls = factory.created[0]!.raw.setTheme.mock.calls.length;
      for (const listener of themeListeners) listener(THEME);
      expect(factory.created[0]!.raw.setTheme).toHaveBeenCalledTimes(themeCalls);
      onOutput({
        type: 'notification',
        tone: 'error',
        message: 'Too late',
      });
      expect(notification).toHaveBeenCalledTimes(6);
    } finally {
      digest.mockRestore();
    }
  });

  test('binds server calls to the exact catalog operation', async () => {
    const invoke = vi.fn(async () => ({ count: 2 }));
    const functionBridge: TWidgetFunctionHostBridge = {
      identity: {
        kind: 'draft_preview',
        draftId: 'draft-a',
        definitionId: 'definition-a',
        revision: 'revision-a',
      },
      invoke,
      dispose: vi.fn(),
    };
    const bindings = createWidgetCapsuleCapabilityBindings({
      catalog: catalog(),
      requests: runtimeDescriptor('published').capabilityRequests,
      functionDescriptors: functionMetadata,
      functionBridge,
      collaborativeStateBridge: null,
      createStreamId: () => 'stream-a',
    });

    await expect(bindings[0]!.invoke(
      { signal: new AbortController().signal } as never,
      'count',
      { value: 1 },
    )).resolves.toEqual({ count: 2 });
    expect(invoke).toHaveBeenCalledWith({
      functionName: 'count',
      input: { value: 1 },
      signal: expect.any(AbortSignal),
    });
  });

  test('reports a real provider rejection without destroying the live handle', async () => {
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
      async (_algorithm, value) => {
        const bytes = ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          : new Uint8Array(value);
        return Uint8Array.from(
          createHash('sha256').update(bytes).digest(),
        ).buffer;
      },
    );
    try {
      const factory = fakeHostFactory();
      const currentCatalog = catalog('catalog-a', []);
      const coordinator = new CapsuleWidgetHostCoordinator({
        document,
        catalog: () => currentCatalog,
        hostFactory: factory,
      });
      const mount = createWidgetUiArtifactMountPort({
        coordinator,
        createStreamId: () => 'stream-a',
        digestSha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
        nowMs: () => 0,
        theme: {
          read: () => THEME,
          subscribe: () => vi.fn(),
        },
        output: { notification: vi.fn() },
      });
      const providerFailure = new Error('provider detail must stay private');
      const functionBridge: TWidgetFunctionHostBridge = {
        identity: {
          kind: 'draft_preview',
          draftId: 'draft-a',
          definitionId: 'definition-a',
          revision: 'revision-a',
        },
        invoke: vi.fn(async () => {
          throw providerFailure;
        }),
        dispose: vi.fn(),
      };
      const onDiagnostic = vi.fn();
      const onFatal = vi.fn();
      const handle = await mount.mount({
        mode: 'preview',
        root: document.createElement('div'),
        identity: functionBridge.identity,
        artifact: artifact('preview'),
        functionDescriptors: functionMetadata,
        browserFunctionDescriptorsDigestSha256: browserFunctionDigest(functionMetadata),
        functionBridge,
        collaborativeStateBridge: null,
        onDiagnostic,
        onFatal,
      });
      const hostMount = factory.created[0]!.mount.mock.calls[0]![0];
      const binding = hostMount.capabilityBindings[0]!;

      await expect(binding.invoke(
        { signal: new AbortController().signal } as never,
        'count',
        { value: 1 },
      )).rejects.toBe(providerFailure);
      factory.created[0]!.raw.emitError({
        format: 'capsule-mount-error-v1',
        sequence: 1,
        timestamp: 1,
        lifecycleGeneration: 1,
        category: 'capability',
        source: 'call.failed',
        code: 'PROVIDER_FAILED',
        fatal: false,
        capabilityId: functionDescriptor.id,
        operation: 'count',
        traceId: 'call-1',
      });

      expect(onDiagnostic).toHaveBeenCalledWith({
        format: 'omnidraw.capsule-error.v1',
        phase: 'runtime',
        category: 'capability',
        capsuleCode: 'PROVIDER_FAILED',
        fatal: false,
        message: 'A widget capability was denied or failed.',
        capability: functionDescriptor.id,
        operation: 'count',
      });
      expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('provider detail');
      expect(onFatal).not.toHaveBeenCalled();
      expect(factory.created[0]!.raw.destroy).not.toHaveBeenCalled();

      await handle.destroy('test-complete');
      await coordinator.destroy();
    } finally {
      digest.mockRestore();
    }
  });

  test('streams one atomic current snapshot and cancels the pending wait', async () => {
    let rejectWait: ((error: Error) => void) | undefined;
    const cancel = vi.fn((waitId: string) => rejectWait?.(new Error(`cancelled:${waitId}`)));
    const state: TWidgetCollaborativeStateBridge = {
      get: vi.fn(async () => ({ version: 3, value: { count: 3 } })),
      change: vi.fn(),
      next: vi.fn(async (_version, _waitId) => await new Promise((_, reject) => {
        rejectWait = reject;
      })),
      cancel,
      dispose: vi.fn(),
    };
    const bindings = createWidgetCapsuleCapabilityBindings({
      catalog: catalog(),
      requests: [{
        id: stateDescriptor.id,
        versionRange: '1.0.0',
        contractHash: HASH_B,
        required: true,
        operations: ['change', 'get', 'subscribe'],
      }],
      functionDescriptors: [],
      functionBridge: {
        identity: {
          kind: 'draft_preview',
          draftId: 'draft-a',
          definitionId: 'definition-a',
          revision: 'revision-a',
        },
        invoke: vi.fn(),
        dispose: vi.fn(),
      },
      collaborativeStateBridge: state,
      createStreamId: () => 'wait-a',
    });
    const stream = await bindings[0]!.openStream!(
      {} as never,
      'subscribe',
      null,
    );
    const event = vi.fn(async () => 'accepted' as const);
    const sink: CapsuleKernelHostStreamSink = {
      event,
      error: vi.fn(),
      close: vi.fn(),
    };
    await stream.start(sink);
    await stream.request({ events: 2, bytes: 1_024 });
    await vi.waitFor(() => expect(event).toHaveBeenCalledOnce());
    expect(event).toHaveBeenCalledWith({ version: 3, value: { count: 3 } });
    await stream.cancel({ code: 'guest-cancel' });
    expect(cancel).toHaveBeenCalledWith('wait-a');
    await Promise.resolve();
    expect(sink.error).not.toHaveBeenCalled();
  });

  test('creates one immutable-policy host and fails closed for unknown contracts', async () => {
    const factory = fakeHostFactory();
    const currentCatalog = catalog();
    const coordinator = new CapsuleWidgetHostCoordinator({
      document,
      catalog: () => currentCatalog,
      hostFactory: factory,
    });
    const binding = {
      descriptor: functionDescriptor,
      invoke: vi.fn(),
      dispose: vi.fn(),
    } satisfies CapsuleCapabilityBinding;

    const mounted = await coordinator.mount({
      mode: 'published',
      catalog: currentCatalog,
      artifact: artifact(),
      container: document.createElement('div'),
      capabilityBindings: [binding],
      onFatal: vi.fn(),
    });
    expect(factory.create).toHaveBeenCalledOnce();
    expect(
      factory.created[0]!.options.artifactVerification?.signaturePolicy,
    ).toMatchObject({
      minimumValidSignatures: 1,
      requiredKeyIds: ['release-key'],
      rejectUntrustedSignatures: true,
    });
    expect([
      ...factory.created[0]!.options.artifactVerification!
        .signaturePolicy.trustedKeys.keys(),
    ]).toEqual(['release-key']);
    expect(factory.created[0]!.options.capabilities).toEqual([{
      effect: 'allow',
      id: functionDescriptor.id,
      versionRange: '1.0.0',
      contractHash: HASH_A,
      operations: ['count'],
    }, {
      effect: 'allow',
      id: stateDescriptor.id,
      versionRange: '1.0.0',
      contractHash: HASH_B,
      operations: ['change', 'get', 'subscribe'],
    }]);

    await expect(coordinator.mount({
      mode: 'published',
      catalog: currentCatalog,
      artifact: artifact('published', [{
        id: 'omnidraw.widget.unknown',
        versionRange: '1.0.0',
        contractHash: HASH_B,
        required: true,
        operations: ['read'],
      }]),
      container: document.createElement('div'),
      capabilityBindings: [],
      onFatal: vi.fn(),
    })).rejects.toThrow('not in the host catalog');
    await mounted.destroy();
    await coordinator.destroy();
  });

  test('rejects a mounted artifact-hash mismatch without nesting coordinator serialization', async () => {
    const factory = fakeHostFactory(HASH_B);
    const currentCatalog = catalog();
    const coordinator = new CapsuleWidgetHostCoordinator({
      document,
      catalog: () => currentCatalog,
      hostFactory: factory,
    });
    const binding = {
      descriptor: functionDescriptor,
      invoke: vi.fn(),
      dispose: vi.fn(),
    } satisfies CapsuleCapabilityBinding;

    const settled = await settleWithin(coordinator.mount({
      mode: 'published',
      catalog: currentCatalog,
      artifact: artifact(),
      container: document.createElement('div'),
      capabilityBindings: [binding],
      onFatal: vi.fn(),
    }), 100);

    expect(settled.status).toBe('rejected');
    if (settled.status === 'rejected') {
      expect(settled.reason).toEqual(new Error(
        'Mounted Capsule artifact hash does not match runtime metadata.',
      ));
    }
    expect(factory.created[0]!.raw.destroy).toHaveBeenCalledOnce();
    expect(factory.created[0]!.raw.destroy)
      .toHaveBeenCalledWith('artifact-hash-mismatch');
    expect(factory.created[0]!.destroy).toHaveBeenCalledOnce();
    expect(binding.dispose).toHaveBeenCalledOnce();
    expect(coordinator.diagnostics()).toMatchObject({
      handles: 0,
      hosts: [],
    });
    await expect(settleWithin(coordinator.destroy(), 100)).resolves.toMatchObject({
      status: 'fulfilled',
    });
    expect(coordinator.diagnostics()).toMatchObject({
      destroyed: true,
      handles: 0,
      hosts: [],
    });
  });

  test('catalog generation replacement destroys logical handles before the host', async () => {
    const factory = fakeHostFactory();
    let currentCatalog = catalog('catalog-a');
    const coordinator = new CapsuleWidgetHostCoordinator({
      document,
      catalog: () => currentCatalog,
      hostFactory: factory,
    });
    const onFatal = vi.fn();
    const mounted = await coordinator.mount({
      mode: 'published',
      catalog: currentCatalog,
      artifact: artifact(),
      container: document.createElement('div'),
      capabilityBindings: [{
        descriptor: functionDescriptor,
        invoke: vi.fn(),
        dispose: vi.fn(),
      }],
      onFatal,
    });

    currentCatalog = catalog('catalog-b');
    await coordinator.replaceCatalog();
    expect(factory.created).toHaveLength(1);
    expect(factory.created[0]!.raw.destroy).toHaveBeenCalledWith(
      'catalog-generation-changed',
    );
    expect(factory.created[0]!.destroy).toHaveBeenCalledOnce();
    expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({
      code: 'WIDGET_CAPSULE_CATALOG_INVALIDATED',
      reason: 'catalog-generation-changed',
    }));
    await expect(mounted.destroy()).resolves.toBeUndefined();
    expect(factory.created[0]!.raw.destroy).toHaveBeenCalledOnce();
    await coordinator.mount({
      mode: 'published',
      catalog: currentCatalog,
      artifact: artifact(),
      container: document.createElement('div'),
      capabilityBindings: [{
        descriptor: functionDescriptor,
        invoke: vi.fn(),
        dispose: vi.fn(),
      }],
      onFatal: vi.fn(),
    });
    expect(factory.created).toHaveLength(2);
    await coordinator.destroy();
  });

  test('shares hosts by exact public APIs and never widens one host', async () => {
    const factory = fakeHostFactory();
    const currentCatalog = catalog(
      'catalog-a',
      [
        { kind: 'server-functions', descriptor: functionDescriptor },
        { kind: 'collaborative-state', descriptor: stateDescriptor },
      ],
      ['DOM', 'CANVAS_2D'],
    );
    const coordinator = new CapsuleWidgetHostCoordinator({
      document,
      catalog: () => currentCatalog,
      hostFactory: factory,
    });
    const mount = (apis: readonly TWidgetCapsuleApiGroup[] = DOM_APIS) => coordinator.mount({
      mode: 'published' as const,
      catalog: currentCatalog,
      artifact: artifact('published', undefined, apis),
      container: document.createElement('div'),
      capabilityBindings: [{
        descriptor: functionDescriptor,
        invoke: vi.fn(),
        dispose: vi.fn(),
      }],
      onFatal: vi.fn(),
    });

    await mount();
    await mount();
    await mount(CANVAS_APIS);
    expect(factory.create).toHaveBeenCalledTimes(2);
    expect(factory.created.map(({ options }) => options.allowedApis))
      .toEqual([DOM_APIS, CANVAS_APIS]);
    await coordinator.destroy();
  });

  test('creates a NETWORK host partition without restating policy at mount', async () => {
    const factory = fakeHostFactory();
    const currentCatalog = catalog(
      'catalog-a',
      [
        { kind: 'server-functions', descriptor: functionDescriptor },
        { kind: 'collaborative-state', descriptor: stateDescriptor },
      ],
      NETWORK_APIS,
    );
    const coordinator = new CapsuleWidgetHostCoordinator({
      document,
      catalog: () => currentCatalog,
      hostFactory: factory,
    });

    await coordinator.mount({
      mode: 'published',
      catalog: currentCatalog,
      artifact: artifact('published', undefined, NETWORK_APIS),
      container: document.createElement('div'),
      capabilityBindings: [{
        descriptor: functionDescriptor,
        invoke: vi.fn(),
        dispose: vi.fn(),
      }],
      onFatal: vi.fn(),
    });

    expect(factory.created).toHaveLength(1);
    expect(factory.created[0]!.options.allowedApis).toEqual(NETWORK_APIS);
    const mountOptions = factory.created[0]!.mount.mock.calls[0]![0];
    expect(mountOptions).not.toHaveProperty('allowedApis');
    expect(mountOptions).not.toHaveProperty('limits');
    await coordinator.destroy();
  });

  test('partitions the shared pool by cryptographically required signing authority', async () => {
    const factory = fakeHostFactory();
    const currentCatalog = catalog();
    const coordinator = new CapsuleWidgetHostCoordinator({
      document,
      catalog: () => currentCatalog,
      hostFactory: factory,
    });
    const mount = (mode: 'preview' | 'published') => coordinator.mount({
      mode,
      catalog: currentCatalog,
      artifact: artifact(mode),
      container: document.createElement('div'),
      capabilityBindings: [{
        descriptor: functionDescriptor,
        invoke: vi.fn(),
        dispose: vi.fn(),
      }],
      onFatal: vi.fn(),
    });

    await mount('preview');
    await mount('preview');
    await mount('published');
    expect(factory.create).toHaveBeenCalledTimes(2);
    expect(factory.created.map(({ options }) => (
      options.artifactVerification?.signaturePolicy.requiredKeyIds
    ))).toEqual([['preview-key'], ['release-key']]);
    await coordinator.destroy();
  });

  test('keeps live mounts stable while partitioning immutable capability policies', async () => {
    const factory = fakeHostFactory();
    const currentCatalog = catalog('catalog-a', []);
    const coordinator = new CapsuleWidgetHostCoordinator({
      document,
      catalog: () => currentCatalog,
      hostFactory: factory,
    });
    const firstCatalog = catalog('catalog-a', [{
      kind: 'server-functions',
      descriptor: functionDescriptor,
    }]);
    const secondCatalog = catalog('catalog-a', [{
      kind: 'server-functions',
      descriptor: alternateFunctionDescriptor,
    }]);
    const first = await coordinator.mount({
      mode: 'published',
      catalog: firstCatalog,
      artifact: artifact(),
      container: document.createElement('div'),
      capabilityBindings: [{
        descriptor: functionDescriptor,
        invoke: vi.fn(),
        dispose: vi.fn(),
      }],
      onFatal: vi.fn(),
    });
    const second = await coordinator.mount({
      mode: 'published',
      catalog: secondCatalog,
      artifact: artifact('published', [{
        id: alternateFunctionDescriptor.id,
        versionRange: '1.0.0',
        contractHash: HASH_B,
        required: true,
        operations: ['count'],
      }]),
      container: document.createElement('div'),
      capabilityBindings: [{
        descriptor: alternateFunctionDescriptor,
        invoke: vi.fn(),
        dispose: vi.fn(),
      }],
      onFatal: vi.fn(),
    });

    expect(factory.created).toHaveLength(2);
    expect(factory.created[0]!.destroy).not.toHaveBeenCalled();
    await first.destroy();
    expect(factory.created[0]!.destroy).toHaveBeenCalledOnce();
    expect(factory.created[1]!.destroy).not.toHaveBeenCalled();
    await second.destroy();
    expect(factory.created[1]!.destroy).toHaveBeenCalledOnce();
  });
});
