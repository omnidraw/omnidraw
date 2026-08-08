import type {
  CapsuleAuthoringInspectionFocusedTargetCheck,
  CapsuleAuthoringInspectionKeyboardGuardResult,
  CapsuleAuthoringInspectionKeyboardGuardTicket,
  CapsuleAuthoringInspectionKeyboardOperation,
  CapsuleAuthoringInspectionPointCheck,
  CapsuleAuthoringInspectionRole,
  CapsuleAuthoringInspectionTarget,
} from '@omnidraw/capsule-omnidraw/authoring-inspection';
import type { CapsuleMountErrorEvent } from '@omnidraw/capsule-omnidraw/host';
import {
  createWidgetAuthoringInspectionMountPort,
  type TWidgetAuthoringInspectionRuntimeHandle,
  type TWidgetCapsuleHostCatalog,
  type TWidgetFunctionHostBridge,
  type TWidgetPreviewRuntimeIdentity,
  type TWidgetServerFunctionClientRequest,
} from '@omnidraw/ui-ai-chat/widget-runtime';
import type {
  TWidgetBrowserFunctionDescriptor,
  TWidgetCapsuleHostConfiguration,
  TWidgetCapsuleProps,
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetCapsuleTheme,
} from '@omnidraw/widget-contract';

type TBrowserMountJob = Readonly<{
  jobId: string;
  widgetKey: string;
  artifact: Readonly<{
    bytesBase64: string;
    digestSha256: string;
    capsuleArtifactHash: `sha256:${string}`;
    runtimeDescriptor: TWidgetCapsuleRuntimeDescriptor;
  }>;
  hostConfiguration: TWidgetCapsuleHostConfiguration;
  functionDescriptors: readonly TWidgetBrowserFunctionDescriptor[];
  browserFunctionDescriptorsDigestSha256: string;
  props?: TWidgetCapsuleProps;
  theme: TWidgetCapsuleTheme;
  viewport: Readonly<{
    width: number;
    height: number;
    deviceScaleFactor: 1 | 2;
  }>;
}>;

type TInspectionTarget = Readonly<{
  id: number;
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  computed: Readonly<{ display: string; visibility: string; opacity: string }>;
  state?: Readonly<{
    checked?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    selected?: boolean;
  }>;
  editable: boolean;
  sensitive: boolean;
}>;

type TInspectionRuntimeEvent = Readonly<{
  origin: string;
  phase: string;
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  artifactHash?: string;
  runtimeGeneration?: number;
  lifecycleGeneration?: number;
  location?: Readonly<{ module: string; line: number; column: number }>;
}>;

type TInspectionSnapshot = Readonly<{
  artifactDigestSha256: string;
  capsuleArtifactHash: `sha256:${string}`;
  runtimeGeneration: number;
  lifecycleGeneration: number;
  scannedElements: number;
  targets: readonly TInspectionTarget[];
  canvases: readonly Readonly<{
    id: number;
    bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
    width: number;
    height: number;
    context: '2d' | 'webgl' | 'webgl2' | 'webgpu' | 'unknown';
    contextLost: boolean;
  }>[];
  runtimeEvents: readonly TInspectionRuntimeEvent[];
  droppedCounts: Readonly<{
    targets: number;
    canvases: number;
    runtimeEvents: number;
  }>;
}>;

type TInspectionTargetInput =
  | Readonly<{ by: 'css'; selector: string }>
  | Readonly<{
      by: 'role';
      role: CapsuleAuthoringInspectionRole;
      name?: string;
      exact?: boolean;
    }>
  | Readonly<{ by: 'label'; text: string; exact?: boolean }>;

declare global {
  interface Window {
    __OMNIDRAW_PREVIEW_INSPECTION_INVOKE__?: (
      request: Readonly<{ functionName: string; input: unknown }>,
    ) => Promise<unknown>;
    __OMNIDRAW_PREVIEW_INSPECTION_SHELL__?: Readonly<{
      format: 'omnidraw.preview-inspection-shell.v1';
      mount(job: TBrowserMountJob): Promise<void>;
      query(target: TInspectionTargetInput): readonly TInspectionTarget[];
      validateActionPoint(targetId: number): CapsuleAuthoringInspectionPointCheck;
      validateFocusedTarget(targetId: number): CapsuleAuthoringInspectionFocusedTargetCheck;
      armNativeKeyboardGuard(
        targetId: number,
        operation: CapsuleAuthoringInspectionKeyboardOperation,
      ): CapsuleAuthoringInspectionKeyboardGuardTicket;
      finishNativeKeyboardGuard(
        guardId: number,
      ): CapsuleAuthoringInspectionKeyboardGuardResult;
      waitFrames(count: number, timeoutMs: number): Promise<void>;
      snapshot(): TInspectionSnapshot;
      destroy(reason: string): Promise<void>;
    }>;
  }
}

