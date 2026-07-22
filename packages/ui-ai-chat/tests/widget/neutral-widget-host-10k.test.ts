import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { TCrdtChangeSummary } from '@vibecanvas/canvas/services';
import { fnToWidgetElement } from '@vibecanvas/canvas/widget-host/fn.to-widget-element';
import type { TElement } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import { ThemeService } from '@vibecanvas/service-theme';
import { SyncHook } from '@vibecanvas/tapable';
import Konva from 'konva';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { WidgetUiRuntime } from '../../src/widget-runtime/WidgetUiRuntime';
import {
  WIDGET_UI_MAX_ACTIVE_RENDERS,
  WIDGET_UI_MAX_QUEUED_RENDERS,
} from '../../src/widget-runtime/CONSTANTS';
import { widgetUiArtifactMount } from '../../src/widget-runtime/mount-widget-ui-artifact';
import { WidgetManagerService } from '../../src/widget/WidgetManagerService';
import { createTestContainer, createTestWidgetBrowser, ensureDom } from '../test-setup';

const INSTANCE_COUNT = 10_000;
const ORG_ID = '00000000-0000-4000-8000-000000000001';
const CANVAS_ID = '00000000-0000-4000-8000-000000000002';
const DEFINITION_ID = '00000000-0000-4000-8000-000000000003';
const REVISION_ID = '00000000-0000-4000-8000-000000000004';
const DIGEST = 'a'.repeat(64);
// The production 1,200×800 portal viewport and 160px preload margin select
// 57 columns by 52 rows from this deterministic fixture. Everything else
// stays unmounted before it reaches the runtime admission boundary.
const PRELOADED_INSTANCE_COUNT = 2_964;
const testRequire = createRequire(import.meta.url);
const arrowSandboxPath = testRequire.resolve('@arrow-js/sandbox');
const quickJsPath = createRequire(arrowSandboxPath).resolve('quickjs-emscripten');
const quickJsWasmPath = createRequire(quickJsPath)
  .resolve('@jitl/quickjs-wasmfile-release-asyncify/wasm');
const quickJsWasm = readFileSync(quickJsWasmPath);
const originalFetch = globalThis.fetch.bind(globalThis);

beforeAll(() => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/emscripten-module.wasm')) {
      return new Response(quickJsWasm, {
        headers: { 'content-type': 'application/wasm' },
        status: 200,
      });
    }
    return originalFetch(input, init);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

type TRegisteredElementDefinition = Readonly<{
  id: string;
  matchesElement?(element: TElement): boolean;
  createNode?(element: TElement): Konva.Node | null;
  attachListeners?(node: Konva.Node): boolean | void;
  toElement?(node: Konva.Node): TElement | null;
}>;

function element(index: number): TElement {
  return {
    id: `widget-element-${String(index).padStart(5, '0')}`,
    x: (index % 100) * 24,
    y: Math.floor(index / 100) * 18,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: `z-${String(index).padStart(5, '0')}`,
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    data: {
      type: 'widget-instance',
      definitionId: DEFINITION_ID,
      revisionId: REVISION_ID,
      instanceId: `00000000-0000-4000-8000-${String(20_000 + index).padStart(12, '0')}`,
      w: 240,
      h: 180,
      expanded: true,
      window: 'contained',
    },
    style: {},
  };
}

function artifactBytesBase64(): string {
  const entry = 'export default "neutral-host-10k";';
  const envelope = JSON.stringify({
    format: 'vibecanvas.widget-artifact.v1',
    kind: 'ui',
    entry: 'ui/main.ts',
    sourceDigestSha256: DIGEST,
    builderIdentity: 'neutral-host-10k-test',
    runtimeAbi: null,
    outputs: [{
      path: 'output-0.js',
      loader: 'js',
      kind: 'entry-point',
      digestSha256: DIGEST,
      bytesBase64: Buffer.from(entry).toString('base64'),
    }],
  });
  return Buffer.from(envelope).toString('base64');
}

