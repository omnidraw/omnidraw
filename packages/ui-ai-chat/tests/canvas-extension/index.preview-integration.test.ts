import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { CANVAS_SYNTHETIC_CONTENT_LAYER_ID } from '@vibecanvas/canvas-contract';
import { createWidgetPlacementCoordinator } from '../../src/widget-placement/WidgetPlacementCoordinator';
import {
  fnCanvasWidgetExtension,
  fnCreateAiWidgetNode,
  fnCreatePreviewWidgetNode,
  fnPreviewWidgetPayload,
} from '../../src/canvas-extension/fn.canvas-widget';

const mockedChat = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));
const mockedArtifactMount = vi.hoisted(() => ({
  destroy: vi.fn(async () => undefined),
  mount: vi.fn(),
}));

vi.mock('../../src/chat/components', () => ({
  AiChat: (props: Record<string, unknown>) => {
    mockedChat.props = props;
    const root = document.createElement('div');
    root.textContent = 'AI Chat';
    return root;
  },
}));
vi.mock('../../src/widget-runtime/mount-widget-ui-artifact', () => ({
  createWidgetUiArtifactMountPort: () => mockedArtifactMount,
}));

import { createAiChatCanvasExtension } from '../../src/canvas-extension';

const DRAFT_ID = '10000000-0000-4000-8000-000000000001';
const CHAT_ID = '20000000-0000-4000-8000-000000000002';
const DEFINITION_ID = '30000000-0000-4000-8000-000000000003';
const REVISION_ID = '40000000-0000-4000-8000-000000000004';

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function createEventStream() {
  const queued: unknown[] = [];
  const waiting: Array<(value: IteratorResult<unknown>) => void> = [];
  let closed = false;
  return {
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<unknown>> {
            if (queued.length > 0) {
              return Promise.resolve({ done: false, value: queued.shift() });
            }
            if (closed) return Promise.resolve({ done: true, value: undefined });
            return new Promise((resolve) => waiting.push(resolve));
          },
          return(): Promise<IteratorResult<unknown>> {
            closed = true;
            for (const resolve of waiting.splice(0)) {
              resolve({ done: true, value: undefined });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    },
    push(event: unknown) {
      const resolve = waiting.shift();
      if (resolve) resolve({ done: false, value: event });
      else queued.push(event);
    },
    close() {
      closed = true;
      for (const resolve of waiting.splice(0)) {
        resolve({ done: true, value: undefined });
      }
    },
  };
}

function previewReady(
  previewId = '60000000-0000-4000-8000-000000000006',
  override: Readonly<{
    revision?: string;
    previewRevisionId?: string;
    buildSequence?: number;
    committedMutationId?: string;
  }> = {},
) {
  const revision = override.revision ?? 'draft-revision';
  const bytes = Buffer.from('export default 1;', 'utf8');
  return {
    ready: true,
    draftId: DRAFT_ID,
    definitionId: DEFINITION_ID,
    name: 'Weather',
    revision,
    manifest: {
      schemaVersion: 3,
      name: 'Weather',
      slug: 'weather',
      ui: {
        runtime: 'capsule',
        entry: 'ui/main.ts',
        apis: ['DOM'],
      },
    },
    uiArtifact: {
      digestSha256: digest(bytes),
      byteSize: bytes.byteLength,
      bytesBase64: bytes.toString('base64'),
      runtimeDescriptor: {
        format: 'vibecanvas.capsule-runtime.v2',
        capsuleArtifactHash: `sha256:${'b'.repeat(64)}`,
        apiContract: {
          format: 'capsule-api-groups-v1',
          groups: ['DOM'],
          bundleDigest: `sha256:${'a'.repeat(64)}`,
        },
        budgets: {
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
        },
        capabilityRequests: [],
        channels: null,
        parkability: { parkable: false },
        signatureKeyIds: ['preview-key'],
      },
    },
    contract: {
      digestSha256: 'c'.repeat(64),
      functions: [{
        schemaVersion: 1,
        exportName: 'count',
        effect: 'fn',
        inputSchema: {},
        outputSchema: {},
        resources: [],
        limits: {
          timeoutMs: 1_000,
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
      }],
      browserFunctionDescriptorsDigestSha256: 'd'.repeat(64),
    },
    diagnostics: [],
    previewId,
    previewRevisionId:
      override.previewRevisionId ?? 'b0000000-0000-4000-8000-00000000000b',
    buildSequence: override.buildSequence ?? 1,
    committedMutationId:
      override.committedMutationId ?? 'mutation-preview-integration',
    bindingRevision: 0,
    bindingPlanDigestSha256: 'e'.repeat(64),
  } as const;
}

function previewOwner(
  input: {
    previewId: string;
    canvasId: string;
    frameNodeId: string;
    draftId: string;
    originChatId: string;
    role: 'companion' | 'placed';
  },
  override: Readonly<{ id?: string; frameNodeId?: string }> = {},
) {
  return {
    orgId: 'org-1',
    id: override.id ?? input.previewId,
    accountId: 'account-1',
    canvasId: input.canvasId,
    frameNodeId: override.frameNodeId ?? input.frameNodeId,
    draftId: input.draftId,
    originChatId: input.originChatId,
    role: input.role,
    status: 'queued',
    activeRevisionId: null,
    pendingBuildId: null,
    buildSequence: 0,
    bindingRevision: 0,
    bindingPlanDigestSha256: null,
    sourceDigestSha256: null,
    committedMutationId: null,
    runtimeDiagnostics: [],
    publishedPreviewRevisionId: null,
    publishedBindingRevision: null,
    publishedBindingPlanDigestSha256: null,
    publishedWidgetRevisionId: null,
    publishedIdempotencyKey: null,
    lastError: null,
    createdAtMs: 1,
    updatedAtMs: 1,
    closedAtMs: null,
  } as const;
}

function fixture() {
  mockedArtifactMount.mount.mockReset();
  mockedArtifactMount.destroy.mockClear();
  mockedArtifactMount.mount.mockImplementation(async (mountArgs) => {
    mountArgs.root.textContent = 'Mounted Preview';
    return {
      ready: vi.fn(async () => undefined),
      setProps: vi.fn(),
      setTheme: vi.fn(),
      setViewport: vi.fn(),
      focus: vi.fn(),
      setSchedulingMode: vi.fn(async () => undefined),
      freeze: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      diagnostics: vi.fn(() => ({})),
      destroy: vi.fn(async () => undefined),
    };
  });
  const container = document.createElement('div');
  document.body.append(container);
  const aiNode = fnCreateAiWidgetNode({
    id: 'chat-frame',
    parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
    orderKey: 'a',
    position: { x: 10, y: 20 },
    size: { width: 360, height: 300 },
    title: 'AI Chat',
    sessionId: 'session-1',
  });
  const nodes = new Map([[aiNode.id, aiNode]]);
  const sceneListeners = new Set<() => void>();
  const cameraListeners = new Set<() => void>();
  const portalRegistrations = new Map<string, {
    config: {
      mount(args: { host: HTMLDivElement }): void | (() => void | Promise<void>);
    };
    cleanup?: () => void | Promise<void>;
  }>();
  const registerPortal = vi.fn((config: {
    portalId: string;
    mount(args: { host: HTMLDivElement }): void | (() => void | Promise<void>);
  }) => {
    const registration = { config };
    portalRegistrations.set(config.portalId, registration);
    return () => {
      void registration.cleanup?.();
      portalRegistrations.delete(config.portalId);
    };
  });
  const setSelection = vi.fn();
  const applySceneCommands = (commands: readonly {
    type: string;
    node?: typeof aiNode;
    nodeId?: string;
  }[]): void => {
    for (const command of commands) {
      if (command.type === 'upsert' && command.node !== undefined) {
        nodes.set(command.node.id, command.node);
      }
      if (command.type === 'remove' && command.nodeId !== undefined) {
        nodes.delete(command.nodeId);
      }
    }
    sceneListeners.forEach((listener) => listener());
  };
  const ids = [
    '50000000-0000-4000-8000-000000000005',
    '60000000-0000-4000-8000-000000000006',
    '70000000-0000-4000-8000-000000000007',
    '80000000-0000-4000-8000-000000000008',
    '90000000-0000-4000-8000-000000000009',
    'a0000000-0000-4000-8000-00000000000a',
    'b0000000-0000-4000-8000-00000000000b',
    'c0000000-0000-4000-8000-00000000000c',
  ];
  const createId = vi.fn(() => {
    const id = ids.shift();
    if (id === undefined) throw new Error('Test ID sequence exhausted.');
    return id;
  });
  const draft = {
    draftId: DRAFT_ID,
    definitionId: DEFINITION_ID,
    chatId: CHAT_ID,
    name: 'Weather',
    displayName: 'Weather Board',
    state: 'new',
    revision: 'draft-revision',
    committedMutationId: 'mutation-preview-integration',
    buildSequence: 1,
    publishedRevisionId: null,
    updatedAt: '2026-07-28T00:00:00.000Z',
    validation: { valid: true, errors: [], warnings: [] },
    previewAvailable: true,
    publishReady: true,
  };
  const getDraft = vi.fn(async () => [undefined, draft] as const);
  const listDrafts = vi.fn(async () => [undefined, [draft]] as const);
  const ensurePreviewOwner = vi.fn(async (input: {
    previewId: string;
    canvasId: string;
    frameNodeId: string;
    draftId: string;
    originChatId: string;
    role: 'companion' | 'placed';
  }) => [undefined, previewOwner(input)] as const);
  const getPreviewOwner = vi.fn(async (input: {
    previewId: string;
    canvasId: string;
    frameNodeId: string;
  }) => [undefined, previewOwner({
    ...input,
    draftId: DRAFT_ID,
    originChatId: CHAT_ID,
    role: 'companion',
  })] as const);
  const listPreviewOwners = vi.fn(async (): Promise<readonly [
    undefined,
    readonly ReturnType<typeof previewOwner>[],
  ]> => [undefined, []] as const);
  const closePreviewOwner = vi.fn(async () => [undefined, true] as const);
  const cancelPreviewBuild = vi.fn(async () => [undefined, true] as const);
  const agentEvents = createEventStream();
  const requestAgentEvents =
    vi.fn(async () => [undefined, agentEvents.iterable] as const);
  const reportPreviewDiagnostic = vi.fn(async () => [undefined, {
    accepted: true,
    deduplicated: false,
  }] as const);
  const getPreviewDiagnostics = vi.fn(async () => [undefined, []] as const);
  const resolvePreviewDiagnostic = vi.fn(async () => [undefined, null] as const);
  const retestPreviewDiagnostic = vi.fn(async () => [undefined, null] as const);
  const acquirePreviewMountLease = vi.fn(async (input: {
    canvasId: string;
    frameNodeId: string;
    leaseId: string;
    previewId: string;
    previewRevisionId: string;
  }) => [undefined, {
    canvasId: input.canvasId,
    frameNodeId: input.frameNodeId,
    leaseId: input.leaseId,
    previewId: input.previewId,
    previewRevisionId: input.previewRevisionId,
    acquiredAtMs: 1,
    renewedAtMs: 1,
    expiresAtMs: 60_001,
  }] as const);
  const renewPreviewMountLease = vi.fn(async (input: {
    canvasId: string;
    frameNodeId: string;
    leaseId: string;
    previewId: string;
    previewRevisionId: string;
  }) => [undefined, {
    canvasId: input.canvasId,
    frameNodeId: input.frameNodeId,
    leaseId: input.leaseId,
    previewId: input.previewId,
    previewRevisionId: input.previewRevisionId,
    acquiredAtMs: 1,
    renewedAtMs: 30_001,
    expiresAtMs: 120_001,
  }] as const);
  const releasePreviewMountLease =
    vi.fn(async () => [undefined, true] as const);
  const buildPreview = vi.fn(async (input: { previewId?: string }) => [
    undefined,
    previewReady(input.previewId),
  ] as const);
  const publishPreview = vi.fn(async (input: {
    draftId: string;
    expectedRevision: string;
  }) => [undefined, {
    published: true,
    draftId: input.draftId,
    definitionId: DEFINITION_ID,
    revision: input.expectedRevision,
    publishedRevisionId: REVISION_ID,
    manifest: previewReady().manifest,
    uiRuntime: previewReady().uiArtifact.runtimeDescriptor,
  }] as const);
  const resolvePlacement = vi.fn(async ({ reference }: {
    reference: { source: 'draft'; name: string; revision: string };
  }) => [undefined, {
    ok: true,
    descriptor: {
      reference,
      bounds: { width: 360, height: 320 },
      kind: 'preview',
      draftId: DRAFT_ID,
      definitionId: null,
      revisionId: null,
      definitionName: null,
      definitionSlug: null,
    },
  }] as const);
  const placement = createWidgetPlacementCoordinator();
  const invokePreviewFunction = vi.fn(async (input: {
    widgetInstanceId: string;
    widgetRevisionId: string;
    functionName: string;
  }) => [undefined, {
    id: 'function-invocation-1',
    functionName: input.functionName,
    widgetRevisionId: input.widgetRevisionId,
    widgetInstanceId: input.widgetInstanceId,
    status: 'succeeded',
    output: { count: 2 },
    failure: null,
    createdAtMs: 1,
    startedAtMs: 1,
    finishedAtMs: 1,
  }] as const);
  const getPreviewFunction = vi.fn();
  const logError = vi.fn();
  const dropdownPresentations = new Map<
    string,
    Readonly<Record<string, Readonly<{
      text?: string;
      disabled?: boolean;
      hidden?: boolean;
    }>>>
  >();
  const setDropdownItemPresentation = vi.fn((
    widgetId: string,
    _headerItemId: string,
    presentation: Readonly<Record<string, Readonly<{
      text?: string;
      disabled?: boolean;
      hidden?: boolean;
    }>>>,
  ) => {
    dropdownPresentations.set(widgetId, presentation);
  });
  const clearDropdownItemPresentation = vi.fn((widgetId: string) => {
    dropdownPresentations.delete(widgetId);
  });
  let nextAnimationFrame = 1;
  let activationListener: ((activation: {
    type: string;
    widgetId: string;
    itemId?: string;
    dropdownItemId?: string;
    control?: string;
  }) => void) | null = null;
  const extension = createAiChatCanvasExtension({
    chatApi: {
      api: {
        agent: {
          events: requestAgentEvents,
          widgetDraft: {
            get: getDraft,
            list: listDrafts,
          },
          widgetPreview: {
            build: buildPreview,
            cancel: cancelPreviewBuild,
            diagnostics: {
              get: getPreviewDiagnostics,
              report: reportPreviewDiagnostic,
              resolve: resolvePreviewDiagnostic,
              retest: retestPreviewDiagnostic,
            },
            mount: {
              acquire: acquirePreviewMountLease,
              renew: renewPreviewMountLease,
              release: releasePreviewMountLease,
            },
            owner: {
              ensure: ensurePreviewOwner,
              get: getPreviewOwner,
              list: listPreviewOwners,
              close: closePreviewOwner,
            },
          },
          widgetPublish: {
            publish: publishPreview,
          },
          widgets: {
            resolvePlacement,
          },
        },
      },
    } as never,
    widgetTransport: {
      api: {
        widget: { runtime: { load: vi.fn() } },
        function: {
          invoke: invokePreviewFunction,
          get: getPreviewFunction,
        },
      },
    } as never,
    chatBrowser: {
      document,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const handle = nextAnimationFrame;
        nextAnimationFrame += 1;
        queueMicrotask(() => callback(0));
        return handle;
      },
      cancelAnimationFrame: vi.fn(),
    } as never,
    widgetBrowser: {
      document,
      createId,
      organizationId: () => 'org-1',
      tenantAuthorityKey: () => 'authority-1',
      now: () => 1,
      nowDate: () => new Date(1),
      setTimeout: (callback: () => void, timeout: number) => (
        window.setTimeout(callback, timeout)
      ),
      clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
      setInterval: (callback: () => void, timeout: number) => (
        window.setInterval(callback, timeout)
      ),
      clearInterval: (timer: unknown) => window.clearInterval(timer as number),
      decodeBase64: (value: string) => Buffer.from(value, 'base64'),
      digestSha256: async (value: Uint8Array) => digest(value),
    },
    application: {
      invalidateResourceCatalog: vi.fn(),
      logError,
    },
    widgetCapsuleHostCatalog: vi.fn(),
    widgetCapsuleTheme: {
      read: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    },
    widgetCapsuleOutput: {
      notification: vi.fn(),
    },
    widgetPlacement: placement,
  });
  const context = {
    config: {
      canvasId: 'canvas-1',
      container,
      notification: {
        showError: vi.fn(),
        showInfo: vi.fn(),
        showSuccess: vi.fn(),
      },
    },
    document: {},
    editor: {
      commitSceneMutation: ({ commands }: {
        commands: readonly {
          type: string;
          node?: typeof aiNode;
          nodeId?: string;
        }[];
      }) => applySceneCommands(commands),
      setSelection,
    },
    engine: {
      scene: {
        get: (id: string) => nodes.get(id) ?? null,
        query: (predicate: (node: typeof aiNode) => boolean) => (
          [...nodes.values()].filter((node) => predicate(node))
        ),
        childrenOf: (parentId: string | null) => (
          [...nodes.values()].filter((node) => node.parentId === parentId)
        ),
        apply: applySceneCommands,
        subscribe: (listener: () => void) => {
          sceneListeners.add(listener);
          return () => sceneListeners.delete(listener);
        },
        transaction: vi.fn(),
      },
      camera: {
        visibleWorldBounds: () => ({
          minX: 0,
          minY: 0,
          maxX: 1_000,
          maxY: 1_000,
        }),
        subscribe: (listener: () => void) => {
          cameraListeners.add(listener);
          return () => cameraListeners.delete(listener);
        },
      },
      portals: {
        register: registerPortal,
        syncNow: vi.fn(),
      },
      geometry: {
        worldBounds: (id: string) => {
          const node = nodes.get(id);
          if (node === undefined) return null;
          return {
            minX: node.transform.position.x,
            minY: node.transform.position.y,
            maxX: node.transform.position.x + node.size.width,
            maxY: node.transform.position.y + node.size.height,
          };
        },
        worldToLocal: (_id: string, point: { x: number; y: number }) => point,
      },
      transients: {
        createOwner: vi.fn(),
      },
    },
    widgets: {
      clearDropdownItemPresentation,
      setDropdownItemPresentation,
      subscribeActivation: vi.fn((listener) => {
        activationListener = listener;
        return () => {
          activationListener = null;
        };
      }),
    },
  };

  return {
    acquirePreviewMountLease,
    aiNode,
    buildPreview,
    cancelPreviewBuild,
    closeAgentEvents: agentEvents.close,
    closePreviewOwner,
    context,
    clearDropdownItemPresentation,
    draft,
    emitAgentEvent: agentEvents.push,
    extension,
    emitActivation: (activation: {
      type: string;
      widgetId: string;
      itemId?: string;
      dropdownItemId?: string;
      control?: string;
    }) => activationListener?.(activation),
    emitManageAction: (widgetId: string, dropdownItemId: string) => (
      activationListener?.({
        type: 'dropdown-item',
        widgetId,
        itemId: 'manage',
        dropdownItemId,
      })
    ),
    getDraft,
    getPreviewFunction,
    getPreviewOwner,
    ensurePreviewOwner,
    invokePreviewFunction,
    listDrafts,
    listPreviewOwners,
    logError,
    nodes,
    notifyScene: () => sceneListeners.forEach((listener) => listener()),
    placement,
    portalRegistrations,
    resolvePlacement,
    publishPreview,
    reportPreviewDiagnostic,
    requestAgentEvents,
    releasePreviewMountLease,
    renewPreviewMountLease,
    setSelection,
    setDropdownItemPresentation,
    dropdownPresentation: (widgetId: string) => (
      dropdownPresentations.get(widgetId)
    ),
  };
}

describe('current Cangine Preview integration', () => {
  test('reconnects with the current draft fence and rejects a stale ready owner', async () => {
    const current = fixture();
    const frameNodeId = '50000000-0000-4000-8000-000000000050';
    const previewId = '60000000-0000-4000-8000-000000000060';
    const ownerInput = {
      previewId,
      canvasId: 'canvas-1',
      frameNodeId,
      draftId: DRAFT_ID,
      originChatId: CHAT_ID,
      role: 'companion' as const,
    };
    const previewNode = fnCreatePreviewWidgetNode({
      id: frameNodeId,
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'b',
      position: { x: 400, y: 20 },
      size: { width: 480, height: 320 },
      title: 'Weather Board Preview',
      previewId,
      draftId: DRAFT_ID,
      originChatId: CHAT_ID,
      role: 'companion',
    });
    current.nodes.set(frameNodeId, previewNode);

    const installed = await current.extension.install(current.context as never);
    const previewPortal = current.portalRegistrations.get(
      previewNode.portal.portalId,
    );
    if (previewPortal === undefined) {
      throw new Error('Preview portal was not registered.');
    }
    const previewHost = document.createElement('div');
    previewPortal.cleanup = previewPortal.config.mount({
      host: previewHost,
    }) ?? undefined;
    await vi.waitFor(() => expect(
      previewHost.querySelector('section')?.dataset.previewStatus,
    ).toBe('ready'));
    const guestContent = previewHost.querySelector<HTMLElement>(
      '[data-preview-guest-content]',
    );
    const logTerminal = previewHost.querySelector<HTMLElement>(
      '[data-preview-log-terminal]',
    );
    if (guestContent === null || logTerminal === null) {
      throw new Error('Preview guest content and log terminal must both mount.');
    }
    expect(guestContent.nextElementSibling).toBe(logTerminal);
    expect(guestContent.textContent).toContain('Mounted Preview');
    expect(logTerminal.textContent).toContain('Showing draft-re • bindings #0');
    const guestImpersonation = document.createElement('div');
    guestImpersonation.dataset.previewLogTerminal = '';
    guestImpersonation.textContent = 'guest log impersonation';
    guestContent.append(guestImpersonation);
    expect(
      previewHost.querySelectorAll(
        ':scope > section > [data-preview-log-terminal]',
      ),
    ).toHaveLength(1);
    expect(current.dropdownPresentation(frameNodeId)?.publish).toEqual({
      disabled: false,
    });
    await vi.waitFor(() => expect(current.requestAgentEvents).toHaveBeenCalledOnce());

    current.getPreviewOwner.mockResolvedValue([
      undefined,
      {
        ...previewOwner(ownerInput),
        status: 'ready',
        activeRevisionId: 'b0000000-0000-4000-8000-00000000000b',
        pendingBuildId: null,
        buildSequence: 1,
        bindingPlanDigestSha256: 'e'.repeat(64),
        sourceDigestSha256: 'draft-revision',
        committedMutationId: 'mutation-preview-integration',
        updatedAtMs: 2,
      },
    ]);
    current.getDraft.mockResolvedValue([
      undefined,
      {
        ...current.draft,
        revision: 'next-revision',
        committedMutationId: 'mutation-next-revision',
        buildSequence: 2,
      },
    ]);
    current.buildPreview.mockResolvedValueOnce([undefined, {
      ready: false,
      draftId: DRAFT_ID,
      revision: 'next-revision',
      reason: 'build-failed',
      message: 'The reconnect build failed.',
      diagnostics: [],
    }]);
    const reconnectedEvents = createEventStream();
    current.requestAgentEvents.mockResolvedValue([
      undefined,
      reconnectedEvents.iterable,
    ]);
    current.closeAgentEvents();
    await vi.waitFor(() => expect(
      current.dropdownPresentation(frameNodeId)?.publish,
    ).toEqual({ disabled: true }));

    await vi.waitFor(
      () => expect(current.requestAgentEvents).toHaveBeenCalledTimes(2),
      { timeout: 2_000 },
    );
    await vi.waitFor(() => expect(current.getPreviewOwner).toHaveBeenCalledWith({
      previewId,
      canvasId: 'canvas-1',
      frameNodeId,
    }));
    await vi.waitFor(() => expect(
      previewHost.querySelector('section')?.dataset.previewStatus,
    ).toBe('error'));
    expect(previewHost.textContent).toContain('The reconnect build failed.');
    expect(current.dropdownPresentation(frameNodeId)?.publish).toEqual({
      disabled: true,
    });
    current.emitManageAction(frameNodeId, 'publish');
    expect(current.publishPreview).not.toHaveBeenCalled();
    expect(document.querySelector(
      `[data-preview-publication-dialog-for="${frameNodeId}"]`,
    )).toBeNull();

    reconnectedEvents.push({
      kind: 'widget-preview',
      type: 'progress',
      previewId,
      draftId: DRAFT_ID,
      revision: 'next-revision',
      sourceDigestSha256: 'next-revision',
      committedMutationId: 'mutation-next-revision',
      buildId: 'reconnected-build-2',
      buildSequence: 2,
      phase: 'failed',
    });
    await vi.waitFor(() => expect(
      previewHost.querySelector('section')?.dataset.previewStatus,
    ).toBe('error'));

    await installed.dispose?.();
  });

  test('does not recover owner state when reconnect draft status is unavailable', async () => {
    const current = fixture();
    const frameNodeId = '50000000-0000-4000-8000-000000000052';
    const previewId = '60000000-0000-4000-8000-000000000062';
    const previewNode = fnCreatePreviewWidgetNode({
      id: frameNodeId,
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'b',
      position: { x: 400, y: 20 },
      size: { width: 480, height: 320 },
      title: 'Weather Board Preview',
      previewId,
      draftId: DRAFT_ID,
      originChatId: CHAT_ID,
      role: 'companion',
    });
    current.nodes.set(frameNodeId, previewNode);

    const installed = await current.extension.install(current.context as never);
    const previewPortal = current.portalRegistrations.get(
      previewNode.portal.portalId,
    );
    if (previewPortal === undefined) {
      throw new Error('Preview portal was not registered.');
    }
    const previewHost = document.createElement('div');
    previewPortal.cleanup = previewPortal.config.mount({
      host: previewHost,
    }) ?? undefined;
    await vi.waitFor(() => expect(
      previewHost.querySelector('section')?.dataset.previewStatus,
    ).toBe('ready'));
    expect(current.dropdownPresentation(frameNodeId)?.publish).toEqual({
      disabled: false,
    });
    await vi.waitFor(() => expect(current.requestAgentEvents).toHaveBeenCalledOnce());

    current.getDraft.mockResolvedValue([
      new Error('Draft status unavailable'),
      undefined,
    ] as never);
    const reconnectedEvents = createEventStream();
    current.requestAgentEvents.mockResolvedValue([
      undefined,
      reconnectedEvents.iterable,
    ]);
    current.closeAgentEvents();

    await vi.waitFor(
      () => expect(current.requestAgentEvents).toHaveBeenCalledTimes(2),
      { timeout: 2_000 },
    );
    await vi.waitFor(() => expect(current.getDraft).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
    }));
    expect(current.getPreviewOwner).not.toHaveBeenCalled();
    expect(current.dropdownPresentation(frameNodeId)?.publish).toEqual({
      disabled: true,
    });
    current.emitManageAction(frameNodeId, 'publish');
    expect(current.publishPreview).not.toHaveBeenCalled();
    expect(document.querySelector(
      `[data-preview-publication-dialog-for="${frameNodeId}"]`,
    )).toBeNull();

    await installed.dispose?.();
  });

  test('refreshes an offscreen owner for same-fence changed events only', async () => {
    const current = fixture();
    const frameNodeId = '50000000-0000-4000-8000-000000000053';
    const previewId = '60000000-0000-4000-8000-000000000063';
    current.nodes.set(frameNodeId, fnCreatePreviewWidgetNode({
      id: frameNodeId,
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'b',
      position: { x: 400, y: 20 },
      size: { width: 480, height: 320 },
      title: 'Weather Board Preview',
      previewId,
      draftId: DRAFT_ID,
      originChatId: CHAT_ID,
      role: 'companion',
    }));

    const installed = await current.extension.install(current.context as never);
    await vi.waitFor(() => expect(current.requestAgentEvents).toHaveBeenCalledOnce());
    const exactChanged = {
      kind: 'widget-draft',
      type: 'changed',
      draftId: DRAFT_ID,
      revision: 'binding-refresh-revision',
      sourceDigestSha256: 'binding-refresh-revision',
      committedMutationId: 'mutation-binding-refresh',
      buildSequence: 2,
    } as const;

    current.emitAgentEvent(exactChanged);
    await vi.waitFor(() => expect(current.buildPreview).toHaveBeenCalledOnce());
    current.emitAgentEvent(exactChanged);
    await vi.waitFor(() => expect(current.buildPreview).toHaveBeenCalledTimes(2));
    current.emitAgentEvent({
      ...exactChanged,
      revision: 'cross-fence-revision',
      sourceDigestSha256: 'cross-fence-revision',
      committedMutationId: 'mutation-cross-fence',
    });
    current.emitAgentEvent({
      ...exactChanged,
      revision: 'stale-revision',
      sourceDigestSha256: 'stale-revision',
      committedMutationId: 'mutation-stale',
      buildSequence: 1,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(current.buildPreview).toHaveBeenCalledTimes(2);
    expect(current.buildPreview).toHaveBeenNthCalledWith(2, {
      draftId: DRAFT_ID,
      previewId,
      canvasId: 'canvas-1',
      frameNodeId,
    });

    await installed.dispose?.();
  });

  test('stops reconnecting after the bounded event-stream backoff is exhausted', async () => {
    vi.useFakeTimers();
    const current = fixture();
    const unavailable = new Error('Preview events unavailable');
    current.requestAgentEvents.mockResolvedValue([
      unavailable,
      undefined,
    ] as never);
    let installed: Awaited<ReturnType<typeof current.extension.install>> | undefined;
    try {
      installed = await current.extension.install(current.context as never);
      await Promise.resolve();
      await vi.runAllTimersAsync();

      expect(current.requestAgentEvents).toHaveBeenCalledTimes(5);
      expect(current.logError).toHaveBeenCalledTimes(5);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(current.requestAgentEvents).toHaveBeenCalledTimes(5);
    } finally {
      await installed?.dispose?.();
      vi.useRealTimers();
    }
  });

  test('closes durable Preview owners whose frames are absent on startup', async () => {
    const current = fixture();
    const missingOwnerInput = {
      previewId: 'a0000000-0000-4000-8000-000000000001',
      canvasId: 'canvas-1',
      frameNodeId: 'missing-preview-frame',
      draftId: DRAFT_ID,
      originChatId: CHAT_ID,
      role: 'placed' as const,
    };
    const liveOwnerInput = {
      previewId: 'b0000000-0000-4000-8000-000000000002',
      canvasId: 'canvas-1',
      frameNodeId: 'live-preview-frame',
      draftId: DRAFT_ID,
      originChatId: CHAT_ID,
      role: 'companion' as const,
    };
    current.nodes.set(liveOwnerInput.frameNodeId, fnCreatePreviewWidgetNode({
      id: liveOwnerInput.frameNodeId,
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'b',
      position: { x: 400, y: 20 },
      size: { width: 480, height: 320 },
      title: 'Weather Board Preview',
      previewId: liveOwnerInput.previewId,
      draftId: liveOwnerInput.draftId,
      originChatId: liveOwnerInput.originChatId,
      role: liveOwnerInput.role,
    }));
    current.listPreviewOwners.mockResolvedValue([
      undefined,
      [previewOwner(missingOwnerInput), previewOwner(liveOwnerInput)],
    ]);

    const installed = await current.extension.install(current.context as never);

    expect(current.listPreviewOwners).toHaveBeenCalledOnce();
    expect(current.listPreviewOwners).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      includeClosed: false,
    });
    expect(current.closePreviewOwner).toHaveBeenCalledOnce();
    expect(current.closePreviewOwner).toHaveBeenCalledWith({
      previewId: missingOwnerInput.previewId,
      canvasId: 'canvas-1',
      frameNodeId: missingOwnerInput.frameNodeId,
    });
    expect(current.closePreviewOwner).not.toHaveBeenCalledWith(
      expect.objectContaining({ previewId: liveOwnerInput.previewId }),
    );

    await installed.dispose?.();
  });

  test('preserves an exact Preview frame restored while startup owner listing is in flight', async () => {
    const current = fixture();
    const restoredOwnerInput = {
      previewId: 'c0000000-0000-4000-8000-000000000003',
      canvasId: 'canvas-1',
      frameNodeId: 'restored-preview-frame',
      draftId: DRAFT_ID,
      originChatId: CHAT_ID,
      role: 'placed' as const,
    };
    let releaseList: (() => void) | undefined;
    current.listPreviewOwners.mockImplementation(async () => {
      await new Promise<void>((resolve) => { releaseList = resolve; });
      return [undefined, [previewOwner(restoredOwnerInput)]] as const;
    });

    const install = current.extension.install(current.context as never);
    await vi.waitFor(() => expect(current.listPreviewOwners).toHaveBeenCalledOnce());
    current.nodes.set(
      restoredOwnerInput.frameNodeId,
      fnCreatePreviewWidgetNode({
        id: restoredOwnerInput.frameNodeId,
        parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
        orderKey: 'b',
        position: { x: 400, y: 20 },
        size: { width: 480, height: 320 },
        title: 'Weather Board Preview',
        previewId: restoredOwnerInput.previewId,
        draftId: restoredOwnerInput.draftId,
        originChatId: restoredOwnerInput.originChatId,
        role: restoredOwnerInput.role,
      }),
    );
    current.notifyScene();
    releaseList?.();
    const installed = await install;

    expect(current.closePreviewOwner).not.toHaveBeenCalled();
    await installed.dispose?.();
  });

  test('fails closed without deleting owners when startup owner listing fails', async () => {
    const current = fixture();
    const listFailure = new Error('owner list unavailable');
    current.listPreviewOwners.mockRejectedValueOnce(listFailure);

    const installed = await current.extension.install(current.context as never);

    expect(current.closePreviewOwner).not.toHaveBeenCalled();
    expect(current.logError).toHaveBeenCalledWith(listFailure);
    await installed.dispose?.();
  });

  test('honors the canonical companion owner returned by an ensure race', async () => {
    const current = fixture();
    const canonicalFrameId = '70000000-0000-4000-8000-000000000007';
    const canonicalPreviewId = '80000000-0000-4000-8000-000000000008';
    current.ensurePreviewOwner.mockImplementationOnce(async (input) => {
      current.nodes.set(canonicalFrameId, fnCreatePreviewWidgetNode({
        id: canonicalFrameId,
        parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
        orderKey: 'b',
        position: { x: 394, y: 20 },
        size: { width: 480, height: 320 },
        title: 'Weather Board Preview',
        previewId: canonicalPreviewId,
        draftId: DRAFT_ID,
        originChatId: CHAT_ID,
        role: 'companion',
      }));
      return [undefined, previewOwner(input, {
        id: canonicalPreviewId,
        frameNodeId: canonicalFrameId,
      })] as const;
    });
    const installed = await current.extension.install(current.context as never);
    const portal = current.portalRegistrations.get(current.aiNode.portal.portalId);
    if (portal === undefined) throw new Error('AI Chat portal was not registered.');
    portal.cleanup = portal.config.mount({
      host: document.createElement('div'),
    }) ?? undefined;
    const openPreview = mockedChat.props?.onOpenWidgetPreview as
      | ((reference: { draftId: string; name: string }) => Promise<void>)
      | undefined;
    if (openPreview === undefined) throw new Error('Preview callback was not mounted.');

    await openPreview({ draftId: DRAFT_ID, name: 'Weather' });

    expect(current.nodes.has(
      '50000000-0000-4000-8000-000000000005',
    )).toBe(false);
    expect(fnPreviewWidgetPayload(current.nodes.get(canonicalFrameId))).toEqual({
      previewId: canonicalPreviewId,
      draftId: DRAFT_ID,
      originChatId: CHAT_ID,
      role: 'companion',
    });
    expect(current.setSelection).toHaveBeenLastCalledWith(
      [canonicalFrameId],
      { focusedNodeId: canonicalFrameId },
    );
    expect(current.closePreviewOwner).not.toHaveBeenCalled();

    await installed.dispose?.();
  });

  test('opens and focuses one companion for the durable draft/chat pair', async () => {
    const current = fixture();
    const installed = await current.extension.install(current.context as never);
    const portal = current.portalRegistrations.get(current.aiNode.portal.portalId);
    if (portal === undefined) throw new Error('AI Chat portal was not registered.');
    const host = document.createElement('div');
    portal.cleanup = portal.config.mount({ host }) ?? undefined;
    const openPreview = mockedChat.props?.onOpenWidgetPreview as
      | ((reference: { draftId: string; name: string }) => Promise<void>)
      | undefined;
    if (openPreview === undefined) throw new Error('Preview callback was not mounted.');

    await Promise.all([
      openPreview({ draftId: DRAFT_ID, name: 'Weather' }),
      openPreview({ draftId: DRAFT_ID, name: 'Weather' }),
    ]);

    const companions = [...current.nodes.values()].filter((node) => (
      fnPreviewWidgetPayload(node)?.role === 'companion'
    ));
    expect(companions).toHaveLength(1);
    expect(companions[0]).toMatchObject({
      title: 'Weather Board Preview',
      transform: { position: { x: 394, y: 20 } },
      size: { width: 480, height: 320 },
    });
    expect(fnPreviewWidgetPayload(companions[0])).toEqual({
      previewId: '60000000-0000-4000-8000-000000000006',
      draftId: DRAFT_ID,
      originChatId: CHAT_ID,
      role: 'companion',
    });
    expect(Object.keys(
      (fnCanvasWidgetExtension(companions[0]) as {
        payload: Record<string, unknown>;
      }).payload,
    ).sort()).toEqual([
      'draftId',
      'originChatId',
      'previewId',
      'role',
    ]);
    expect(current.ensurePreviewOwner).toHaveBeenNthCalledWith(1, {
      previewId: '60000000-0000-4000-8000-000000000006',
      canvasId: 'canvas-1',
      frameNodeId: '50000000-0000-4000-8000-000000000005',
      draftId: DRAFT_ID,
      originChatId: CHAT_ID,
      role: 'companion',
    });
    expect(current.listDrafts).not.toHaveBeenCalled();
    expect(current.setSelection).toHaveBeenLastCalledWith(
      [companions[0]!.id],
      { focusedNodeId: companions[0]!.id },
    );

    const previewPortal = current.portalRegistrations.get(
      companions[0]!.portal.portalId,
    );
    if (previewPortal === undefined) {
      throw new Error('Preview portal was not registered.');
    }
    const previewHost = document.createElement('div');
    previewPortal.cleanup = previewPortal.config.mount({
      host: previewHost,
    }) ?? undefined;
    await vi.waitFor(() => expect(mockedArtifactMount.mount).toHaveBeenCalledOnce());
    expect(current.ensurePreviewOwner).toHaveBeenCalledTimes(2);
    expect(current.ensurePreviewOwner.mock.invocationCallOrder[1])
      .toBeLessThan(current.buildPreview.mock.invocationCallOrder[0]!);
    expect(current.buildPreview).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId: '60000000-0000-4000-8000-000000000006',
      canvasId: 'canvas-1',
      frameNodeId: '50000000-0000-4000-8000-000000000005',
    });
    expect(current.acquirePreviewMountLease).toHaveBeenNthCalledWith(1, {
      previewId: '60000000-0000-4000-8000-000000000006',
      previewRevisionId: 'b0000000-0000-4000-8000-00000000000b',
      canvasId: 'canvas-1',
      frameNodeId: '50000000-0000-4000-8000-000000000005',
      leaseId: '70000000-0000-4000-8000-000000000007',
    });
    expect(current.acquirePreviewMountLease.mock.invocationCallOrder[0])
      .toBeLessThan(mockedArtifactMount.mount.mock.invocationCallOrder[0]!);
    expect(mockedArtifactMount.mount).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'preview',
      identity: {
        kind: 'draft_preview',
        draftId: DRAFT_ID,
        definitionId: DEFINITION_ID,
        revision: 'draft-revision',
      },
      artifact: expect.objectContaining({
        digestSha256: previewReady().uiArtifact.digestSha256,
        bytes: Uint8Array.from(Buffer.from('export default 1;', 'utf8')),
      }),
    }));
    await vi.waitFor(() => {
      expect(previewHost.querySelector('section')?.dataset.previewStatus)
        .toBe('ready');
    });
    expect(previewHost.textContent).toContain('Mounted Preview');
    expect(current.dropdownPresentation(companions[0]!.id)).toEqual({
      'live-updates': { text: 'Pause live updates' },
      'cancel-build': { disabled: true },
      retry: {},
      reset: {},
      publish: { disabled: false },
    });

    current.emitManageAction(companions[0]!.id, 'live-updates');
    expect(
      current.dropdownPresentation(companions[0]!.id)?.['live-updates'],
    ).toEqual({ text: 'Resume live updates' });
    current.emitAgentEvent({
      kind: 'widget-draft',
      type: 'changed',
      draftId: DRAFT_ID,
      revision: 'new-draft-revision',
      sourceDigestSha256: 'new-draft-revision',
      committedMutationId: 'mutation-new-draft-revision',
      buildSequence: 2,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(current.buildPreview).toHaveBeenCalledOnce();

    current.buildPreview.mockResolvedValueOnce([
      undefined,
      previewReady('60000000-0000-4000-8000-000000000006', {
        revision: 'new-draft-revision',
        previewRevisionId: 'd0000000-0000-4000-8000-00000000000d',
        buildSequence: 2,
        committedMutationId: 'mutation-new-draft-revision',
      }),
    ]);
    current.emitManageAction(companions[0]!.id, 'retry');
    await vi.waitFor(() => expect(current.buildPreview).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(mockedArtifactMount.mount).toHaveBeenCalledTimes(2));
    current.emitManageAction(companions[0]!.id, 'live-updates');
    expect(
      current.dropdownPresentation(companions[0]!.id)?.['live-updates'],
    ).toEqual({ text: 'Pause live updates' });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(current.buildPreview).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(current.releasePreviewMountLease)
      .toHaveBeenCalledWith({
        previewId: '60000000-0000-4000-8000-000000000006',
        previewRevisionId: 'b0000000-0000-4000-8000-00000000000b',
        canvasId: 'canvas-1',
        frameNodeId: '50000000-0000-4000-8000-000000000005',
        leaseId: '70000000-0000-4000-8000-000000000007',
      }));
    const functionBridge = mockedArtifactMount.mount.mock.calls.at(-1)![0]
      .functionBridge;
    expect(functionBridge.identity).toEqual({
      orgId: 'org-1',
      canvasId: 'canvas-1',
      elementId: '50000000-0000-4000-8000-000000000005',
      widgetInstanceId: '60000000-0000-4000-8000-000000000006',
      definitionId: DEFINITION_ID,
      revisionId: 'd0000000-0000-4000-8000-00000000000d',
    });
    await expect(functionBridge.invoke({
      functionName: 'count',
      input: { step: 2 },
    })).resolves.toEqual({ count: 2 });
    expect(current.invokePreviewFunction).toHaveBeenCalledWith({
      widgetInstanceId: '60000000-0000-4000-8000-000000000006',
      widgetRevisionId: 'd0000000-0000-4000-8000-00000000000d',
      functionName: 'count',
      input: { step: 2 },
      idempotencyKey: '90000000-0000-4000-8000-000000000009',
    }, {
      signal: expect.any(AbortSignal),
    });

    current.emitManageAction(companions[0]!.id, 'publish');
    const publicationDialog = await vi.waitFor(() => {
      const host = document.querySelector<HTMLElement>(
        `[data-preview-publication-dialog-for="${companions[0]!.id}"]`,
      );
      const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
      expect(host).not.toBeNull();
      expect(dialog).not.toBeNull();
      expect(dialog?.textContent).toContain('Publish Weather Board?');
      return dialog!;
    });
    expect(publicationDialog.textContent).toContain('Draft digest');
    expect(publicationDialog.textContent).toContain('new-draft-re');
    expect(publicationDialog.textContent).toContain('#2 complete');
    expect(publicationDialog.textContent).toContain('Binding revision');
    expect(publicationDialog.textContent).toContain('canvas-1');
    expect(publicationDialog.textContent).toContain(companions[0]!.id);
    expect(current.publishPreview).not.toHaveBeenCalled();
    const confirmPublication = [...publicationDialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Publish');
    expect(confirmPublication).toBeDefined();
    confirmPublication!.click();
    await vi.waitFor(() => expect(current.publishPreview).toHaveBeenCalledWith({
      idempotencyKey: 'a0000000-0000-4000-8000-00000000000a',
      draftId: DRAFT_ID,
      expectedRevision: 'new-draft-revision',
      previewId: '60000000-0000-4000-8000-000000000006',
      previewRevisionId: 'd0000000-0000-4000-8000-00000000000d',
      expectedBindingRevision: 0,
      expectedBindingPlanDigestSha256: 'e'.repeat(64),
      canvasId: 'canvas-1',
      frameNodeId: '50000000-0000-4000-8000-000000000005',
    }));
    await vi.waitFor(() => expect(document.querySelector(
      `[data-preview-publication-dialog-for="${companions[0]!.id}"]`,
    )).toBeNull());
    expect(
      current.dropdownPresentation(companions[0]!.id)?.publish,
    ).toEqual({ disabled: true });

    current.emitAgentEvent({
      kind: 'widget-preview',
      type: 'progress',
      previewId: '60000000-0000-4000-8000-000000000006',
      draftId: DRAFT_ID,
      revision: 'new-draft-revision',
      sourceDigestSha256: 'new-draft-revision',
      committedMutationId: 'mutation-new-draft-revision',
      buildId: 'build-2',
      buildSequence: 2,
      phase: 'building',
    });
    await vi.waitFor(() => expect(
      previewHost.querySelector('section')?.dataset.previewStatus,
    ).toBe('building'));
    expect(
      current.dropdownPresentation(companions[0]!.id)?.publish,
    ).toEqual({ disabled: true });
    expect(
      current.dropdownPresentation(companions[0]!.id)?.['cancel-build'],
    ).toEqual({ disabled: false });
    current.emitManageAction(companions[0]!.id, 'cancel-build');
    await vi.waitFor(() => expect(current.cancelPreviewBuild).toHaveBeenCalledWith({
      previewId: '60000000-0000-4000-8000-000000000006',
      canvasId: 'canvas-1',
      frameNodeId: '50000000-0000-4000-8000-000000000005',
      buildId: 'build-2',
      expectedBuildSequence: 2,
    }));
    await vi.waitFor(() => expect(
      current.dropdownPresentation(companions[0]!.id)?.['cancel-build'],
    ).toEqual({ disabled: true }));
    expect(current.context.config.notification.showSuccess).toHaveBeenCalledWith(
      'Preview build cancelled',
    );
    current.emitManageAction(companions[0]!.id, 'cancel-build');
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(current.cancelPreviewBuild).toHaveBeenCalledOnce();
    expect(current.context.config.notification.showInfo).not.toHaveBeenCalled();
    expect(
      current.dropdownPresentation(companions[0]!.id)?.publish,
    ).toEqual({ disabled: true });
    current.emitManageAction(companions[0]!.id, 'publish');
    expect(document.querySelector(
      `[data-preview-publication-dialog-for="${companions[0]!.id}"]`,
    )).toBeNull();
    expect(current.context.config.notification.showError).not.toHaveBeenCalledWith(
      'Preview is not ready to publish',
      expect.anything(),
    );
    expect(current.publishPreview).toHaveBeenCalledOnce();

    current.nodes.delete(companions[0]!.id);
    await expect(functionBridge.invoke({
      functionName: 'count',
      input: { step: 3 },
    })).rejects.toThrow('target is no longer current');
    expect(current.invokePreviewFunction).toHaveBeenCalledOnce();
    current.nodes.set(companions[0]!.id, companions[0]!);

    await previewPortal.cleanup?.();
    expect(current.clearDropdownItemPresentation).toHaveBeenCalledWith(
      companions[0]!.id,
    );
    expect(current.releasePreviewMountLease).toHaveBeenCalledWith({
      previewId: '60000000-0000-4000-8000-000000000006',
      previewRevisionId: 'd0000000-0000-4000-8000-00000000000d',
      canvasId: 'canvas-1',
      frameNodeId: '50000000-0000-4000-8000-000000000005',
      leaseId: '80000000-0000-4000-8000-000000000008',
    });
    expect(current.releasePreviewMountLease).toHaveBeenCalledTimes(2);
    expect(current.closePreviewOwner).not.toHaveBeenCalled();
    current.nodes.delete(companions[0]!.id);
    current.notifyScene();
    await vi.waitFor(() => expect(current.closePreviewOwner).toHaveBeenCalledWith({
      previewId: '60000000-0000-4000-8000-000000000006',
      canvasId: 'canvas-1',
      frameNodeId: '50000000-0000-4000-8000-000000000005',
    }));

    await installed.dispose?.();
    expect(current.closePreviewOwner).toHaveBeenCalledOnce();
  });

  test('routes Reset from the Manage dropdown through a fresh Preview build', async () => {
    const current = fixture();
    const frameNodeId = '50000000-0000-4000-8000-000000000054';
    const previewId = '60000000-0000-4000-8000-000000000064';
    const previewNode = fnCreatePreviewWidgetNode({
      id: frameNodeId,
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'b',
      position: { x: 400, y: 20 },
      size: { width: 480, height: 320 },
      title: 'Weather Board Preview',
      previewId,
      draftId: DRAFT_ID,
      originChatId: CHAT_ID,
      role: 'companion',
    });
    current.nodes.set(frameNodeId, previewNode);

    const installed = await current.extension.install(current.context as never);
    const previewPortal = current.portalRegistrations.get(
      previewNode.portal.portalId,
    );
    if (previewPortal === undefined) {
      throw new Error('Preview portal was not registered.');
    }
    const previewHost = document.createElement('div');
    previewPortal.cleanup = previewPortal.config.mount({
      host: previewHost,
    }) ?? undefined;
    await vi.waitFor(() => expect(current.buildPreview).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(
      previewHost.querySelector('section')?.dataset.previewStatus,
    ).toBe('ready'));

    current.emitManageAction(frameNodeId, 'reset');

    await vi.waitFor(() => expect(current.buildPreview).toHaveBeenCalledTimes(2));
    expect(current.buildPreview).toHaveBeenNthCalledWith(2, {
      draftId: DRAFT_ID,
      previewId,
      canvasId: 'canvas-1',
      frameNodeId,
    });
    await vi.waitFor(() => expect(mockedArtifactMount.mount).toHaveBeenCalledTimes(2));

    await previewPortal.cleanup?.();
    await installed.dispose?.();
  });

  test('resolves direct Draft placement into an independent Preview and preserves published placement', async () => {
    const current = fixture();
    const installed = await current.extension.install(current.context as never);

    await current.placement.addToCanvas({
      reference: {
        source: 'draft',
        name: 'Weather',
        revision: 'draft-revision',
      },
      bounds: { width: 360, height: 320 },
      label: 'Weather · Draft',
    });

    const placed = [...current.nodes.values()].find((node) => (
      fnPreviewWidgetPayload(node)?.role === 'placed'
    ));
    expect(fnPreviewWidgetPayload(placed)).toEqual({
      previewId: '60000000-0000-4000-8000-000000000006',
      draftId: DRAFT_ID,
      originChatId: CHAT_ID,
      role: 'placed',
    });
    expect(current.ensurePreviewOwner).toHaveBeenCalledWith({
      previewId: '60000000-0000-4000-8000-000000000006',
      canvasId: 'canvas-1',
      frameNodeId: '50000000-0000-4000-8000-000000000005',
      draftId: DRAFT_ID,
      originChatId: CHAT_ID,
      role: 'placed',
    });
    expect(current.listDrafts).toHaveBeenCalledOnce();
    expect(current.resolvePlacement).toHaveBeenCalledWith({
      reference: {
        source: 'draft',
        name: 'Weather',
        revision: 'draft-revision',
      },
      expectedDraftId: DRAFT_ID,
    });

    await current.placement.addToCanvas({
      reference: {
        source: 'published',
        name: `published:${DEFINITION_ID}`,
        revision: REVISION_ID,
      },
      bounds: { width: 360, height: 320 },
      label: 'Weather',
    });
    const published = [...current.nodes.values()].find((node) => (
      fnCanvasWidgetExtension(node)?.type === 'widget-instance'
    ));
    expect(fnCanvasWidgetExtension(published)).toMatchObject({
      type: 'widget-instance',
      definitionId: DEFINITION_ID,
      revisionId: REVISION_ID,
    });
    expect(current.resolvePlacement).toHaveBeenCalledOnce();

    await installed.dispose?.();
  });
});