const rootElement = document.querySelector<HTMLDivElement>('#widget-root');
if (rootElement === null) throw new Error('Preview inspection root is missing.');
const root: HTMLDivElement = rootElement;

const MAX_RUNTIME_EVENTS = 100;
const runtimeEvents: TInspectionRuntimeEvent[] = [];
let droppedRuntimeEvents = 0;
let handle: TWidgetAuthoringInspectionRuntimeHandle | undefined;
let activeJob: TBrowserMountJob | undefined;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function digestSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function importCatalog(
  configuration: TWidgetCapsuleHostConfiguration,
): Promise<TWidgetCapsuleHostCatalog> {
  const keys = await Promise.all(configuration.signingKeys.map(async (key) => {
    const imported = await crypto.subtle.importKey(
      key.format,
      decodeBase64(key.publicKeyBase64).buffer as ArrayBuffer,
      { name: key.algorithm },
      false,
      ['verify'],
    );
    return [key.keyId, imported] as const;
  }));
  const trustedSigningKeys = new Map(keys);
  if (trustedSigningKeys.size !== keys.length) {
    throw new Error('Preview inspection signing key catalog contains duplicates.');
  }
  return Object.freeze({
    generation: configuration.generation,
    allowedApis: Object.freeze([...configuration.allowedApis]),
    limits: Object.freeze({ ...configuration.limits }),
    previewSigningKeyId: configuration.previewSigningKeyId,
    releaseSigningKeyId: configuration.releaseSigningKeyId,
    trustedSigningKeys,
  });
}

function projectTarget(target: CapsuleAuthoringInspectionTarget): TInspectionTarget {
  const state = {
    ...(target.checked === undefined ? {} : { checked: target.checked }),
    ...(target.disabled === undefined ? {} : { disabled: target.disabled }),
    ...(target.expanded === undefined ? {} : { expanded: target.expanded }),
    ...(target.selected === undefined ? {} : { selected: target.selected }),
  };
  return Object.freeze({
    id: target.id,
    tag: target.tagName,
    ...(target.role === undefined ? {} : { role: target.role }),
    ...(target.name.length === 0 ? {} : { name: target.name }),
    ...(target.text.length === 0 ? {} : { text: target.text }),
    bounds: Object.freeze({ ...target.bounds }),
    computed: Object.freeze({ ...target.computed }),
    ...(Object.keys(state).length === 0 ? {} : { state: Object.freeze(state) }),
    editable: target.editable,
    sensitive: target.sensitive,
  });
}

function projectGeneratedLocation(
  value: Readonly<{ module: string; line: number; column: number }> | undefined,
): Readonly<{ module: string; line: number; column: number }> | undefined {
  if (
    value === undefined
    || value.module.length > 256
    || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:js|mjs|cjs)$/.test(value.module)
    || !Number.isSafeInteger(value.line)
    || value.line < 1
    || value.line > 1_000_000
    || !Number.isSafeInteger(value.column)
    || value.column < 0
    || value.column > 1_000_000
  ) return undefined;
  return Object.freeze({
    module: value.module,
    line: value.line,
    column: value.column,
  });
}

function projectRuntimeEvent(event: CapsuleMountErrorEvent): TInspectionRuntimeEvent {
  const location = 'location' in event
    ? projectGeneratedLocation(event.location)
    : undefined;
  return Object.freeze({
    origin: event.source,
    phase: event.category,
    code: event.code,
    severity: event.fatal ? 'error' : 'warning',
    message: `${event.source} ${event.code}`.slice(0, 2_000),
    ...('artifactHash' in event ? { artifactHash: event.artifactHash } : {}),
    ...('runtimeGeneration' in event
      ? { runtimeGeneration: event.runtimeGeneration }
      : {}),
    lifecycleGeneration: event.lifecycleGeneration,
    ...(location === undefined ? {} : { location }),
  });
}

