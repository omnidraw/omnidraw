import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { SERVER_FUNCTION_TRANSPORT_GLOBAL_KEY } from '../../../sdk/src/function-client';
import { COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY } from '../../../sdk/src/collaborative-state-client';
import {
  WIDGET_COLLABORATIVE_STATE_HOST_MODULE,
  WIDGET_COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY,
  WIDGET_SERVER_FUNCTION_HOST_MODULE,
  WIDGET_SERVER_FUNCTION_TRANSPORT_GLOBAL_KEY,
} from '../../src/widget-runtime/CONSTANTS';
import { widgetUiArtifactMount } from '../../src/widget-runtime/mount-widget-ui-artifact';
import { WidgetUiRuntime } from '../../src/widget-runtime/WidgetUiRuntime';
import { mountArrowSandboxBridge } from '../../src/widget/mount-arrow-sandbox';
import type { TElement } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import type {
  TWidgetFunctionHostBridge,
  TWidgetCollaborativeStateSession,
  TWidgetRuntimeIdentity,
  TWidgetRuntimeTransportPort,
  TVerifiedWidgetUiArtifact,
} from '../../src/widget-runtime/interface';

const identity: TWidgetRuntimeIdentity = Object.freeze({
  orgId: 'org-a',
  canvasId: 'canvas-a',
  elementId: 'element-a',
  widgetInstanceId: 'instance-a',
  definitionId: 'definition-a',
  revisionId: 'revision-a',
});

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

function artifact(source: string, css = ''): TVerifiedWidgetUiArtifact {
  const encode = (value: string) => new TextEncoder().encode(value);
  const outputs: TVerifiedWidgetUiArtifact['outputs'] = [
    {
      descriptor: {
        path: 'output-0.js',
        loader: 'js',
        kind: 'entry-point',
        digestSha256: 'a'.repeat(64),
        bytesBase64: '',
      },
      bytes: encode(source),
      text: source,
    },
    ...(css.length === 0
      ? []
      : [{
          descriptor: {
            path: 'output-1.css',
            loader: 'css' as const,
            kind: 'asset' as const,
            digestSha256: 'b'.repeat(64),
            bytesBase64: '',
          },
          bytes: encode(css),
          text: css,
        }]),
  ];
  return {
    digestSha256: 'c'.repeat(64),
    envelope: {
      format: 'vibecanvas.widget-artifact.v1',
      kind: 'ui',
      entry: 'ui/main.ts',
      sourceDigestSha256: 'd'.repeat(64),
      builderIdentity: 'bun-browser-v1',
      runtimeAbi: null,
      outputs: outputs.map((output) => output.descriptor),
    },
    outputs,
    retainedByteSize: outputs.reduce((size, output) => size + output.bytes.byteLength, 0),
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function encodedArtifact(source: string) {
  const outputBytes = Buffer.from(source, 'utf8');
  const envelopeBytes = Buffer.from(JSON.stringify({
    format: 'vibecanvas.widget-artifact.v1',
    kind: 'ui',
    entry: 'ui/main.ts',
    sourceDigestSha256: 'd'.repeat(64),
    builderIdentity: 'sandbox-boot-deadline-test',
    runtimeAbi: null,
    outputs: [{
      path: 'output-0.js',
      loader: 'js',
      kind: 'entry-point',
      digestSha256: sha256(outputBytes),
      bytesBase64: outputBytes.toString('base64'),
    }],
  }), 'utf8');
  return {
    digestSha256: sha256(envelopeBytes),
    bytesBase64: envelopeBytes.toString('base64'),
  };
}

function runtimeElement(elementId: string, widgetInstanceId: string): TElement {
  return {
    id: elementId,
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
      definitionId: identity.definitionId,
      revisionId: identity.revisionId,
      instanceId: widgetInstanceId,
      w: 320,
      h: 240,
      expanded: true,
      window: 'contained',
    },
  };
}

function bridge(overrides: Partial<TWidgetFunctionHostBridge> = {}) {
  return {
    identity,
    createIdempotencyKey: vi.fn(() => 'mount-prefix'),
    invoke: vi.fn(async () => ({ ok: true })),
    dispose: vi.fn(),
    ...overrides,
  } as TWidgetFunctionHostBridge;
}

function stateBridge(overrides: Partial<TWidgetCollaborativeStateSession> = {}) {
  return {
    identity: { ...identity, stateDocumentId: 'automerge:state-a' },
    get: vi.fn(async () => ({ version: 1, value: { count: 1 } })),
    change: vi.fn(async (value) => ({ version: 2, value })),
    next: vi.fn(() => new Promise(() => {})),
    cancel: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  } as TWidgetCollaborativeStateSession;
}

function mount(
  source: string,
  functionBridge = bridge(),
  collaborativeStateBridge: TWidgetCollaborativeStateSession | null = null,
  css = '',
  onFatal = vi.fn(),
) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const cleanup = widgetUiArtifactMount.mount({
    root,
    identity,
    artifact: artifact(source, css),
    functionBridge,
    collaborativeStateBridge,
    onFatal,
  });
  const host = root.querySelector('arrow-sandbox') as HTMLElement | null;
  return { cleanup, functionBridge, host, onFatal, root };
}

async function waitForReady(host: HTMLElement | null) {
  expect(host).not.toBeNull();
  customElements.upgrade?.(host as HTMLElement);
  await vi.waitFor(() => expect(host?.dataset.ready).toBe('true'), { timeout: 10_000 });
}

function legacyBridge() {
  return {
    getSnapshot: vi.fn(async () => ({
      status: 'running' as const,
      state: 'idle',
      context: {},
    })),
    sendMessage: vi.fn(async () => ({ ok: true as const })),
    subscribeSnapshots: vi.fn(() => () => undefined),
  };
}

type THostRendererProbe = {
  applyPatches(patches: unknown[]): void;
  liveAttributeCharacters: number;
  liveAttributes: number;
  liveEvents: number;
  liveNodeCount: number;
  liveTextCharacters: number;
  render(tree: unknown): void;
};

function getHostRenderer(host: HTMLElement | null): THostRendererProbe {
  return (host as unknown as {
    controller: { renderer: THostRendererProbe };
  }).controller.renderer;
}

const SAFE_SANDBOX_EVENT_TYPES = [
  'blur', 'change', 'click', 'dblclick', 'focus', 'input', 'keydown', 'keyup',
  'pointercancel', 'pointerdown', 'pointermove', 'pointerup', 'reset', 'submit',
  'wheel',
] as const;

