import { JSDOM } from 'jsdom';
import type {
  TWidgetFunctionHostBridge,
  TWidgetRuntimeIdentity,
  TVerifiedWidgetUiArtifact,
} from '../../../src/widget-runtime/interface';

const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
const nativeDateNow = Date.now.bind(Date);
const SANDBOX_LOGICAL_NOW_MS = nativeDateNow();
const MAX_TIMER_CALLBACKS_PER_WINDOW = 64;
const activeTimers = new Set<ReturnType<typeof globalThis.setTimeout>>();
const activeGuestTimers = new Set<ReturnType<typeof globalThis.setTimeout>>();
let scheduledTimers = 0;
let firedTimers = 0;
let maxActiveTimers = 0;

const trackedSetTimeout: typeof globalThis.setTimeout = ((
  callback: (...args: unknown[]) => void,
  delay?: number,
  ...args: unknown[]
) => {
  let handle: ReturnType<typeof globalThis.setTimeout>;
  const isGuestTimer = new Error().stack?.includes('scheduleTimer') === true;
  handle = nativeSetTimeout(() => {
    activeTimers.delete(handle);
    activeGuestTimers.delete(handle);
    if (isGuestTimer) firedTimers += 1;
    callback(...args);
  }, delay);
  activeTimers.add(handle);
  if (isGuestTimer) {
    scheduledTimers += 1;
    activeGuestTimers.add(handle);
    maxActiveTimers = Math.max(maxActiveTimers, activeGuestTimers.size);
  }
  return handle;
}) as typeof globalThis.setTimeout;

const trackedClearTimeout: typeof globalThis.clearTimeout = ((handle: unknown) => {
  activeTimers.delete(handle as ReturnType<typeof globalThis.setTimeout>);
  activeGuestTimers.delete(handle as ReturnType<typeof globalThis.setTimeout>);
  nativeClearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
}) as typeof globalThis.clearTimeout;

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
installGlobal('setTimeout', trackedSetTimeout);
installGlobal('clearTimeout', trackedClearTimeout);

// Exercise one complete sandbox budget window regardless of how much host CPU
// time this subprocess receives from the parallel monorepo suite. Timer delivery
// remains real and asynchronous; only Arrow's rate-window clock is held stable.
// The Vitest parent retains the independent kill bound for genuine hangs.
Object.defineProperty(Date, 'now', {
  configurable: true,
  value: () => SANDBOX_LOGICAL_NOW_MS,
  writable: true,
});

const identity: TWidgetRuntimeIdentity = {
  orgId: 'org-bounds',
  canvasId: 'canvas-bounds',
  elementId: 'element-bounds',
  widgetInstanceId: 'instance-bounds',
  definitionId: 'definition-bounds',
  revisionId: 'revision-bounds',
};
const functionBridge: TWidgetFunctionHostBridge = {
  identity,
  createIdempotencyKey: () => 'bounds-prefix',
  invoke: async () => {
    throw new Error('Timer-bound fixture must not invoke a server function.');
  },
  dispose: () => undefined,
};

function artifact(source: string): TVerifiedWidgetUiArtifact {
  const bytes = new TextEncoder().encode(source);
  return {
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
}

async function runScenario(source: string, expectedError: RegExp) {
  scheduledTimers = 0;
  firedTimers = 0;
  maxActiveTimers = 0;
  const { widgetUiArtifactMount } = await import('../../../src/widget-runtime/mount-widget-ui-artifact');
  const root = document.createElement('div');
  document.body.appendChild(root);
  const cleanup = widgetUiArtifactMount.mount({
    root,
    identity,
    artifact: artifact(source),
    functionBridge,
    collaborativeStateBridge: null,
    onFatal: () => undefined,
  });
  const host = root.querySelector('arrow-sandbox') as HTMLElement | null;
  if (root.dataset.widgetRuntimeStatus !== 'error') {
    await new Promise<void>((resolve) => {
      const observer = new dom.window.MutationObserver(() => {
        if (root.dataset.widgetRuntimeStatus !== 'error') return;
        observer.disconnect();
        resolve();
      });
      observer.observe(root, {
        attributeFilter: ['data-widget-runtime-status'],
        attributes: true,
      });

      // Close the mount/observe race if a synchronous host failure landed
      // between the initial status check and observer registration.
      if (root.dataset.widgetRuntimeStatus === 'error') {
        observer.disconnect();
        resolve();
      }
    });
  }
  if (root.dataset.widgetRuntimeStatus !== 'error' || !expectedError.test(root.textContent ?? '')) {
    throw new Error(`Unexpected timer-bound failure: ${root.textContent ?? ''}`);
  }
  cleanup();
  await new Promise((resolve) => nativeSetTimeout(resolve, 20));
  if (activeTimers.size !== 0) {
    throw new Error(`Sandbox teardown leaked ${activeTimers.size} host timer(s).`);
  }
  if ((host as unknown as { controller: unknown } | null)?.controller !== null) {
    throw new Error('Sandbox timer-bound realm was not destroyed.');
  }
  root.remove();
  return { firedTimers, maxActiveTimers, scheduledTimers };
}

const outstanding = await runScenario(
  `for (let index = 0; index < 65; index += 1) {
    setTimeout(() => undefined, 60_000);
  }
  export default 'unreachable';`,
  /host cap of 64 active timers/,
);
if (outstanding.scheduledTimers !== 64 || outstanding.maxActiveTimers !== 64) {
  throw new Error(`Outstanding timer cap was not exact: ${JSON.stringify(outstanding)}`);
}

const recursive = await runScenario(
  `function recurse() { setTimeout(recurse, 0); }
  setTimeout(recurse, 0);
  export default 'recursive timer';`,
  /timer callbacks exceeded the host rate budget of 64 per 1000ms/,
);
if (
  recursive.scheduledTimers > 65
  || recursive.firedTimers > 65
  || recursive.maxActiveTimers > 1
) {
  throw new Error(`Recursive timer work escaped its budget: ${JSON.stringify(recursive)}`);
}

const cumulative = await runScenario(
  `function recurse() {
    let total = 0;
    for (let index = 0; index < 100_000; index += 1) total += index;
    if (total < 0) throw new Error('unreachable');
    setTimeout(recurse, 0);
  }
  setTimeout(recurse, 0);
  export default 'cumulative timer';`,
  /Sandbox execution exceeded the host instruction budget/,
);
if (
  cumulative.firedTimers <= 1
  || cumulative.scheduledTimers > MAX_TIMER_CALLBACKS_PER_WINDOW + 1
  || cumulative.firedTimers > MAX_TIMER_CALLBACKS_PER_WINDOW + 1
) {
  throw new Error(`Cumulative callback work escaped its budget: ${JSON.stringify(cumulative)}`);
}

console.log('[widget-sandbox-async] timer caps and cumulative execution budget bounded work and teardown cleared every timer');
process.exit(0);