function fenceRuntimeEventLocation(
  event: TInspectionRuntimeEvent,
  expected: Readonly<{
    artifactHash: string;
    runtimeGeneration: number;
    lifecycleGeneration: number;
  }>,
): TInspectionRuntimeEvent {
  if (event.location === undefined) return event;
  if (
    event.artifactHash === expected.artifactHash
    && event.runtimeGeneration === expected.runtimeGeneration
    && event.lifecycleGeneration === expected.lifecycleGeneration
  ) return event;
  const { location: _location, ...withoutLocation } = event;
  return Object.freeze(withoutLocation);
}

function recordRuntimeEvent(event: CapsuleMountErrorEvent): void {
  if (runtimeEvents.length >= MAX_RUNTIME_EVENTS) {
    droppedRuntimeEvents += 1;
    return;
  }
  runtimeEvents.push(projectRuntimeEvent(event));
}

const mountPort = createWidgetAuthoringInspectionMountPort({
  document,
  createStreamId: () => crypto.randomUUID(),
  digestSha256,
});

async function mount(job: TBrowserMountJob): Promise<void> {
  if (handle !== undefined || activeJob !== undefined) {
    throw new Error('Preview inspection shell is single-use.');
  }
  const bytes = decodeBase64(job.artifact.bytesBase64);
  if (await digestSha256(bytes) !== job.artifact.digestSha256) {
    throw new Error('Preview inspection artifact digest is invalid.');
  }
  root.style.width = `${job.viewport.width}px`;
  root.style.height = `${job.viewport.height}px`;
  runtimeEvents.length = 0;
  droppedRuntimeEvents = 0;
  let bridgeDisposed = false;
  const identity: TWidgetPreviewRuntimeIdentity = Object.freeze({
    kind: 'draft_preview',
    canvasId: `inspection-${job.jobId}`,
    elementId: `inspection-${job.jobId}`,
    widgetKey: job.widgetKey,
  });
  const functionBridge: TWidgetFunctionHostBridge = Object.freeze({
    identity,
    async invoke<TOutput = unknown>(
      request: TWidgetServerFunctionClientRequest,
    ): Promise<TOutput> {
      if (bridgeDisposed) throw new Error('Inspection function bridge is disposed.');
      const invoke = window.__OMNIDRAW_PREVIEW_INSPECTION_INVOKE__;
      if (invoke === undefined) {
        throw new Error('Inspection function bridge is unavailable.');
      }
      return await invoke({
        functionName: request.functionName,
        input: request.input,
      }) as TOutput;
    },
    dispose(): void {
      bridgeDisposed = true;
    },
  });
  activeJob = job;
  try {
    handle = await mountPort.mount({
      root,
      identity,
      catalog: await importCatalog(job.hostConfiguration),
      artifact: Object.freeze({
        bytes,
        digestSha256: job.artifact.digestSha256,
        capsuleArtifactHash: job.artifact.capsuleArtifactHash,
        runtimeDescriptor: job.artifact.runtimeDescriptor,
        retainedByteSize: bytes.byteLength,
      }),
      functionDescriptors: job.functionDescriptors,
      browserFunctionDescriptorsDigestSha256:
        job.browserFunctionDescriptorsDigestSha256,
      functionBridge,
      ...(job.props === undefined ? {} : { props: job.props }),
      theme: job.theme,
      onRuntimeEvent: recordRuntimeEvent,
      onFatal() {
        if (runtimeEvents.length >= MAX_RUNTIME_EVENTS) {
          droppedRuntimeEvents += 1;
          return;
        }
        runtimeEvents.push(Object.freeze({
          origin: 'host',
          phase: 'lifecycle',
          code: 'INSPECTION_FATAL',
          severity: 'error',
          message: 'host INSPECTION_FATAL',
        }));
      },
    });
    await handle.ready();
  } catch (error) {
    activeJob = undefined;
    functionBridge.dispose();
    throw error;
  }
}

function query(target: TInspectionTargetInput): readonly TInspectionTarget[] {
  const inspection = handle?.inspection;
  if (inspection === undefined) throw new Error('Preview inspection is not mounted.');
  const request = target.by === 'css'
    ? { css: target.selector, maxResults: 2 } as const
    : target.by === 'role'
      ? {
          role: target.role,
          ...(target.name === undefined ? {} : { name: target.name }),
          ...(target.exact === undefined ? {} : { exact: target.exact }),
          maxResults: 2,
        } as const
      : {
          label: target.text,
          ...(target.exact === undefined ? {} : { exact: target.exact }),
          maxResults: 2,
        } as const;
  return Object.freeze(inspection.query(request).map(projectTarget));
}