describe('widget UI artifact mount boundary', () => {
  test('uses the exact generated-SDK global transport key', () => {
    expect(WIDGET_SERVER_FUNCTION_TRANSPORT_GLOBAL_KEY)
      .toBe(SERVER_FUNCTION_TRANSPORT_GLOBAL_KEY);
    expect(WIDGET_COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY)
      .toBe(COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY);
  });

  test('mounts an inert artifact and destroys its QuickJS realm on cleanup', async () => {
    const mounted = mount('export default "ready";');
    await waitForReady(mounted.host);

    expect(mounted.host?.shadowRoot?.textContent).toContain('ready');
    expect((mounted.host as unknown as { controller: unknown }).controller).not.toBeNull();

    mounted.cleanup();
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    expect(mounted.root.childElementCount).toBe(0);
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    mounted.root.remove();
  });

  test.each([
    [
      'serialized byte size',
      `globalThis.__arrowHostSend('{"type":"output","payload":"' + 'x'.repeat(1_000_001) + '"}');`,
      'host byte limit of 1000000',
    ],
    [
      'render depth',
      `
        let tree = { kind: 'text', id: 'leaf', text: '' };
        for (let index = 0; index < 32; index += 1) {
          tree = { kind: 'fragment', children: [tree] };
        }
        globalThis.__arrowHostSend(JSON.stringify({ type: 'render', tree }));
      `,
      'render depth budget',
    ],
    [
      'render node count',
      `
        const children = Array.from({ length: 4_096 }, (_, index) => ({
          kind: 'text', id: 'node-' + index, text: '',
        }));
        globalThis.__arrowHostSend(JSON.stringify({
          type: 'render', tree: { kind: 'fragment', children },
        }));
      `,
      'render node budget',
    ],
    [
      'render text',
      `globalThis.__arrowHostSend(JSON.stringify({
        type: 'render',
        tree: { kind: 'text', id: 'text', text: 'x'.repeat(262_145) },
      }));`,
      'render text budget',
    ],
    [
      'per-element attributes',
      `
        const attrs = Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => ['data-value-' + index, 'x'])
        );
        globalThis.__arrowHostSend(JSON.stringify({
          type: 'render',
          tree: {
            kind: 'element', id: 'element', tag: 'div', attrs, events: {}, children: [],
          },
        }));
      `,
      'per-element attribute budget',
    ],
    [
      'per-element events',
      `
        const events = Object.fromEntries(
          Array.from({ length: 17 }, (_, index) => ['event-' + index, 'handler-' + index])
        );
        globalThis.__arrowHostSend(JSON.stringify({
          type: 'render',
          tree: {
            kind: 'element', id: 'element', tag: 'div', attrs: {}, events, children: [],
          },
        }));
      `,
      'per-element event budget',
    ],
    [
      'patch count',
      `
        const patches = Array.from({ length: 1_025 }, () => ({
          type: 'set-text', nodeId: 'node', text: '',
        }));
        globalThis.__arrowHostSend(JSON.stringify({ type: 'patch', patches }));
      `,
      'patch count budget',
    ],
    [
      'cumulative boot patch count',
      `
        const patches = Array.from({ length: 600 }, () => ({
          type: 'set-text', nodeId: 'node', text: '',
        }));
        globalThis.__arrowHostSend(JSON.stringify({ type: 'patch', patches }));
        globalThis.__arrowHostSend(JSON.stringify({ type: 'patch', patches }));
      `,
      'boot cap of 1024 initial patches',
    ],
    [
      'duplicate node identity',
      `globalThis.__arrowHostSend(JSON.stringify({
        type: 'render',
        tree: {
          kind: 'fragment',
          children: [
            { kind: 'text', id: 'duplicate', text: 'a' },
            { kind: 'text', id: 'duplicate', text: 'b' },
          ],
        },
      }));`,
      'duplicate render node id',
    ],
    [
      'malformed node shape',
      `globalThis.__arrowHostSend(JSON.stringify({
        type: 'render',
        tree: { kind: 'element', id: 'element', tag: 'div', attrs: [], events: {}, children: [] },
      }));`,
      'invalid object shape',
    ],
  ])('rejects forged VM messages over the %s budget before rendering', async (
    _boundary,
    forgedMessageSource,
    expectedFailure,
  ) => {
    const mounted = mount(`${forgedMessageSource}\nexport default 'unreachable';`);
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent).toContain(expectedFailure);
    expect(mounted.host?.shadowRoot?.lastElementChild?.childNodes ?? []).toHaveLength(0);
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    expect(mounted.onFatal).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('accepts exact VM patch and text budgets without failing the sandbox', async () => {
    const mounted = mount(`
      const patches = Array.from({ length: 1_024 }, (_, index) => ({
        type: 'set-text', nodeId: 'snode:1', text: 'accepted-' + index,
      }));
      setTimeout(() => {
        globalThis.__arrowHostSend(JSON.stringify({ type: 'patch', patches }));
        globalThis.__arrowHostSend(JSON.stringify({
          type: 'patch',
          patches: [{ type: 'set-text', nodeId: 'snode:1', text: 'x'.repeat(262_144) }],
        }));
      }, 10);
      export default 'pending';
    `);
    await waitForReady(mounted.host);
    await vi.waitFor(() => {
      expect(mounted.host?.shadowRoot?.lastElementChild?.textContent).toHaveLength(262_144);
    }, { timeout: 10_000 });

    expect(mounted.host?.dataset.ready).toBe('true');
    expect(mounted.onFatal).not.toHaveBeenCalled();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('rejects a forged post-activation node-id collision against the live tree', async () => {
    const mounted = mount(`
      import { html } from '@arrow-js/core';
      setTimeout(() => {
        globalThis.__arrowHostSend(JSON.stringify({
          type: 'patch',
          patches: [{
            type: 'replace-region',
            regionId: 'snode:1',
            children: [{ kind: 'text', id: 'snode:1', text: 'collision' }],
          }],
        }));
      }, 10);
      export default html\`\${() => 'ready'}\`;
    `);
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent).toContain('duplicate live node id');
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    expect(mounted.onFatal).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('accepts exactly 4096 live nodes and rejects the next retained node', async () => {
    const mounted = mount(`export default 'ready';`);
    await waitForReady(mounted.host);
    const renderer = getHostRenderer(mounted.host);
    renderer.render({
      kind: 'fragment',
      children: [
        { kind: 'region', id: 'retained-region', children: [] },
        ...Array.from({ length: 4_094 }, (_, index) => ({
          kind: 'text', id: `retained-${index}`, text: '',
        })),
      ],
    });

    expect(mounted.host?.shadowRoot?.lastElementChild?.childNodes).toHaveLength(4_096);
    renderer.applyPatches([{
      type: 'replace-region',
      regionId: 'retained-region',
      children: [{ kind: 'text', id: 'one-too-many', text: '' }],
    }]);
    expect(mounted.root.textContent).toContain('host cap of 4096 live nodes');
    expect(mounted.host?.shadowRoot?.lastElementChild?.childNodes).toHaveLength(0);
    expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error');
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('accounts exact live totals when patches remove and replace retained DOM', async () => {
    const mounted = mount(`export default 'ready';`);
    await waitForReady(mounted.host);
    const renderer = getHostRenderer(mounted.host);
    renderer.render({
      kind: 'element',
      id: 'root',
      tag: 'div',
      attrs: { class: 'aa' },
      events: { click: 'root-click' },
      children: [
        { kind: 'text', id: 'root-text', text: 'abc' },
        {
          kind: 'region',
          id: 'region',
          children: [{
            kind: 'element',
            id: 'nested',
            tag: 'span',
            attrs: { title: 'xy' },
            events: { input: 'nested-input' },
            children: [{ kind: 'text', id: 'nested-text', text: 'wxyz' }],
          }],
        },
      ],
    });

    expect({
      attributeCharacters: renderer.liveAttributeCharacters,
      attributes: renderer.liveAttributes,
      events: renderer.liveEvents,
      nodes: renderer.liveNodeCount,
      textCharacters: renderer.liveTextCharacters,
    }).toEqual({
      attributeCharacters: 14,
      attributes: 2,
      events: 2,
      nodes: 6,
      textCharacters: 7,
    });

    renderer.applyPatches([
      { type: 'set-text', nodeId: 'root-text', text: 'z' },
      { type: 'remove-attribute', nodeId: 'root', name: 'class' },
      { type: 'clear-event-binding', nodeId: 'root', eventType: 'click' },
      {
        type: 'replace-region',
        regionId: 'region',
        children: [{ kind: 'text', id: 'replacement-text', text: 'ok' }],
      },
    ]);

    expect({
      attributeCharacters: renderer.liveAttributeCharacters,
      attributes: renderer.liveAttributes,
      events: renderer.liveEvents,
      nodes: renderer.liveNodeCount,
      textCharacters: renderer.liveTextCharacters,
    }).toEqual({
      attributeCharacters: 0,
      attributes: 0,
      events: 0,
      nodes: 5,
      textCharacters: 3,
    });
    expect(mounted.onFatal).not.toHaveBeenCalled();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('accepts the exact live text budget after sequential patches and rejects one more character', async () => {
    const mounted = mount(`export default 'ready';`);
    await waitForReady(mounted.host);
    const renderer = getHostRenderer(mounted.host);
    renderer.render({
      kind: 'fragment',
      children: [
        { kind: 'text', id: 'main-text', text: 'x'.repeat(262_143) },
        { kind: 'text', id: 'boundary-text', text: '' },
        { kind: 'text', id: 'overflow-text', text: '' },
      ],
    });
    renderer.applyPatches([{
      type: 'set-text', nodeId: 'boundary-text', text: 'y',
    }]);

    expect(renderer.liveTextCharacters).toBe(262_144);
    expect(mounted.host?.shadowRoot?.lastElementChild?.textContent).toHaveLength(262_144);
    expect(mounted.onFatal).not.toHaveBeenCalled();
    renderer.applyPatches([{
      type: 'set-text', nodeId: 'overflow-text', text: 'z',
    }]);
    expect(mounted.root.textContent).toContain('host cap of 262144 live text characters');
    expect(mounted.host?.shadowRoot?.lastElementChild?.childNodes).toHaveLength(0);
    expect(mounted.onFatal).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('reclaims one of 4096 live attributes before rejecting the next retained attribute', async () => {
    const mounted = mount(`export default 'ready';`);
    await waitForReady(mounted.host);
    const renderer = getHostRenderer(mounted.host);
    renderer.render({
      kind: 'fragment',
      children: [
        ...Array.from({ length: 64 }, (_, elementIndex) => ({
          kind: 'element',
          id: `attribute-element-${elementIndex}`,
          tag: 'div',
          attrs: Object.fromEntries(Array.from({ length: 64 }, (_, attributeIndex) => [
            `data-a-${elementIndex}-${attributeIndex}`,
            'x',
          ])),
          events: {},
          children: [],
        })),
        {
          kind: 'element', id: 'attribute-spare-one', tag: 'div',
          attrs: {}, events: {}, children: [],
        },
        {
          kind: 'element', id: 'attribute-spare-two', tag: 'div',
          attrs: {}, events: {}, children: [],
        },
      ],
    });

    expect(renderer.liveAttributes).toBe(4_096);
    renderer.applyPatches([
      {
        type: 'remove-attribute', nodeId: 'attribute-element-0', name: 'data-a-0-0',
      },
      {
        type: 'set-attribute', nodeId: 'attribute-spare-one', name: 'class', value: '',
      },
    ]);
    expect(renderer.liveAttributes).toBe(4_096);
    expect(mounted.onFatal).not.toHaveBeenCalled();
    renderer.applyPatches([{
      type: 'set-attribute', nodeId: 'attribute-spare-two', name: 'id', value: '',
    }]);
    expect(mounted.root.textContent).toContain('host cap of 4096 live attributes');
    expect(mounted.host?.shadowRoot?.lastElementChild?.childNodes).toHaveLength(0);
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('accepts the exact live attribute-character budget and rejects a sequential addition', async () => {
    const mounted = mount(`export default 'ready';`);
    await waitForReady(mounted.host);
    const renderer = getHostRenderer(mounted.host);
    renderer.render({
      kind: 'element',
      id: 'attribute-character-element',
      tag: 'div',
      attrs: { id: 'x'.repeat(262_142) },
      events: {},
      children: [],
    });

    expect(renderer.liveAttributeCharacters).toBe(262_144);
    expect(mounted.onFatal).not.toHaveBeenCalled();
    renderer.applyPatches([{
      type: 'set-attribute',
      nodeId: 'attribute-character-element',
      name: 'class',
      value: '',
    }]);
    expect(mounted.root.textContent).toContain('host cap of 262144 live attribute characters');
    expect(mounted.host?.shadowRoot?.lastElementChild?.childNodes).toHaveLength(0);
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('rejects a 65th live attribute added to one element by a later patch', async () => {
    const mounted = mount(`export default 'ready';`);
    await waitForReady(mounted.host);
    const renderer = getHostRenderer(mounted.host);
    renderer.render({
      kind: 'element',
      id: 'per-element-attributes',
      tag: 'div',
      attrs: Object.fromEntries(Array.from({ length: 64 }, (_, index) => [
        `data-boundary-${index}`,
        'x',
      ])),
      events: {},
      children: [],
    });

    expect(renderer.liveAttributes).toBe(64);
    expect(mounted.onFatal).not.toHaveBeenCalled();
    renderer.applyPatches([{
      type: 'set-attribute',
      nodeId: 'per-element-attributes',
      name: 'class',
      value: '',
    }]);
    expect(mounted.root.textContent).toContain('host cap of 64 live attributes per element');
    expect(mounted.host?.shadowRoot?.lastElementChild?.childNodes).toHaveLength(0);
    expect(mounted.onFatal).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('reclaims one of 1024 live event bindings before rejecting the next retained binding', async () => {
    const mounted = mount(`export default 'ready';`);
    await waitForReady(mounted.host);
    const renderer = getHostRenderer(mounted.host);
    const fullEventBindings = Object.fromEntries(SAFE_SANDBOX_EVENT_TYPES.map(
      (eventType) => [eventType, `handler-${eventType}`],
    ));
    renderer.render({
      kind: 'fragment',
      children: [
        ...Array.from({ length: 68 }, (_, index) => ({
          kind: 'element', id: `event-element-${index}`, tag: 'div', attrs: {},
          events: fullEventBindings, children: [],
        })),
        {
          kind: 'element', id: 'event-boundary', tag: 'div', attrs: {},
          events: Object.fromEntries(SAFE_SANDBOX_EVENT_TYPES.slice(0, 4).map(
            (eventType) => [eventType, `boundary-${eventType}`],
          )),
          children: [],
        },
        {
          kind: 'element', id: 'event-spare-one', tag: 'div',
          attrs: {}, events: {}, children: [],
        },
        {
          kind: 'element', id: 'event-spare-two', tag: 'div',
          attrs: {}, events: {}, children: [],
        },
      ],
    });

    expect(renderer.liveEvents).toBe(1_024);
    renderer.applyPatches([
      {
        type: 'clear-event-binding', nodeId: 'event-element-0', eventType: 'blur',
      },
      {
        type: 'set-event-binding', nodeId: 'event-spare-one',
        eventType: 'click', handlerId: 'replacement-click',
      },
    ]);
    expect(renderer.liveEvents).toBe(1_024);
    expect(mounted.onFatal).not.toHaveBeenCalled();
    renderer.applyPatches([{
      type: 'set-event-binding', nodeId: 'event-spare-two',
      eventType: 'change', handlerId: 'overflow-change',
    }]);
    expect(mounted.root.textContent).toContain('host cap of 1024 live event bindings');
    expect(mounted.host?.shadowRoot?.lastElementChild?.childNodes).toHaveLength(0);
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('rejects live depth accumulated across sequential region replacements', async () => {
    const mounted = mount(`export default 'ready';`);
    await waitForReady(mounted.host);
    const renderer = getHostRenderer(mounted.host);
    renderer.render({ kind: 'region', id: 'depth-1', children: [] });
    for (let depth = 2; depth <= 32; depth += 1) {
      renderer.applyPatches([{
        type: 'replace-region',
        regionId: `depth-${depth - 1}`,
        children: [{ kind: 'region', id: `depth-${depth}`, children: [] }],
      }]);
    }

    expect(renderer.liveNodeCount).toBe(64);
    expect(mounted.onFatal).not.toHaveBeenCalled();
    renderer.applyPatches([{
      type: 'replace-region',
      regionId: 'depth-32',
      children: [{ kind: 'text', id: 'depth-33', text: '' }],
    }]);
    expect(mounted.root.textContent).toContain('host cap of 32 live levels');
    expect(mounted.host?.shadowRoot?.lastElementChild?.childNodes).toHaveLength(0);
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('reserves a parent region identity before validating its nested children', async () => {
    const mounted = mount(`export default 'ready';`);
    await waitForReady(mounted.host);
    const renderer = getHostRenderer(mounted.host);

    renderer.render({
      kind: 'region',
      id: 'reserved-region-id',
      children: [{ kind: 'text', id: 'reserved-region-id', text: 'collision' }],
    });
    expect(mounted.root.textContent).toContain('duplicate live node id');
    expect(mounted.host?.shadowRoot?.lastElementChild?.childNodes).toHaveLength(0);
    expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error');
    expect(mounted.onFatal).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('makes a renderer limit fatal even when guest code catches the host-send exception', async () => {
    const mounted = mount(`
      setTimeout(() => {
        try {
          globalThis.__arrowHostSend(JSON.stringify({
            type: 'render',
            tree: {
              kind: 'fragment',
              children: Array.from({ length: 4_095 }, (_, index) => ({
                kind: 'region', id: 'oversized-' + index, children: [],
              })),
            },
          }));
        } catch {}
        try {
          globalThis.__arrowHostSend(JSON.stringify({
            type: 'render',
            tree: { kind: 'text', id: 'should-not-survive', text: 'caught' },
          }));
        } catch {}
      }, 10);
      export default 'ready';
    `);
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent).toContain('host cap of 4096 live nodes');
    expect(mounted.host?.shadowRoot?.lastElementChild?.childNodes).toHaveLength(0);
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    expect(mounted.onFatal).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('does not activate a controller after buffered boot patches exceed live DOM limits', async () => {
    const mounted = mount(`
      import { html } from '@arrow-js/core';
      globalThis.__arrowHostSend(JSON.stringify({
        type: 'patch',
        patches: [{
          type: 'replace-region',
          regionId: 'snode:1',
          children: Array.from({ length: 4_096 }, (_, index) => ({
            kind: 'text', id: 'buffered-child-' + index, text: '',
          })),
        }],
      }));
      export default html\`\${() => ''}\`;
    `);
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent).toContain('host cap of 4096 live nodes');
    expect(mounted.host?.dataset.ready).not.toBe('true');
    expect(mounted.host?.shadowRoot?.lastElementChild?.childNodes).toHaveLength(0);
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    expect(mounted.onFatal).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('cleans a failed controller even when host error reporting throws', async () => {
    const reportingError = new Error('host error reporter failed');
    const onFatal = vi.fn(() => { throw reportingError; });
    const mounted = mount(`
      setTimeout(() => globalThis.__arrowHostSend(JSON.stringify({
          type: 'render',
          tree: {
            kind: 'fragment',
            children: Array.from({ length: 4_095 }, (_, index) => ({
              kind: 'region', id: 'reporting-failure-' + index, children: [],
            })),
          },
        })), 10);
      export default 'ready';
    `, bridge(), null, '', onFatal);
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent).toContain('host cap of 4096 live nodes');
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    expect(mounted.host?.shadowRoot?.lastElementChild?.childNodes).toHaveLength(0);
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    expect(onFatal).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('charges rejected bridge arguments before traversal so caught floods are bounded', async () => {
    const functionBridge = bridge();
    const mounted = mount(`
      import { invokeServerFunction } from '${WIDGET_SERVER_FUNCTION_HOST_MODULE}';
      for (let index = 0; index < 64; index += 1) {
        const circular = [];
        circular.push(circular);
        try { invokeServerFunction(circular); } catch {}
      }
      invokeServerFunction({
        functionName: 'mustNotRun',
        input: null,
        idempotencyKey: 'bridge-rate-boundary',
      });
      export default 'unreachable';
    `, functionBridge);
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent).toContain('host rate budget of 64 per 1000ms');
    expect(functionBridge.invoke).not.toHaveBeenCalled();
    expect(functionBridge.dispose).toHaveBeenCalledOnce();
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    expect(mounted.onFatal).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('charges rejected VM messages before string extraction and parsing', async () => {
    const mounted = mount(`
      for (let index = 0; index < 256; index += 1) {
        try { globalThis.__arrowHostSend(1); } catch {}
      }
      globalThis.__arrowHostSend(JSON.stringify({
        type: 'log', method: 'log', args: [],
      }));
      export default 'unreachable';
    `);
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent).toContain('VM messages exceeded the host rate budget of 256 per 1000ms');
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    expect(mounted.onFatal).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('destroys the realm and bridge when the artifact entry import fails', async () => {
    const mounted = mount('throw new Error("artifact import failed"); export default "never";');
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent).toContain('artifact import failed');
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    expect(mounted.onFatal).toHaveBeenCalledOnce();
    expect(mounted.root.querySelector('arrow-sandbox')).toBeNull();
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();

    mounted.cleanup();
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    expect(mounted.root.childElementCount).toBe(0);
    mounted.root.remove();
  });

  test('fences a late boot completion after unmount', async () => {
    let resolveInvocation!: (value: unknown) => void;
    const invoke = vi.fn(() => new Promise((resolve) => {
      resolveInvocation = resolve;
    }));
    const functionBridge = bridge({ invoke });
    const mounted = mount(`
      import { invokeServerFunction } from 'host-bridge:vibecanvas-server-functions';
      await invokeServerFunction({ functionName: 'wait', input: null, idempotencyKey: 'pending-key' });
      export default 'late';
    `, functionBridge);

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce(), { timeout: 10_000 });
    mounted.cleanup();
    expect(functionBridge.dispose).toHaveBeenCalledOnce();
    expect(mounted.root.childElementCount).toBe(0);

    resolveInvocation({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(mounted.root.childElementCount).toBe(0);
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    mounted.root.remove();
  });

  test('aborts a never-settling boot when its portal is removed before controller assignment', async () => {
    const mounted = mount(`
      await new Promise(() => {});
      export default 'unreachable';
    `);
    expect(mounted.host).not.toBeNull();
    customElements.upgrade?.(mounted.host as HTMLElement);

    const hostState = mounted.host as unknown as {
      controller: unknown;
      mountingController: null | {
        bootAbortController: AbortController;
      };
    };
    await vi.waitFor(() => expect(hostState.mountingController).not.toBeNull(), {
      timeout: 10_000,
    });
    const bootSignal = hostState.mountingController?.bootAbortController.signal;
    expect(hostState.controller).toBeNull();
    expect(bootSignal?.aborted).toBe(false);

    mounted.cleanup();
    expect(bootSignal?.aborted).toBe(true);
    expect(hostState.mountingController).toBeNull();
    expect(hostState.controller).toBeNull();
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    expect(mounted.root.childElementCount).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(mounted.onFatal).not.toHaveBeenCalled();
    expect(mounted.root.childElementCount).toBe(0);
    mounted.root.remove();
  });

  test('times out a never-settling boot and releases the runtime slot for the next widget', async () => {
    const stalledArtifact = encodedArtifact(`
      await new Promise(() => {});
      export default 'unreachable';
    `);
    const healthyArtifact = encodedArtifact("export default 'queue progressed';");
    const load = vi.fn(async (request: Omit<TWidgetRuntimeIdentity, 'orgId'>) => [undefined, {
      identity: request,
      manifest: {
        schemaVersion: 2 as const,
        name: 'Boot deadline test',
        slug: 'boot-deadline-test',
        ui: { entry: 'ui/main.ts' },
      },
      artifact: request.elementId === 'stalled-element' ? stalledArtifact : healthyArtifact,
      functionDescriptors: [],
    }] as const);
    const runtime = new WidgetUiRuntime({
      transport: {
        api: {
          widget: { runtime: { load } },
          function: { invoke: vi.fn(), get: vi.fn() },
        },
      } as unknown as TWidgetRuntimeTransportPort,
      codec: {
        decodeBase64: (value) => Buffer.from(value, 'base64'),
        decodeUtf8: (value) => Buffer.from(value).toString('utf8'),
        digestSha256: async (value) => sha256(value),
      },
      mount: widgetUiArtifactMount,
      createIdempotencyKey: () => 'boot-deadline-key',
      organizationId: () => identity.orgId,
      tenantAuthorityKey: () => 'tenant-authority-a',
      nowMs: () => Date.now(),
      wait: async () => undefined,
      isTargetCurrent: () => true,
      maxActiveRenders: 1,
    });
    const stalledRoot = document.createElement('div');
    const healthyRoot = document.createElement('div');
    document.body.append(stalledRoot, healthyRoot);
    const cleanupStalled = runtime.render({
      root: stalledRoot,
      canvasId: identity.canvasId,
      element: runtimeElement('stalled-element', 'stalled-instance'),
    });
    const cleanupHealthy = runtime.render({
      root: healthyRoot,
      canvasId: identity.canvasId,
      element: runtimeElement('healthy-element', 'healthy-instance'),
    });

    try {
      await vi.waitFor(() => {
        expect(stalledRoot.dataset.widgetRuntimeStatus).toBe('error');
      }, { timeout: 15_000 });
      expect(stalledRoot.textContent).toContain('host deadline of 10000ms');

      await vi.waitFor(() => {
        const host = healthyRoot.querySelector('arrow-sandbox') as HTMLElement | null;
        expect(host?.dataset.ready).toBe('true');
        expect(host?.shadowRoot?.textContent).toContain('queue progressed');
      }, { timeout: 10_000 });
      expect(healthyRoot.dataset.widgetRuntimeStatus).toBe('ready');
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      cleanupStalled();
      cleanupHealthy();
      stalledRoot.remove();
      healthyRoot.remove();
    }
  }, 25_000);

  test('caps pending sandbox fetches and aborts every request during realm teardown', async () => {
    const previousFetch = globalThis.fetch;
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).startsWith('https://pending.example.test/')) {
        return previousFetch(input, init);
      }
      const signal = init?.signal;
      if (!signal) throw new Error('Sandbox fetch did not provide an abort signal.');
      signals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });

    try {
      const mounted = mount(`
        const requests = [];
        for (let index = 0; index < 9; index += 1) {
          requests.push(fetch('https://pending.example.test/' + index));
        }
        await Promise.all(requests);
        export default 'unreachable';
      `);
      await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
        timeout: 10_000,
      });

      expect(mounted.root.textContent).toContain('host cap of 8 pending requests');
      expect(signals).toHaveLength(8);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
      expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
      mounted.cleanup();
      mounted.root.remove();
    } finally {
      vi.stubGlobal('fetch', previousFetch);
    }
  });

  test('streams and cancels an oversized fetch body without a Content-Length header', async () => {
    const previousFetch = globalThis.fetch;
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(1_000_001));
    let cancelled = false;
    let pullCount = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== 'https://chunked.example.test/oversized') {
        return previousFetch(input, init);
      }
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pullCount += 1;
          controller.enqueue(new Uint8Array(400_000));
        },
        cancel() {
          cancelled = true;
        },
      });
      const response = new Response(body, {
        headers: { 'content-type': 'application/octet-stream' },
      });
      expect(response.headers.has('content-length')).toBe(false);
      Object.defineProperty(response, 'arrayBuffer', { value: arrayBuffer });
      return Promise.resolve(response);
    });

    try {
      const mounted = mount(`
        await fetch('https://chunked.example.test/oversized');
        export default 'unreachable';
      `);
      await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
        timeout: 10_000,
      });

      expect(mounted.root.textContent).toContain('exceeded 1000000 bytes');
      expect(cancelled).toBe(true);
      expect(pullCount).toBeGreaterThanOrEqual(3);
      expect(arrayBuffer).not.toHaveBeenCalled();
      expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
      expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
      expect(mounted.onFatal).toHaveBeenCalledOnce();
      mounted.cleanup();
      mounted.root.remove();
    } finally {
      vi.stubGlobal('fetch', previousFetch);
    }
  });

  test('caps pending host calls and destroys the sandbox realm', async () => {
    const invoke = vi.fn(() => new Promise<never>(() => undefined));
    const mounted = mount(`
      import { invokeServerFunction } from 'host-bridge:vibecanvas-server-functions';
      const requests = [];
      for (let index = 0; index < 17; index += 1) {
        requests.push(invokeServerFunction({
          functionName: 'pending',
          input: { index },
          idempotencyKey: 'pending-' + index,
        }));
      }
      await Promise.all(requests);
      export default 'unreachable';
    `, bridge({ invoke }));
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent).toContain('host cap of 16 pending calls');
    expect(invoke).toHaveBeenCalledTimes(16);
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  });

  test('rejects a circular guest array before invoking a host bridge handler', async () => {
    const collaborativeStateBridge = stateBridge();
    const mounted = mount(`
      const input = [];
      input.push(input);
      try {
        await globalThis.__arrowHostBridge(
          ${JSON.stringify(WIDGET_COLLABORATIVE_STATE_HOST_MODULE)},
          'changeState',
          input
        );
      } finally {
        input.length = 0;
      }
      export default 'unreachable';
    `, bridge(), collaborativeStateBridge);
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent).toContain('must not contain circular references');
    expect(collaborativeStateBridge.change).not.toHaveBeenCalled();
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('rejects guest bridge data deeper than 32 levels without host recursion', async () => {
    const invoke = vi.fn(async () => ({ unreachable: true }));
    const mounted = mount(`
      let input = 'leaf';
      for (let depth = 0; depth < 40; depth += 1) input = { child: input };
      await globalThis[${JSON.stringify(WIDGET_SERVER_FUNCTION_TRANSPORT_GLOBAL_KEY)}].invoke({
        functionName: 'deepInput',
        input,
        idempotencyKey: 'deep-input',
      });
      export default 'unreachable';
    `, bridge({ invoke }));
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent).toContain('32-level plain-data budget');
    expect(invoke).not.toHaveBeenCalled();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('shares one million-byte bridge budget across every argument in one call', async () => {
    const collaborativeStateBridge = stateBridge();
    const mounted = mount(`
      await globalThis.__arrowHostBridge(
        ${JSON.stringify(WIDGET_COLLABORATIVE_STATE_HOST_MODULE)},
        'nextState',
        'x'.repeat(500_001),
        'y'.repeat(500_001)
      );
      export default 'unreachable';
    `, bridge(), collaborativeStateBridge);
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent).toContain('1000000-byte plain-data budget');
    expect(collaborativeStateBridge.next).not.toHaveBeenCalled();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test.each([
    ['circular', () => {
      const value: unknown[] = [];
      value.push(value);
      return value;
    }, 'must not contain circular references'],
    ['deep', () => {
      let value: unknown = 'leaf';
      for (let depth = 0; depth < 40; depth += 1) value = { child: value };
      return value;
    }, '32-level plain-data budget'],
    ['oversized', () => 'x'.repeat(1_000_001), '1000000-byte plain-data budget'],
  ])('rejects a %s host bridge return before converting it into guest source', async (
    _boundary,
    createReturnValue,
    expectedFailure,
  ) => {
    const invoke = vi.fn(async () => createReturnValue());
    const mounted = mount(`
      await globalThis[${JSON.stringify(WIDGET_SERVER_FUNCTION_TRANSPORT_GLOBAL_KEY)}].invoke({
        functionName: 'boundedReturn',
        input: null,
        idempotencyKey: 'bounded-return',
      });
      export default 'unreachable';
    `, bridge({ invoke: invoke as never }));
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent).toContain(expectedFailure);
    expect(invoke).toHaveBeenCalledOnce();
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('rejects artifact attempts to replace the fixed global bridge', async () => {
    const mounted = mount(`
      Object.defineProperty(globalThis, ${JSON.stringify(WIDGET_SERVER_FUNCTION_TRANSPORT_GLOBAL_KEY)}, {
        configurable: true,
        value: { createIdempotencyKey: () => 'spoof', invoke: () => ({ spoofed: true }) },
      });
      export default 'spoofed';
    `);
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent?.toLowerCase()).toMatch(/redefine|configurable|property/);
    expect(mounted.functionBridge.invoke).not.toHaveBeenCalled();
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  });

  test('exposes exact collaborative get/change capability and disposes it with the realm', async () => {
    const collaborativeStateBridge = stateBridge();
    const mounted = mount(`
      const state = globalThis[${JSON.stringify(WIDGET_COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY)}];
      const before = await state.get();
      const after = await state.change({ count: before.value.count + 1 });
      export default 'count:' + after.value.count;
    `, bridge(), collaborativeStateBridge);
    await waitForReady(mounted.host);

    expect(mounted.host?.shadowRoot?.textContent).toContain('count:2');
    expect(collaborativeStateBridge.get).toHaveBeenCalledOnce();
    expect(collaborativeStateBridge.change).toHaveBeenCalledWith({ count: 2 });
    mounted.cleanup();
    expect(collaborativeStateBridge.dispose).toHaveBeenCalledOnce();
    mounted.root.remove();
  });

  test('rejects artifact attempts to replace the fixed collaborative-state global', async () => {
    const collaborativeStateBridge = stateBridge();
    const mounted = mount(`
      Object.defineProperty(globalThis, ${JSON.stringify(WIDGET_COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY)}, {
        configurable: true,
        value: { get: () => ({ version: 99, value: 'spoofed' }) },
      });
      export default 'spoofed';
    `, bridge(), collaborativeStateBridge);
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent?.toLowerCase()).toMatch(/redefine|configurable|property/);
    expect(collaborativeStateBridge.get).not.toHaveBeenCalled();
    expect(collaborativeStateBridge.dispose).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  });

  test.each([
    ['scriptable tag', '<script>globalThis.__widgetHostEscaped = true</script>'],
    ['inline handler', '<div onclick="globalThis.__widgetHostEscaped = true">unsafe</div>'],
    ['srcdoc frame', '<iframe srcdoc="<script>globalThis.__widgetHostEscaped = true</script>"></iframe>'],
    ['URL-bearing attribute', '<div href="javascript:globalThis.__widgetHostEscaped = true">unsafe</div>'],
    ['inline style', '<div style="background:url(https://example.invalid/leak)">unsafe</div>'],
    ['SVG namespace', '<svg><circle></circle></svg>'],
  ])('rejects %s before it reaches the host DOM', async (_label, template) => {
    const mounted = mount(`
      import { html } from '@arrow-js/core';
      export default html\`${template}\`;
    `);
    await vi.waitFor(() => expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error'), {
      timeout: 10_000,
    });

    expect(mounted.root.textContent).toMatch(/Unsafe sandbox|Unsupported sandbox/);
    expect(mounted.root.querySelector('script, iframe, svg')).toBeNull();
    expect((globalThis as Record<string, unknown>).__widgetHostEscaped).toBeUndefined();
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  }, 15_000);

  test('renders ordinary neutral-widget CSS inside the shadow boundary', async () => {
    const css = `
      .safe-card { color: rgb(12 34 56); display: grid; gap: 0.5rem; }
      .safe-card::before { content: "safe @ text"; }
      @media (min-width: 10px) { .safe-card { grid-template-columns: 1fr; } }
      @keyframes pulse { from { opacity: 0.8; } to { opacity: 1; } }
    `;
    const mounted = mount(`
      import { html } from '@arrow-js/core';
      export default html\`<article class="safe-card">styled neutral widget</article>\`;
    `, bridge(), null, css);
    await waitForReady(mounted.host);

    expect(mounted.host?.shadowRoot?.querySelector('article.safe-card')?.textContent)
      .toContain('styled neutral widget');
    expect(mounted.host?.shadowRoot?.querySelector('style')?.textContent)
      .toContain('/* vibecanvas-trusted-host-layout-v1 */');
    expect(mounted.host?.shadowRoot?.querySelector('style')?.textContent).toContain('.safe-card');
    expect(mounted.host?.shadowRoot?.querySelector('style')?.textContent).toContain('@media');
    mounted.cleanup();
    mounted.root.remove();
  });

  test('preserves legacy widget CSS after the exact trusted host layout', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const cleanup = mountArrowSandboxBridge({ root, onError: vi.fn() }, {
      sources: {
        'main.ts': `
          import { html } from '@arrow-js/core';
          export default html\`<section class="legacy-card">styled legacy widget</section>\`;
        `,
        'main.css': '.legacy-card { color: rebeccapurple; padding: 1rem; }',
      },
      bridge: legacyBridge(),
    });
    const host = root.querySelector('arrow-sandbox') as HTMLElement | null;
    await waitForReady(host);

    const styleText = host?.shadowRoot?.querySelector('style')?.textContent;
    expect(styleText).toContain('/* vibecanvas-trusted-host-layout-v1 */');
    expect(styleText).toContain('.legacy-card { color: rebeccapurple; padding: 1rem; }');
    expect(host?.shadowRoot?.querySelector('section.legacy-card')?.textContent)
      .toContain('styled legacy widget');
    cleanup();
    root.remove();
  });

  test.each([
    ['network import', '@import "https://example.invalid/leak.css";'],
    ['network URL', '.unsafe { background: url(https://example.invalid/leak); }'],
    ['comment-obfuscated URL', '.unsafe { background: u/**/rl(https://example.invalid/leak); }'],
    ['escaped URL token', String.raw`.unsafe { background: u\72l(https://example.invalid/leak); }`],
    ['image-set URL', '.unsafe { background: image-set("https://example.invalid/leak" 1x); }'],
    ['host selector', ':host { display: none; }'],
    ['fixed host escape', '.unsafe { position: fixed; inset: 0; }'],
    [
      'trusted marker spoof',
      '/* vibecanvas-trusted-host-layout-v1 */\n:host { position: fixed; inset: 0; }',
    ],
  ])('rejects dangerous neutral-widget CSS: %s', (_label, css) => {
    const root = document.createElement('div');
    const functionBridge = bridge();
    expect(() => widgetUiArtifactMount.mount({
      root,
      identity,
      artifact: artifact('export default "ready";', css),
      functionBridge,
      collaborativeStateBridge: null,
      onFatal: vi.fn(),
    })).toThrow('Unsafe sandbox CSS');
    expect(functionBridge.dispose).toHaveBeenCalledOnce();
    expect(root.querySelector('arrow-sandbox')).toBeNull();
  });

  test('keeps common form controls inert while delivering submit handlers', async () => {
    const mounted = mount(`
      import { html, reactive } from '@arrow-js/core';
      const state = reactive({ submitted: false });
      export default html\`
        <form name="settings" autocomplete="off" @submit="\${() => { state.submitted = true; }}">
          <fieldset name="profile">
            <legend>Profile</legend>
            <label for="email">Email</label>
            <input id="email" name="email" type="email" value="user@example.test" />
            <select name="role">
              <optgroup label="Roles"><option value="admin">Admin</option></optgroup>
            </select>
            <textarea name="notes">hello</textarea>
            <button type="submit" name="save" value="yes">Save</button>
            <output name="status">\${() => state.submitted ? 'submitted' : 'idle'}</output>
          </fieldset>
        </form>
      \`;
    `);
    await waitForReady(mounted.host);

    const form = mounted.host?.shadowRoot?.querySelector('form');
    expect(form).not.toBeNull();
    const beforeHref = document.location.href;
    const submit = new SubmitEvent('submit', { bubbles: true, cancelable: true });
    expect(form?.dispatchEvent(submit)).toBe(false);
    expect(submit.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(mounted.host?.shadowRoot?.querySelector('output')?.textContent).toBe('submitted');
    });
    expect(document.location.href).toBe(beforeHref);
    await new Promise((resolve) => setTimeout(resolve, 0));
    mounted.cleanup();
    mounted.root.remove();
  });

  test('coalesces a pointermove flood and times out its hung event handler', async () => {
    const mounted = mount(`
      import { html } from '@arrow-js/core';
      export default html\`<button @pointermove="\${() => new Promise(() => {})}">hang</button>\`;
    `);
    await waitForReady(mounted.host);

    const button = mounted.host?.shadowRoot?.querySelector<HTMLButtonElement>('button');
    expect(button).not.toBeNull();
    for (let index = 0; index < 100; index += 1) {
      button?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    }

    await vi.waitFor(() => {
      expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error');
    }, { timeout: 5_000 });
    expect(mounted.root.textContent).toContain('event dispatch exceeded the host deadline of 1000ms');
    expect(mounted.root.textContent).not.toContain('host cap');
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    expect(mounted.onFatal).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  }, 10_000);

  test('fails closed when hung event handlers fill the bounded dispatch queue', async () => {
    const mounted = mount(`
      import { html } from '@arrow-js/core';
      export default html\`<button @click="\${() => new Promise(() => {})}">hang</button>\`;
    `);
    await waitForReady(mounted.host);

    const button = mounted.host?.shadowRoot?.querySelector<HTMLButtonElement>('button');
    expect(button).not.toBeNull();
    for (let index = 0; index < 100; index += 1) button?.click();

    await vi.waitFor(() => {
      expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error');
    }, { timeout: 5_000 });
    expect(mounted.root.textContent).toContain('host cap of 16 pending dispatches');
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    expect(mounted.onFatal).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  });

  test('cancels a hung event dispatch promptly when its portal is removed', async () => {
    const mounted = mount(`
      import { html } from '@arrow-js/core';
      export default html\`<button @click="\${() => new Promise(() => {})}">hang</button>\`;
    `);
    await waitForReady(mounted.host);

    mounted.host?.shadowRoot?.querySelector<HTMLButtonElement>('button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 25));
    mounted.cleanup();

    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    expect(mounted.onFatal).not.toHaveBeenCalled();
    expect(mounted.root.childElementCount).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(mounted.onFatal).not.toHaveBeenCalled();
    mounted.root.remove();
  });

  test('destroys the neutral controller after a fatal event-dispatch error', async () => {
    const mounted = mount(`
      import { html } from '@arrow-js/core';
      export default html\`<button @click="\${() => { throw new Error('neutral dispatch failed'); }}">fail</button>\`;
    `);
    await waitForReady(mounted.host);

    mounted.host?.shadowRoot?.querySelector<HTMLButtonElement>('button')?.click();
    await vi.waitFor(() => {
      expect(mounted.root.dataset.widgetRuntimeStatus).toBe('error');
    }, { timeout: 10_000 });
    expect(mounted.root.textContent).toContain('neutral dispatch failed');
    expect((mounted.host as unknown as { controller: unknown }).controller).toBeNull();
    expect(mounted.functionBridge.dispose).toHaveBeenCalledOnce();
    expect(mounted.onFatal).toHaveBeenCalledOnce();
    mounted.cleanup();
    mounted.root.remove();
  });

  test('destroys the legacy controller after a fatal event-dispatch error', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const onError = vi.fn();
    const unsubscribe = vi.fn();
    const bridge = legacyBridge();
    bridge.subscribeSnapshots.mockReturnValue(unsubscribe);
    const cleanup = mountArrowSandboxBridge({ root, onError }, {
      sources: {
        'main.ts': `
          import { html } from '@arrow-js/core';
          export default html\`<button @click="\${() => { throw new Error('legacy dispatch failed'); }}">fail</button>\`;
        `,
      },
      bridge,
    });
    const host = root.querySelector('arrow-sandbox') as HTMLElement | null;
    await waitForReady(host);

    host?.shadowRoot?.querySelector<HTMLButtonElement>('button')?.click();
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('legacy dispatch failed'),
      }));
    }, { timeout: 10_000 });
    expect((host as unknown as { controller: unknown }).controller).toBeNull();
    expect(host?.dataset.ready).toBe('error');
    expect(unsubscribe).toHaveBeenCalledOnce();
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
    root.remove();
  });
});
