import {
  CapsuleWidgetHostCoordinator,
  createWidgetUiArtifactMountPort,
  type TWidgetCapsuleHostCatalog,
  type TWidgetFunctionHostBridge,
  type TWidgetUiRuntimeHandle,
  type TVerifiedWidgetUiArtifact,
} from '@omnidraw/ui-ai-chat/widget-runtime';
import {
  createCapsuleHost,
  createDefaultCapsuleBrowserPlatform,
} from '@omnidraw/capsule-omnidraw/host';
import type { TWidgetCapsuleApiGroup } from '@omnidraw/widget-contract';
import fixture from '../generated/fixtures.json';

type TResult = Readonly<{
  name: string;
  pass: boolean;
  detail: string;
}>;

type TMountPort = ReturnType<typeof createWidgetUiArtifactMountPort>;
type TMountProps = NonNullable<Parameters<TMountPort['mount']>[0]['props']>;
type TFunctionDescriptors = Parameters<TMountPort['mount']>[0]['functionDescriptors'];
type TCollaborativeStateBridge =
  Parameters<TMountPort['mount']>[0]['collaborativeStateBridge'];
type TThemeSource = Parameters<typeof createWidgetUiArtifactMountPort>[0]['theme'];
type TTheme = ReturnType<TThemeSource['read']>;
type TMountOptions = Readonly<{
  mode?: 'preview' | 'published';
  functionDescriptors?: TFunctionDescriptors;
  browserFunctionDescriptorsDigestSha256?: string;
  functionBridge?: TWidgetFunctionHostBridge;
  collaborativeStateBridge?: TCollaborativeStateBridge;
}>;
type TBrowserArtifact = TVerifiedWidgetUiArtifact & Readonly<{
  browserFunctionDescriptorsDigestSha256: string;
}>;

type TPublishedResult = Readonly<{
  format: 'omnidraw.capsule-browser-acceptance-result.v1';
  state: 'running' | 'passed' | 'failed';
  passed: number;
  failed: number;
  results: readonly TResult[];
  outputs: readonly string[];
  fatalErrors: readonly string[];
  coordinator: unknown;
}>;

declare global {
  interface Window {
    __OMNIDRAW_CAPSULE_BROWSER_ACCEPTANCE__?: TPublishedResult;
    __OMNIDRAW_CAPSULE_BROWSER_ACCEPTANCE_ACK_THREE_PIXELS__?: () => void;
  }
}

const summaryCandidate = document.querySelector<HTMLElement>('#summary');
const resultsRootCandidate = document.querySelector<HTMLOListElement>('#results');
const surfacesCandidate = document.querySelector<HTMLElement>('#surfaces');
const diagnosticsCandidate = document.querySelector<HTMLPreElement>('#diagnostics');
if (
  summaryCandidate === null
  || resultsRootCandidate === null
  || surfacesCandidate === null
  || diagnosticsCandidate === null
) {
  throw new Error('Capsule browser acceptance shell is incomplete.');
}
const summary: HTMLElement = summaryCandidate;
const resultsRoot: HTMLOListElement = resultsRootCandidate;
const surfaces: HTMLElement = surfacesCandidate;
const diagnostics: HTMLPreElement = diagnosticsCandidate;

const results: TResult[] = [];
const outputs: string[] = [];
const fatalErrors: string[] = [];
let finalCoordinator: unknown = null;

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string'
      ? ` code=${error.code}`
      : '';
    const cause = error.cause === undefined
      ? ''
      : ` cause=(${errorMessage(error.cause)})`;
    return `${error.name}: ${error.message}${code}${cause}`;
  }
  return String(error);
}

function publish(state: TPublishedResult['state']): void {
  const passed = results.filter((result) => result.pass).length;
  const failed = results.length - passed;
  const value: TPublishedResult = Object.freeze({
    format: 'omnidraw.capsule-browser-acceptance-result.v1',
    state,
    passed,
    failed,
    results: Object.freeze([...results]),
    outputs: Object.freeze([...outputs]),
    fatalErrors: Object.freeze([...fatalErrors]),
    coordinator: finalCoordinator,
  });
  document.documentElement.dataset.capsuleAcceptance = state;
  summary.textContent = state === 'running'
    ? `Running (${passed} passed, ${failed} failed)…`
    : `${state.toUpperCase()}: ${passed} passed, ${failed} failed`;
  resultsRoot.replaceChildren(...results.map((result) => {
    const item = document.createElement('li');
    item.dataset.pass = String(result.pass);
    item.textContent = `${result.pass ? 'PASS' : 'FAIL'} — ${result.name}: ${result.detail}`;
    return item;
  }));
  diagnostics.textContent = JSON.stringify(value, null, 2);
  window.__OMNIDRAW_CAPSULE_BROWSER_ACCEPTANCE__ = value;
}

