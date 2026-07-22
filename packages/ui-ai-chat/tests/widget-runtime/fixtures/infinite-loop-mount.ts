import { JSDOM } from 'jsdom';
import type {
  TWidgetFunctionHostBridge,
  TWidgetRuntimeIdentity,
  TVerifiedWidgetUiArtifact,
} from '../../../src/widget-runtime/interface';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
const installGlobal = (name: string, value: unknown) => {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });
};
for (const name of [
  'Comment',
  'CustomEvent',
  'DocumentFragment',
  'Element',
  'Event',
  'HTMLDivElement',
  'HTMLElement',
  'HTMLTemplateElement',
  'Node',
  'Text',
  'customElements',
  'document',
  'navigator',
  'window',
] as const) {
  installGlobal(name, dom.window[name]);
}

const identity: TWidgetRuntimeIdentity = {
  orgId: 'org-loop',
  canvasId: 'canvas-loop',
  elementId: 'element-loop',
  widgetInstanceId: 'instance-loop',
  definitionId: 'definition-loop',
  revisionId: 'revision-loop',
};
const source = 'while (true) {} export default "unreachable";';
const bytes = new TextEncoder().encode(source);
const artifact: TVerifiedWidgetUiArtifact = {
  digestSha256: 'a'.repeat(64),
  envelope: {
    format: 'vibecanvas.widget-artifact.v1',
    kind: 'ui',
    entry: 'ui/main.ts',
    sourceDigestSha256: 'b'.repeat(64),
    builderIdentity: 'bun-browser-v1',
    runtimeAbi: null,
    outputs: [{
      path: 'output-0.js',
      loader: 'js',
      kind: 'entry-point',
      digestSha256: 'c'.repeat(64),
      bytesBase64: '',
    }],
  },
  outputs: [{
    descriptor: {
      path: 'output-0.js',
      loader: 'js',
      kind: 'entry-point',
      digestSha256: 'c'.repeat(64),
      bytesBase64: '',
    },
    bytes,
    text: source,
  }],
  retainedByteSize: bytes.byteLength,
};
const functionBridge: TWidgetFunctionHostBridge = {
  identity,
  createIdempotencyKey: () => 'loop-prefix',
  invoke: async () => {
    throw new Error('Infinite-loop fixture must not invoke a server function.');
  },
  dispose: () => undefined,
};

const { widgetUiArtifactMount } = await import('../../../src/widget-runtime/mount-widget-ui-artifact');
const root = document.createElement('div');
document.body.appendChild(root);
const cleanup = widgetUiArtifactMount.mount({
  root,
  identity,
  artifact,
  functionBridge,
  collaborativeStateBridge: null,
  onFatal: () => undefined,
});

const deadline = Date.now() + 4_000;
while (root.dataset.widgetRuntimeStatus !== 'error' && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
if (root.dataset.widgetRuntimeStatus !== 'error') {
  throw new Error('Infinite widget loop was not interrupted before the fixture deadline.');
}
if (!root.textContent?.includes('Sandbox execution exceeded the host instruction budget.')) {
  throw new Error(`Unexpected infinite-loop failure: ${root.textContent ?? ''}`);
}

cleanup();
console.log('[widget-sandbox-interrupt] bounded infinite loop interrupted and realm torn down');
process.exit(0);