test('10,000 committed widget instances use bounded production UI realms without backend starts', async () => {
  ensureDom();
  const previousAutoDraw = Konva.autoDrawEnabled;
  Konva.autoDrawEnabled = false;
  const container = createTestContainer({ width: 1_200, height: 800 });
  const stage = new Konva.Stage({ container, width: 1_200, height: 800 });
  const staticLayer = new Konva.Layer();
  const dynamicLayer = new Konva.Layer();
  stage.add(staticLayer);
  stage.add(dynamicLayer);

  const definitions = new Map<string, TRegisteredElementDefinition>();
  const committedElements = Object.fromEntries(
    Array.from({ length: INSTANCE_COUNT }, (_, index) => {
      const candidate = element(index);
      return [candidate.id, candidate];
    }),
  );
  const crdtChange = new SyncHook<[TCrdtChangeSummary]>();
  const functionInvoke = vi.fn();
  const functionGet = vi.fn();
  const runtimeLoads = vi.fn(async (request: Readonly<{
    canvasId: string;
    elementId: string;
    widgetInstanceId: string;
    definitionId: string;
    revisionId: string;
  }>) => [null, {
    identity: request,
    manifest: {
      schemaVersion: 2,
      name: 'Neutral host 10k',
      slug: 'neutral-host-10k',
      ui: { entry: 'ui/main.ts' },
    },
    artifact: { digestSha256: DIGEST, bytesBase64: artifactBytesBase64() },
    functionDescriptors: [],
  }] as const);
  let mountedCount = 0;
  let cleanedCount = 0;
  const runtime = new WidgetUiRuntime({
    transport: {
      api: {
        widget: { runtime: { load: runtimeLoads as never } },
        function: { invoke: functionInvoke as never, get: functionGet as never },
      },
    },
    codec: {
      decodeBase64: (value) => Uint8Array.from(Buffer.from(value, 'base64')),
      decodeUtf8: (value) => Buffer.from(value).toString('utf8'),
      digestSha256: async () => DIGEST,
    },
    createIdempotencyKey: () => 'neutral-host-10k-key',
    organizationId: () => ORG_ID,
    tenantAuthorityKey: () => `tenant:${ORG_ID}`,
    nowMs: () => 0,
    wait: async () => undefined,
    maxActiveRenders: WIDGET_UI_MAX_ACTIVE_RENDERS,
    mount: {
      mount: (args) => {
        mountedCount += 1;
        const cleanup = widgetUiArtifactMount.mount(args);
        return () => {
          cleanup();
          cleanedCount += 1;
        };
      },
    },
    isTargetCurrent: (target) => {
      const current = committedElements[target.elementId];
      return current?.data.type === 'widget-instance'
        && current.data.definitionId === target.definitionId
        && current.data.revisionId === target.revisionId
        && current.data.instanceId === target.widgetInstanceId;
    },
  });

  const elementService = {
    registerElement(definition: TRegisteredElementDefinition) {
      definitions.set(definition.id, definition);
    },
    unregisterElement: vi.fn(),
    createNodeFromElement(candidate: TElement) {
      const definition = [...definitions.values()].find((registered) => (
        registered.matchesElement?.(candidate) === true
      ));
      const node = definition?.createNode?.(candidate) ?? null;
      if (node) definition?.attachListeners?.(node);
      return node;
    },
    toElement(node: Konva.Node) {
      return fnToWidgetElement(node, 1);
    },
  };
  const manager = new WidgetManagerService({
    crdtService: {
      doc: () => ({ elements: committedElements }),
      hooks: { change: crdtChange },
      build: () => { throw new Error('The scale fixture must not mutate the CRDT.'); },
      applyOps: vi.fn(),
    } as never,
    contextMenuService: { close: vi.fn() } as never,
    loggingService: { warn: vi.fn() } as never,
    themeService: new ThemeService(),
    selectionService: {
      focusedId: null,
      selection: [],
      hooks: { change: new SyncHook<[]>() },
      clear: vi.fn(),
      setSelection: vi.fn(),
      setFocusedNode: vi.fn(),
      setFocusedId: vi.fn(),
    } as never,
    elementService: elementService as never,
    toolService: { unregisterTool: vi.fn(), setActiveTool: vi.fn() } as never,
    sceneService: {
      stage,
      staticForegroundLayer: staticLayer,
      dynamicLayer,
      hooks: { resize: new SyncHook<[]>() },
    } as never,
    renderOrderService: { assignOrderOnInsert: vi.fn(), sortChildren: vi.fn() } as never,
    cameraService: { hooks: { change: new SyncHook<[]>() } } as never,
    confirmDialogService: { confirm: vi.fn(async () => true) } as never,
    browser: createTestWidgetBrowser(),
    transport: {
      api: {
        widget: { runtime: { load: runtimeLoads } },
        function: { invoke: functionInvoke, get: functionGet },
      },
    } as never,
    neutralHost: { canvasId: CANVAS_ID, runtime },
  });

  const rssBefore = process.memoryUsage().rss;
  try {
    manager.start({ hooks: { elementDefinitionInvalidated: { call: vi.fn() } } } as never);
    const neutralDefinition = definitions.get('__widget-instance-host');
    expect(neutralDefinition).toBeDefined();
    for (const candidate of Object.values(committedElements)) {
      const node = elementService.createNodeFromElement(candidate);
      expect(node).toBeInstanceOf(Konva.Group);
      staticLayer.add(node as Konva.Group);
    }

    await vi.waitFor(() => expect(mountedCount).toBe(WIDGET_UI_MAX_ACTIVE_RENDERS), {
      timeout: 120_000,
      interval: 25,
    });
    await vi.waitFor(() => {
      expect(container.querySelectorAll('arrow-sandbox[data-ready="true"]').length)
        .toBe(WIDGET_UI_MAX_ACTIVE_RENDERS);
    }, { timeout: 120_000, interval: 25 });
    const portal = container.querySelector('#widget-portal');
    expect(portal?.querySelectorAll('[data-widget-element-id]').length).toBe(INSTANCE_COUNT);
    const runtimeStatusCount = container.querySelectorAll('[data-widget-runtime-status]').length;
    const deferredCount = container
      .querySelectorAll('[data-widget-runtime-status="deferred"]').length;
    expect(runtimeStatusCount).toBe(PRELOADED_INSTANCE_COUNT);
    expect(deferredCount).toBe(
      PRELOADED_INSTANCE_COUNT
      - WIDGET_UI_MAX_ACTIVE_RENDERS
      - WIDGET_UI_MAX_QUEUED_RENDERS,
    );
    expect(runtime.diagnostics()).toEqual({
      activeRenderCount: WIDGET_UI_MAX_ACTIVE_RENDERS,
      queuedRenderCount: WIDGET_UI_MAX_QUEUED_RENDERS,
      recoveringRenderCount: 0,
      inFlightArtifactVerificationCount: 0,
      maxActiveRenders: WIDGET_UI_MAX_ACTIVE_RENDERS,
      maxQueuedRenders: WIDGET_UI_MAX_QUEUED_RENDERS,
    });
    expect(INSTANCE_COUNT - runtimeStatusCount).toBe(
      INSTANCE_COUNT - PRELOADED_INSTANCE_COUNT,
    );
    expect(runtimeLoads).toHaveBeenCalledTimes(WIDGET_UI_MAX_ACTIVE_RENDERS);
    expect(functionInvoke).not.toHaveBeenCalled();
    expect(functionGet).not.toHaveBeenCalled();

    const rssAfter = process.memoryUsage().rss;
    expect(rssAfter).toBeGreaterThan(rssBefore);
    expect(rssAfter - rssBefore).toBeLessThan(INSTANCE_COUNT * 256 * 1024);
    process.stdout.write(`[widget-host-10k-render-metrics] ${JSON.stringify({
      neutralWidgetCount: INSTANCE_COUNT,
      activeUiRealms: mountedCount,
      queuedUiRenders: runtime.diagnostics().queuedRenderCount,
      deferredUiRenders: deferredCount,
      offscreenUnmountedWidgets: INSTANCE_COUNT - runtimeStatusCount,
      runtimeArtifactLoads: runtimeLoads.mock.calls.length,
      rssBeforeBytes: rssBefore,
      rssAfterBytes: rssAfter,
      rssGrowthBytes: Math.max(0, rssAfter - rssBefore),
      functionTransportCalls: 0,
    })}\n`);
  } finally {
    manager.stop();
    stage.destroy();
    container.remove();
    Konva.autoDrawEnabled = previousAutoDraw;
  }
  expect(cleanedCount).toBe(WIDGET_UI_MAX_ACTIVE_RENDERS);
}, 180_000);