async function check(name: string, operation: () => void | Promise<void>): Promise<boolean> {
  try {
    await operation();
    results.push(Object.freeze({ name, pass: true, detail: 'ok' }));
    publish('running');
    return true;
  } catch (error) {
    results.push(Object.freeze({
      name,
      pass: false,
      detail: errorMessage(error),
    }));
    publish('running');
    return false;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function expectRejected<T>(operation: Promise<T>): Promise<unknown> {
  try {
    const value = await operation;
    if (
      value !== null
      && typeof value === 'object'
      && 'destroy' in value
      && typeof value.destroy === 'function'
    ) {
      await value.destroy('unexpected-success');
    }
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to reject.');
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function importVerificationKey(publicKeyBase64: string): Promise<CryptoKey> {
  const source = decodeBase64(publicKeyBase64);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  return await crypto.subtle.importKey(
    'raw',
    bytes,
    'Ed25519',
    false,
    ['verify'],
  );
}

function artifact(
  value: (typeof fixture.artifacts)[keyof typeof fixture.artifacts],
): TBrowserArtifact {
  const bytes = decodeBase64(value.bytesBase64);
  return Object.freeze({
    digestSha256: value.digestSha256,
    bytes,
    capsuleArtifactHash: value.capsuleArtifactHash,
    runtimeDescriptor: value.runtimeDescriptor,
    retainedByteSize: bytes.byteLength,
    browserFunctionDescriptorsDigestSha256:
      value.browserFunctionDescriptorsDigestSha256,
  }) as unknown as TBrowserArtifact;
}

function surface(name: string): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'surface';
  root.dataset.surface = name;
  if (name === 'react') {
    root.style.setProperty('--omnidraw-inherited-accent', '#123456');
  }
  surfaces.append(root);
  return root;
}

function functionBridge(name: string): TWidgetFunctionHostBridge {
  return Object.freeze({
    identity: Object.freeze({
      kind: 'draft_preview' as const,
      draftId: `browser-${name}`,
      definitionId: `browser-${name}`,
      revision: '1',
    }),
    async invoke() {
      throw new Error('Browser acceptance artifacts request no server functions.');
    },
    dispose() {},
  });
}

const publishedIdentity = Object.freeze({
  orgId: 'capsule-browser-acceptance',
  canvasId: 'capsule-browser-acceptance',
  elementId: 'published-authority',
  widgetInstanceId: 'published-authority',
  definitionId: 'published-authority',
  revisionId: 'published-authority-v1',
});
const providerState = {
  functionCalls: [] as unknown[],
  invalidFunctionCalls: 0,
  functionDisposals: 0,
  collaborativeGets: 0,
  collaborativeChanges: 0,
  collaborativeNexts: 0,
  collaborativeCancels: 0,
  collaborativeDisposals: 0,
};
let functionProviderDisposed = false;
const publishedFunctionBridge: TWidgetFunctionHostBridge = Object.freeze({
  identity: publishedIdentity,
  async invoke<TOutput>(
    request: Parameters<TWidgetFunctionHostBridge['invoke']>[0],
  ): Promise<TOutput> {
    if (functionProviderDisposed) throw new Error('Published function provider is disposed.');
    if (request.functionName !== 'double') {
      throw new Error(`Unexpected function operation "${request.functionName}".`);
    }
    if (
      request.input === null
      || typeof request.input !== 'object'
      || Array.isArray(request.input)
      || Reflect.ownKeys(request.input).length !== 1
      || typeof (request.input as Readonly<{ value?: unknown }>).value !== 'number'
    ) {
      providerState.invalidFunctionCalls += 1;
      throw new TypeError('Function input reached the provider without schema validation.');
    }
    providerState.functionCalls.push(request.input);
    return Object.freeze({
      doubled: (request.input as Readonly<{ value: number }>).value * 2,
    }) as TOutput;
  },
  dispose(): void {
    if (functionProviderDisposed) return;
    functionProviderDisposed = true;
    providerState.functionDisposals += 1;
  },
});

type TCollaborativeSnapshot = Awaited<
  ReturnType<NonNullable<TCollaborativeStateBridge>['get']>
>;
type TCollaborativeWaiter = Readonly<{
  afterVersion: number;
  resolve(value: TCollaborativeSnapshot): void;
}>;
let collaborativeVersion = 1;
let collaborativeValue: Readonly<{ count: number }> = Object.freeze({ count: 0 });
let collaborativeProviderDisposed = false;
const collaborativeWaiters = new Map<string, TCollaborativeWaiter>();

function collaborativeSnapshot(): TCollaborativeSnapshot {
  return Object.freeze({
    version: collaborativeVersion,
    value: collaborativeValue,
  });
}

function releaseCollaborativeWaiters(): void {
  const snapshot = collaborativeSnapshot();
  for (const [waitId, waiter] of collaborativeWaiters) {
    if (snapshot.version <= waiter.afterVersion) continue;
    collaborativeWaiters.delete(waitId);
    waiter.resolve(snapshot);
  }
}

const publishedCollaborativeBridge: NonNullable<TCollaborativeStateBridge> =
  Object.freeze({
    async get(): Promise<TCollaborativeSnapshot> {
      if (collaborativeProviderDisposed) {
        throw new Error('Published collaborative-state provider is disposed.');
      }
      providerState.collaborativeGets += 1;
      return collaborativeSnapshot();
    },
    async change(value): Promise<TCollaborativeSnapshot> {
      if (collaborativeProviderDisposed) {
        throw new Error('Published collaborative-state provider is disposed.');
      }
      if (
        value === null
        || typeof value !== 'object'
        || Array.isArray(value)
        || Reflect.ownKeys(value).length !== 1
        || !Number.isSafeInteger((value as Readonly<{ count?: unknown }>).count)
      ) {
        throw new TypeError('Published collaborative-state change was invalid.');
      }
      providerState.collaborativeChanges += 1;
      collaborativeVersion += 1;
      collaborativeValue = Object.freeze({
        count: (value as Readonly<{ count: number }>).count,
      });
      releaseCollaborativeWaiters();
      return collaborativeSnapshot();
    },
    next(afterVersion, waitId): Promise<TCollaborativeSnapshot> {
      if (collaborativeProviderDisposed) {
        return Promise.reject(new Error('Published collaborative-state provider is disposed.'));
      }
      providerState.collaborativeNexts += 1;
      if (collaborativeVersion > afterVersion) {
        return Promise.resolve(collaborativeSnapshot());
      }
      return new Promise((resolve, reject) => {
        if (collaborativeWaiters.has(waitId)) {
          reject(new Error('Duplicate collaborative-state wait ID.'));
          return;
        }
        collaborativeWaiters.set(waitId, Object.freeze({ afterVersion, resolve }));
      });
    },
    cancel(waitId): void {
      const waiter = collaborativeWaiters.get(waitId);
      if (waiter === undefined) return;
      providerState.collaborativeCancels += 1;
      collaborativeWaiters.delete(waitId);
      waiter.resolve(collaborativeSnapshot());
    },
    dispose(): void {
      if (collaborativeProviderDisposed) return;
      collaborativeProviderDisposed = true;
      providerState.collaborativeDisposals += 1;
      for (const [waitId, waiter] of collaborativeWaiters) {
        collaborativeWaiters.delete(waitId);
        waiter.resolve(collaborativeSnapshot());
      }
    },
  });

const darkTheme = Object.freeze({
  format: 'omnidraw.widget-theme.v1' as const,
  appearance: 'dark' as const,
  tokens: Object.freeze({
    background: '#09090b',
    foreground: '#fafafa',
    surface: '#18181b',
    surfaceForeground: '#fafafa',
    muted: '#27272a',
    mutedForeground: '#a1a1aa',
    primary: '#22c55e',
    primaryForeground: '#052e16',
    accent: '#4f46e5',
    accentForeground: '#ffffff',
    destructive: '#ef4444',
    success: '#22c55e',
    border: '#3f3f46',
  }),
}) satisfies TTheme;
const lightTheme = Object.freeze({
  ...darkTheme,
  appearance: 'light' as const,
}) satisfies TTheme;
let currentTheme: TTheme = darkTheme;
const themeListeners = new Set<Parameters<TThemeSource['subscribe']>[0]>();
const theme: TThemeSource = Object.freeze({
  read: () => currentTheme,
  subscribe(listener) {
    themeListeners.add(listener);
    return () => themeListeners.delete(listener);
  },
});

function setTheme(value: TTheme): void {
  currentTheme = value;
  for (const listener of [...themeListeners]) listener(value);
}

function waitForOutput(message: string, timeoutMs = 10_000): Promise<void> {
  if (outputs.includes(message)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const interval = window.setInterval(() => {
      if (outputs.includes(message)) {
        window.clearInterval(interval);
        resolve();
      } else if (performance.now() - started >= timeoutMs) {
        window.clearInterval(interval);
        reject(new Error(
          `Timed out waiting for guest output "${message}" with providers `
          + `${JSON.stringify(providerState)}.`,
        ));
      }
    }, 20);
  });
}

async function settleWithin<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<
  | Readonly<{ status: 'fulfilled'; value: T }>
  | Readonly<{ status: 'rejected'; reason: unknown }>
  | Readonly<{ status: 'timeout' }>
> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      operation.then(
        (value) => Object.freeze({ status: 'fulfilled' as const, value }),
        (reason: unknown) => Object.freeze({ status: 'rejected' as const, reason }),
      ),
      new Promise<Readonly<{ status: 'timeout' }>>((resolve) => {
        timeout = window.setTimeout(() => {
          resolve(Object.freeze({ status: 'timeout' as const }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

function createMountPort(catalog: TWidgetCapsuleHostCatalog) {
  const coordinator = new CapsuleWidgetHostCoordinator({
    document,
    catalog: () => catalog,
  });
  let streamIndex = 0;
  const port = createWidgetUiArtifactMountPort({
    coordinator,
    createStreamId: () => `browser-acceptance-${streamIndex += 1}`,
    digestSha256: async (bytes) => {
      const source = new Uint8Array(bytes.byteLength);
      source.set(bytes);
      const digest = await crypto.subtle.digest('SHA-256', source);
      return [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    },
    nowMs: () => performance.now(),
    theme,
    output: {
      notification(output) {
        outputs.push(output.message);
      },
    },
  });
  return Object.freeze({ coordinator, port });
}

async function mount(
  port: ReturnType<typeof createMountPort>['port'],
  name: string,
  value: TBrowserArtifact,
  props: TMountProps = {},
  options: TMountOptions = {},
): Promise<TWidgetUiRuntimeHandle> {
  const bridge = options.functionBridge ?? functionBridge(name);
  const handle = await port.mount({
    mode: options.mode ?? 'preview',
    root: surface(name),
    identity: bridge.identity,
    artifact: value,
    functionDescriptors: options.functionDescriptors ?? Object.freeze([]),
    browserFunctionDescriptorsDigestSha256:
      options.browserFunctionDescriptorsDigestSha256
      ?? value.browserFunctionDescriptorsDigestSha256,
    functionBridge: bridge,
    collaborativeStateBridge: options.collaborativeStateBridge ?? null,
    props,
    onFatal(error) {
      fatalErrors.push(`${name}: ${errorMessage(error)}`);
    },
  });
  try {
    await handle.ready();
  } catch (error) {
    const diagnostics = handle.diagnostics();
    await handle.destroy(`${name}-ready-failed`).catch(() => undefined);
    throw new Error(
      `Capsule ready failed with ${JSON.stringify({
        state: diagnostics.state,
        generation: diagnostics.generation,
        scheduler: {
          state: diagnostics.scheduler.state,
          activeEntries: diagnostics.scheduler.activeEntries,
          cleanupFailureCount: diagnostics.scheduler.cleanupFailureCount,
        },
        vm: {
          state: diagnostics.vm.state,
          lastErrorCode: diagnostics.vm.lastErrorCode ?? null,
          entryCount: diagnostics.vm.entryCount,
          jobsExecuted: diagnostics.vm.jobsExecuted,
          hasPendingJobs: diagnostics.vm.hasPendingJobs,
        },
        observability: diagnostics.observability,
      })}.`,
      { cause: error },
    );
  }
  return handle;
}

function retainedTerminalResources(diagnosticsValue: unknown): readonly string[] {
  const value = diagnosticsValue as {
    state?: unknown;
    scheduler?: { resources?: unknown; timers?: unknown };
    kernel?: { counters?: Record<string, unknown> };
    bridge?: {
      pendingCalls?: unknown;
      streams?: unknown;
      deferredDeliveries?: unknown;
    };
    channels?: { storeEntries?: unknown; stateBytes?: unknown };
    outputs?: { listeners?: unknown };
    timerBridge?: { timers?: unknown };
    dom?: { resources?: Record<string, unknown> };
  };
  const retained: string[] = [];
  if (value.state !== 'destroyed') retained.push(`state=${String(value.state)}`);
  const values = [
    ['scheduler.resources', value.scheduler?.resources],
    ['scheduler.timers', value.scheduler?.timers],
    ['bridge.pendingCalls', value.bridge?.pendingCalls],
    ['bridge.streams', value.bridge?.streams],
    ['bridge.deferredDeliveries', value.bridge?.deferredDeliveries],
    ['channels.storeEntries', value.channels?.storeEntries],
    ['channels.stateBytes', value.channels?.stateBytes],
    ['outputs.listeners', value.outputs?.listeners],
    ['timerBridge.timers', value.timerBridge?.timers],
  ] as const;
  for (const [name, candidate] of values) {
    if (candidate !== 0) retained.push(`${name}=${String(candidate)}`);
  }
  for (const [name, candidate] of Object.entries(value.kernel?.counters ?? {})) {
    if (candidate !== 0) retained.push(`kernel.${name}=${String(candidate)}`);
  }
  for (const [name, candidate] of Object.entries(value.dom?.resources ?? {})) {
    if (name !== 'destroyed' && candidate !== 0) {
      retained.push(`dom.${name}=${String(candidate)}`);
    }
  }
  return Object.freeze(retained);
}

async function rejectedScenario(
  name: string,
  catalog: TWidgetCapsuleHostCatalog,
  value: TBrowserArtifact,
  props: TMountProps = {},
  options: TMountOptions = {},
  expectStartupFatal = false,
): Promise<unknown> {
  const runtime = createMountPort(catalog);
  const fatalStart = fatalErrors.length;
  const outcome = await settleWithin(
    mount(runtime.port, name, value, props, options),
    5_000,
  );
  if (outcome.status === 'timeout') {
    throw new Error(`${name} rejection timed out.`);
  }
  if (outcome.status === 'fulfilled') {
    await outcome.value.destroy(`${name}-unexpected-mount`);
  }
  const beforeDestroy = runtime.coordinator.diagnostics();
  await runtime.port.destroy(`${name}-complete`);
  const afterDestroy = runtime.coordinator.diagnostics();
  assert(outcome.status === 'rejected', `${name} unexpectedly mounted.`);
  assert(beforeDestroy.handles === 0, `${name} retained a logical handle.`);
  assert(beforeDestroy.hosts.length === 0, `${name} retained a Capsule host.`);
  assert(afterDestroy.destroyed, `${name} coordinator did not terminate.`);
  assert(afterDestroy.handles === 0, `${name} retained handles after termination.`);
  assert(afterDestroy.hosts.length === 0, `${name} retained hosts after termination.`);
  const startupFatals = fatalErrors.splice(fatalStart);
  if (expectStartupFatal) {
    assert(
      startupFatals.length === 1 && startupFatals[0]!.startsWith(`${name}: `),
      `${name} did not report exactly one mount-time fatal diagnostic.`,
    );
  } else {
    fatalErrors.push(...startupFatals);
  }
  return outcome.reason;
}

publish('running');

const [previewKey, releaseKey, wrongKey] = await Promise.all([
  importVerificationKey(fixture.publicKeys.preview.publicKeyBase64),
  importVerificationKey(fixture.publicKeys.release.publicKeyBase64),
  importVerificationKey(fixture.publicKeys.wrong.publicKeyBase64),
]);

await check('verification keys are non-extractable and verify-only', () => {
  for (const key of [previewKey, releaseKey, wrongKey]) {
    assert(key.extractable === false, 'A verification key is extractable.');
    assert(key.type === 'public', 'A verification key is not public.');
    assert(key.usages.length === 1 && key.usages[0] === 'verify', 'Key usage widened.');
  }
});

const catalog: TWidgetCapsuleHostCatalog = Object.freeze({
  ...fixture.host,
  allowedApis: fixture.host.allowedApis as readonly TWidgetCapsuleApiGroup[],
  trustedSigningKeys: new Map([
    [fixture.publicKeys.preview.keyId, previewKey],
    [fixture.publicKeys.release.keyId, releaseKey],
  ]),
});
const plainArtifact = artifact(fixture.artifacts.plain);
const svgArtifact = artifact(fixture.artifacts.svg);
const canvasArtifact = artifact(fixture.artifacts.canvas);
const threeArtifact = artifact(fixture.artifacts.three);
const threeReleaseArtifact = artifact(fixture.artifacts.threeRelease);
const threePbrArtifact = artifact(fixture.artifacts.threePbr);
const threeClockArtifact = artifact(fixture.artifacts.threeClock);
const threeMissingAuthorityArtifact = artifact(fixture.artifacts.threeMissingAuthority);
const reactArtifact = artifact(fixture.artifacts.react);
const publishedArtifact = artifact(fixture.artifacts.published);
const publishedFunctionDescriptors =
  fixture.artifacts.published.functionDescriptors as TFunctionDescriptors;

function artifactApis(value: TBrowserArtifact): readonly string[] {
  assert(
    value.runtimeDescriptor.format === 'omnidraw.capsule-runtime.v2',
    'Generated acceptance artifact is not native Capsule 0.10.',
  );
  return value.runtimeDescriptor.apiContract.groups;
}

await check('generated artifacts bind signed public API contracts', () => {
  assert(
    sameJson(artifactApis(svgArtifact), ['DOM']),
    'SVG artifact requested unexpected authority.',
  );
  assert(
    sameJson(artifactApis(canvasArtifact), ['DOM', 'CANVAS_2D']),
    'Canvas artifact lacks CANVAS_2D.',
  );
  for (const value of [
    threeArtifact,
    threeReleaseArtifact,
    threePbrArtifact,
    threeClockArtifact,
  ]) {
    assert(
      value.runtimeDescriptor.format === 'omnidraw.capsule-runtime.v2',
      'Three.js fixture is not native Capsule 0.10.',
    );
    assert(
      sameJson(artifactApis(value), ['DOM', 'WEBGL']),
      'Three.js artifact lacks WEBGL.',
    );
    assert(Object.keys(value.runtimeDescriptor.budgets).length === 0,
      'Three.js fixture should exercise API-group budget defaults.');
    assert(value.runtimeDescriptor.apiContract.format === 'capsule-api-groups-v1',
      'Three.js artifact has the wrong API contract format.');
    assert(/^sha256:[0-9a-f]{64}$/.test(
      value.runtimeDescriptor.apiContract.bundleDigest,
    ), 'Three.js artifact lacks a signed bundle digest.');
  }
  assert(
    threeArtifact.capsuleArtifactHash === threeReleaseArtifact.capsuleArtifactHash,
    'Preview and release signing did not reuse one Three.js construction.',
  );
  assert(
    sameJson(artifactApis(threeMissingAuthorityArtifact), ['DOM']),
    'Negative Three.js artifact unexpectedly received ambient GPU authority.',
  );
  assert(
    fixture.testedThreeVersion === '0.185.1',
    'Three.js acceptance version drifted from product authoring guidance.',
  );
  assert(
    sameJson(artifactApis(plainArtifact), ['DOM']),
    'Plain DOM artifact received ambient feature authority.',
  );
  assert(
    sameJson(artifactApis(reactArtifact), ['DOM']),
    'React artifact received unexpected authority.',
  );
  assert(
    sameJson(artifactApis(publishedArtifact), ['DOM']),
    'Published artifact received ambient feature authority.',
  );
  assert(
    publishedArtifact.runtimeDescriptor.signatureKeyIds.length === 1
      && publishedArtifact.runtimeDescriptor.signatureKeyIds[0]
        === fixture.publicKeys.release.keyId,
    'Published artifact is not bound to the release signing authority.',
  );
  assert(
    fixture.artifacts.published.serverArtifact?.runtimeAbi
      === 'omnidraw-function-v1',
    'Published artifact lacks its exact server runtime identity.',
  );
});

const positive = createMountPort(catalog);
const handles = new Map<string, TWidgetUiRuntimeHandle>();

await check('plain DOM guest mounts and reads initial props/theme', async () => {
  const handle = await mount(positive.port, 'plain', plainArtifact, { count: 1 });
  handles.set('plain', handle);
  await waitForOutput('plain-ready:1:dark');
});

await check('live props cross the fixed validated SDK channel', async () => {
  const handle = handles.get('plain');
  assert(handle !== undefined, 'Plain guest did not mount.');
  handle.setProps({ count: 2 });
  await waitForOutput('props:2');
});

await check('live theme crosses the fixed semantic SDK channel', async () => {
  assert(handles.has('plain'), 'Plain guest did not mount.');
  setTheme(lightTheme);
  await waitForOutput('theme:light');
});

await check('SVG guest mounts through the DOM API group', async () => {
  const handle = await mount(positive.port, 'svg', svgArtifact);
  handles.set('svg', handle);
  await waitForOutput('svg-ready');
});

await check('Canvas2D guest mounts through the CANVAS_2D API group', async () => {
  const handle = await mount(positive.port, 'canvas', canvasArtifact);
  handles.set('canvas', handle);
  await waitForOutput('canvas-ready');
});

await check('Three.js r185 renders through WEBGL group defaults', async () => {
  const handle = await mount(positive.port, 'three', threeArtifact);
  handles.set('three', handle);
  await waitForOutput('three-ready:2');
  const diagnostics = handle.diagnostics();
  assert(
    diagnostics.apiContract.format === 'capsule-api-groups-v1'
      && diagnostics.apiContract.legacy === false
      && sameJson(diagnostics.apiContract.requestedApis, ['DOM', 'WEBGL'])
      && sameJson(diagnostics.apiContract.effectiveApis, ['DOM', 'WEBGL']),
    'Three.js diagnostics do not preserve requested/effective public APIs.',
  );
  document.documentElement.dataset.capsuleThreeReady = 'true';
  if (new URLSearchParams(window.location.search).has('pixelHandshake')) {
    await new Promise<void>((resolve) => {
      window.__OMNIDRAW_CAPSULE_BROWSER_ACCEPTANCE_ACK_THREE_PIXELS__ = resolve;
    });
    delete window.__OMNIDRAW_CAPSULE_BROWSER_ACCEPTANCE_ACK_THREE_PIXELS__;
  }
});

await check('React mounts with native modern CSS and inherited host variables', async () => {
  const handle = await mount(positive.port, 'react', reactArtifact);
  handles.set('react', handle);
  await waitForOutput('react-css-ready:rgb(18,52,86)');
});

await check('release-signed published guest receives exact function and collaboration authority', async () => {
  const handle = await mount(
    positive.port,
    'published',
    publishedArtifact,
    {},
    {
      mode: 'published',
      functionDescriptors: publishedFunctionDescriptors,
      functionBridge: publishedFunctionBridge,
      collaborativeStateBridge: publishedCollaborativeBridge,
    },
  );
  handles.set('published', handle);
  try {
    await waitForOutput('published-ready:0:1:42:schema-rejected');
  } catch (error) {
    const diagnostics = handle.diagnostics();
    throw new Error(
      `Published guest stalled with ${JSON.stringify({
        state: diagnostics.state,
        kernel: diagnostics.kernel,
        bridge: diagnostics.bridge,
        observability: diagnostics.observability,
        vm: diagnostics.vm,
      })}.`,
      { cause: error },
    );
  }
  const diagnostics = handle.diagnostics();
  assert(diagnostics.state === 'active', 'Published guest was not initially active.');
  assert(
    diagnostics.authority.length
      === publishedArtifact.runtimeDescriptor.capabilityRequests.length,
    'Published guest received the wrong capability count.',
  );
  for (const request of publishedArtifact.runtimeDescriptor.capabilityRequests) {
    const authority = diagnostics.authority.find((item) => item.id === request.id);
    assert(authority !== undefined, `Capability "${request.id}" was not granted.`);
    assert(authority.contractHash === request.contractHash, 'Capability contract hash widened.');
    assert(
      sameJson([...authority.operations].sort(), [...request.operations].sort()),
      'Capability operation grant does not exactly match the signed request.',
    );
  }
  await waitForOutput(`lifecycle:active:${diagnostics.generation}`);
  for (const message of [
    'collab-stream:0',
    'collab-stream:1',
  ]) {
    await waitForOutput(message);
  }
  assert(providerState.functionCalls.length === 1, 'Function provider call count widened.');
  assert(providerState.invalidFunctionCalls === 0, 'Invalid function input reached the provider.');
  assert(providerState.collaborativeGets >= 2, 'Collaborative get/stream did not reach the provider.');
  assert(providerState.collaborativeChanges === 1, 'Collaborative change count is not exact.');
  assert(providerState.collaborativeNexts >= 1, 'Collaborative subscription did not advance.');
  assert(collaborativeWaiters.size === 0, 'Collaborative subscription retained a pending wait.');
});

await check('the retained Three.js construction mounts with release authority', async () => {
  const bridge = functionBridge('three-release');
  const handle = await mount(
    positive.port,
    'three-release',
    threeReleaseArtifact,
    {},
    { mode: 'published', functionBridge: bridge },
  );
  handles.set('three-release', handle);
});

await check('active and throttled lifecycle transitions reach host diagnostics and guest', async () => {
  const handle = handles.get('published');
  assert(handle !== undefined, 'Published guest did not mount.');
  await handle.setSchedulingMode('throttled');
  const throttled = handle.diagnostics();
  assert(throttled.state === 'throttled', 'Published guest did not enter throttled state.');
  assert(throttled.scheduler.state === 'throttled', 'Scheduler did not enter throttled state.');
  await waitForOutput(`lifecycle:throttled:${throttled.generation}`);

  await handle.setSchedulingMode('active');
  const active = handle.diagnostics();
  assert(active.state === 'active', 'Published guest did not return to active state.');
  assert(active.scheduler.state === 'active', 'Scheduler did not return to active state.');
});

await check('freeze and resume are observable, non-parked, and state preserving', async () => {
  const handle = handles.get('published');
  assert(handle !== undefined, 'Published guest did not mount.');
  await handle.freeze('browser-acceptance-freeze');
  const frozen = handle.diagnostics();
  assert(frozen.state === 'frozen', 'Published guest did not enter frozen state.');
  assert(frozen.scheduler.state === 'frozen', 'Scheduler did not enter frozen state.');
  assert(frozen.snapshot.parkable === false, 'First-release widget became parkable.');

  await handle.resume('browser-acceptance-resume');
  const resumed = handle.diagnostics();
  assert(resumed.state === 'active', 'Published guest did not resume active.');
  assert(resumed.scheduler.state === 'active', 'Scheduler did not resume active.');
  assert(resumed.generation > frozen.generation, 'Resume did not advance lifecycle generation.');
});

await check('wrong public key is rejected before guest execution', async () => {
  await rejectedScenario('wrong-key', Object.freeze({
    ...catalog,
    trustedSigningKeys: new Map([
      [fixture.publicKeys.preview.keyId, wrongKey],
      [fixture.publicKeys.release.keyId, releaseKey],
    ]),
  }), plainArtifact, { count: 1 });
});

await check('tampered signed bytes are rejected before guest execution', async () => {
  const bytes = Uint8Array.from(plainArtifact.bytes);
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  await rejectedScenario('tampered', catalog, Object.freeze({
    ...plainArtifact,
    bytes,
    retainedByteSize: bytes.byteLength,
  }), { count: 1 });
});

await check('wrong artifact hash is rejected without coordinator deadlock', async () => {
  await rejectedScenario('wrong-hash', catalog, Object.freeze({
    ...plainArtifact,
    capsuleArtifactHash: `sha256:${'0'.repeat(64)}`,
    runtimeDescriptor: Object.freeze({
      ...plainArtifact.runtimeDescriptor,
      capsuleArtifactHash: `sha256:${'0'.repeat(64)}`,
    }),
  }), { count: 1 });
});

await check('mismatched API metadata is rejected by the signed Capsule boundary', async () => {
  await rejectedScenario('wrong-api-contract', catalog, Object.freeze({
    ...plainArtifact,
    runtimeDescriptor: Object.freeze({
      ...plainArtifact.runtimeDescriptor,
      apiContract: Object.freeze({
        ...plainArtifact.runtimeDescriptor.apiContract,
        format: 'capsule-api-groups-v1' as const,
        groups: Object.freeze(['DOM' as const, 'CANVAS_2D' as const]),
        bundleDigest: `sha256:${'0'.repeat(64)}` as const,
      }),
    }),
  }), { count: 1 });
});

await check('preview authority cannot be used for a published mount', async () => {
  await rejectedScenario(
    'preview-as-published',
    catalog,
    plainArtifact,
    { count: 1 },
    { mode: 'published' },
  );
});

await check('WEBGL outside deployment policy is rejected before execution', async () => {
  await rejectedScenario(
    'api-policy',
    Object.freeze({
      ...catalog,
      allowedApis: Object.freeze(catalog.allowedApis.filter((api) => api !== 'WEBGL')),
    }),
    threeArtifact,
  );
});

await check('mount narrowing can remove WEBGL but cannot widen the artifact', async () => {
  const host = await createCapsuleHost({
    allowedApis: ['DOM', 'WEBGL'],
    limits: catalog.limits,
    artifactVerification: {
      signaturePolicy: {
        trustedKeys: new Map([[fixture.publicKeys.preview.keyId, previewKey]]),
        minimumValidSignatures: 1,
        requiredKeyIds: [fixture.publicKeys.preview.keyId],
        rejectUntrustedSignatures: true,
      },
    },
    vm: {
      mode: 'release',
      maxJobsPerDrain: 1_000,
      maxEntryDepth: 32,
    },
    browserPlatform: createDefaultCapsuleBrowserPlatform({ document }),
  });
  try {
    await expectRejected(
      host.mount({
        artifact: threeArtifact.bytes,
        container: surface('mount-narrowing'),
        allowedApis: ['DOM'],
      }),
    );
  } finally {
    await host.destroy();
  }
});

await check('oversized Three.js PBR payload fails with bounded budget guidance', async () => {
  const reason = await rejectedScenario(
    'three-pbr-message-budget',
    catalog,
    threePbrArtifact,
    {},
    {},
    true,
  );
  assert(
    reason !== null
      && typeof reason === 'object'
      && 'capsuleCode' in reason
      && reason.capsuleCode === 'MESSAGE_BUDGET_EXCEEDED',
    `Three.js PBR rejection returned ${JSON.stringify(reason)}.`,
  );
  assert(
    'message' in reason
      && typeof reason.message === 'string'
      && reason.message.includes('message budget')
      && reason.message.includes('ui.budgets.messageBytes'),
    'Three.js PBR rejection did not return renderer-neutral budget guidance.',
  );
});

await check('unsupported Three.js Clock fails with actionable bounded guidance', async () => {
  const reason = await rejectedScenario(
    'three-clock-performance-api',
    catalog,
    threeClockArtifact,
    {},
    {},
    true,
  );
  assert(
    reason !== null
      && typeof reason === 'object'
      && 'capsuleCode' in reason
      && reason.capsuleCode === 'PERFORMANCE_API_UNAVAILABLE',
    `Three.js Clock rejection returned ${JSON.stringify(reason)}.`,
  );
  assert(
    'message' in reason
      && typeof reason.message === 'string'
      && reason.message.includes('monotonic timestamp')
      && reason.message.includes('requestAnimationFrame'),
    'Three.js Clock rejection did not return frame-timestamp guidance.',
  );
});

await check('Three.js without signed WebGL authority fails with actionable diagnostics', async () => {
  const reason = await rejectedScenario(
    'three-missing-authority',
    catalog,
    threeMissingAuthorityArtifact,
    {},
    {},
    true,
  );
  assert(
    reason !== null
      && typeof reason === 'object'
      && 'capsuleCode' in reason
      && reason.capsuleCode === 'WEBGL_CONTEXT_UNAVAILABLE',
    `Missing WebGL authority returned ${JSON.stringify(reason)}.`,
  );
  assert(
    'message' in reason
      && typeof reason.message === 'string'
      && reason.message.includes('WEBGL')
      && reason.message.includes('ui.apis'),
    'Missing WebGL authority did not return public WEBGL guidance.',
  );
});

await check('missing function metadata cannot create a provider binding', async () => {
  await rejectedScenario(
    'function-binding',
    catalog,
    publishedArtifact,
    {},
    {
      mode: 'published',
      functionDescriptors: Object.freeze([]),
    },
  );
});

await check('capability operation grant cannot diverge from the signed contract', async () => {
  const requests = publishedArtifact.runtimeDescriptor.capabilityRequests.map(
    (request, index) => index === 0
      ? Object.freeze({ ...request, operations: Object.freeze([]) })
      : request,
  );
  await rejectedScenario(
    'grant-mismatch',
    catalog,
    Object.freeze({
      ...publishedArtifact,
      runtimeDescriptor: Object.freeze({
        ...publishedArtifact.runtimeDescriptor,
        capabilityRequests: Object.freeze(requests),
      }),
    }),
    {},
    {
      mode: 'published',
      functionDescriptors: publishedFunctionDescriptors,
    },
  );
});

await check('missing collaborative instance binding is rejected before guest execution', async () => {
  await rejectedScenario(
    'collaboration-binding',
    catalog,
    publishedArtifact,
    {},
    {
      mode: 'published',
      functionDescriptors: publishedFunctionDescriptors,
    },
  );
});

await check('invalid initial props are rejected by the fixed channel schema', async () => {
  await rejectedScenario(
    'schema',
    catalog,
    plainArtifact,
    { oversized: 'x'.repeat(4_097) },
  );
});

await check('destroy is idempotent and terminal diagnostics retain zero resources', async () => {
  const failures: string[] = [];
  if (handles.size !== 7) {
    failures.push(`expected seven positive handles; found ${handles.size}`);
  }
  const terminals: unknown[] = [];
  for (const [name, handle] of handles) {
    try {
      await Promise.all([
        handle.destroy(`${name}-acceptance-complete`),
        handle.destroy(`${name}-duplicate-destroy`),
      ]);
      const terminal = handle.diagnostics();
      terminals.push(terminal);
      const retained = retainedTerminalResources(terminal);
      if (retained.length > 0) failures.push(`${name} retained ${retained.join(', ')}`);
    } catch (error) {
      failures.push(`${name} cleanup failed: ${errorMessage(error)}`);
    }
  }
  try {
    await positive.port.destroy('browser-acceptance-complete');
  } catch (error) {
    failures.push(`coordinator cleanup failed: ${errorMessage(error)}`);
  }
  finalCoordinator = positive.coordinator.diagnostics();
  const coordinator = finalCoordinator as ReturnType<
    CapsuleWidgetHostCoordinator['diagnostics']
  >;
  if (!coordinator.destroyed) failures.push('coordinator is not terminal');
  if (coordinator.handles !== 0) failures.push('coordinator retained logical handles');
  if (coordinator.hosts.length !== 0) failures.push('coordinator retained Capsule hosts');
  if (themeListeners.size !== 0) failures.push('theme channel listeners were retained');
  if (providerState.functionDisposals !== 1) {
    failures.push(`function provider disposal count=${providerState.functionDisposals}`);
  }
  if (providerState.collaborativeDisposals !== 1) {
    failures.push(`collaborative provider disposal count=${providerState.collaborativeDisposals}`);
  }
  if (collaborativeWaiters.size !== 0) {
    failures.push(`collaborative waits retained=${collaborativeWaiters.size}`);
  }
  for (const child of surfaces.children) {
    if (child.childElementCount !== 0) failures.push('a Capsule mount shell was retained');
  }
  if (terminals.length !== handles.size) failures.push('terminal diagnostics were not captured');
  assert(failures.length === 0, failures.join('; '));
});

const state = results.every((result) => result.pass) && fatalErrors.length === 0
  ? 'passed'
  : 'failed';
publish(state);