function waitFrames(count: number, timeoutMs: number): Promise<void> {
  if (!Number.isSafeInteger(count) || count < 1 || count > 120) {
    return Promise.reject(new TypeError('Inspection frame count is invalid.'));
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    return Promise.reject(new TypeError('Inspection frame timeout is invalid.'));
  }
  return new Promise<void>((resolve, reject) => {
    let remaining = count;
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Inspection animation-frame wait timed out.'));
    }, timeoutMs);
    const frame = (): void => {
      if (settled) return;
      remaining -= 1;
      if (remaining === 0) {
        settled = true;
        window.clearTimeout(timeout);
        resolve();
        return;
      }
      window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
  });
}

function snapshot(): TInspectionSnapshot {
  const inspection = handle?.inspection;
  const job = activeJob;
  if (inspection === undefined || job === undefined) {
    throw new Error('Preview inspection is not mounted.');
  }
  const targets = inspection.visibleSummary({ maxResults: 128 }).map(projectTarget);
  const canvases = inspection.canvases({ maxResults: 16 }).map((canvas) => Object.freeze({
    ...canvas,
    bounds: Object.freeze({ ...canvas.bounds }),
  }));
  const diagnostics = inspection.diagnostics();
  if (
    diagnostics.state !== 'bound'
    || diagnostics.runtimeGeneration === undefined
    || diagnostics.lifecycleGeneration === undefined
  ) throw new Error('Preview inspection generation is unavailable.');
  const fencedRuntimeEvents = runtimeEvents.map((event) => fenceRuntimeEventLocation(
    event,
    {
      artifactHash: job.artifact.capsuleArtifactHash,
      runtimeGeneration: diagnostics.runtimeGeneration!,
      lifecycleGeneration: diagnostics.lifecycleGeneration!,
    },
  ));
  return Object.freeze({
    artifactDigestSha256: job.artifact.digestSha256,
    capsuleArtifactHash: job.artifact.capsuleArtifactHash,
    runtimeGeneration: diagnostics.runtimeGeneration,
    lifecycleGeneration: diagnostics.lifecycleGeneration,
    scannedElements: diagnostics.scannedElements,
    targets: Object.freeze(targets),
    canvases: Object.freeze(canvases),
    runtimeEvents: Object.freeze(fencedRuntimeEvents),
    droppedCounts: Object.freeze({
      targets: diagnostics.lastVisibleSummaryOmitted,
      canvases: diagnostics.lastCanvasOmitted,
      runtimeEvents: droppedRuntimeEvents,
    }),
  });
}

async function destroy(reason: string): Promise<void> {
  const mounted = handle;
  handle = undefined;
  activeJob = undefined;
  await mounted?.destroy(reason);
  root.replaceChildren();
}

window.__OMNIDRAW_PREVIEW_INSPECTION_SHELL__ = Object.freeze({
  format: 'omnidraw.preview-inspection-shell.v1',
  mount,
  query,
  validateActionPoint(targetId: number) {
    const inspection = handle?.inspection;
    if (inspection === undefined) throw new Error('Preview inspection is not mounted.');
    return inspection.validateActionPoint(targetId);
  },
  validateFocusedTarget(targetId: number) {
    const inspection = handle?.inspection;
    if (inspection === undefined) throw new Error('Preview inspection is not mounted.');
    return inspection.validateFocusedTarget(targetId);
  },
  armNativeKeyboardGuard(
    targetId: number,
    operation: CapsuleAuthoringInspectionKeyboardOperation,
  ) {
    const inspection = handle?.inspection;
    if (inspection === undefined) throw new Error('Preview inspection is not mounted.');
    return inspection.armNativeKeyboardGuard(targetId, operation);
  },
  finishNativeKeyboardGuard(guardId: number) {
    const inspection = handle?.inspection;
    if (inspection === undefined) throw new Error('Preview inspection is not mounted.');
    return inspection.finishNativeKeyboardGuard(guardId);
  },
  waitFrames,
  snapshot,
  destroy,
});
