import type {
  IWidgetBrowserHost,
  IWidgetBrowserInspectionMount,
  IWidgetFunctionHostPort,
  TWidgetBrowserFunctionDescriptor,
  TWidgetHostConfiguration,
  TWidgetHostDiagnostic,
  TWidgetProps,
  TWidgetInspectionPointCheck,
  TWidgetInspectionQuery,
  TWidgetInspectionRole,
  TWidgetInspectionTarget,
  TWidgetTheme,
} from "@omnidraw/sdk";
import { createWidgetBrowserHost, WidgetHostError } from "@omnidraw/sdk/host";
import { fnWidgetHostDiagnosticRuntimeEvent } from "./fn.widget-host-diagnostic-runtime-event";

type TBrowserMountJob = Readonly<{
  jobId: string;
  widgetKey: string;
  artifact: Readonly<{
    bytesBase64: string;
    digestSha256: string;
    artifactHash: `sha256:${string}`;
    runtime?: unknown;
    runtimeDescriptor?: unknown;
  } & Record<string, unknown>>;
  hostConfiguration: TWidgetHostConfiguration;
  functionDescriptors: readonly TWidgetBrowserFunctionDescriptor[];
  browserFunctionDescriptorsDigestSha256: string;
  props?: TWidgetProps;
  theme: TWidgetTheme;
  viewport: Readonly<{ width: number; height: number; deviceScaleFactor: 1 | 2 }>;
}>;

type TInspectionTargetInput =
  | Readonly<{ by: "css"; selector: string }>
  | Readonly<{ by: "role"; role: TWidgetInspectionRole; name?: string; exact?: boolean }>
  | Readonly<{ by: "label"; text: string; exact?: boolean }>;
type TKeyboardOperation = "delete_backward" | "insert_text" | "commit_enter";
type TKeyboardGuard = Readonly<{
  guardId: number;
  targetId: number;
  operation: TKeyboardOperation;
}>;

declare global {
  interface Window {
    __OMNIDRAW_PREVIEW_INSPECTION_INVOKE__?: (
      request: Readonly<{ functionName: string; input: unknown }>,
    ) => Promise<unknown>;
    __OMNIDRAW_PREVIEW_INSPECTION_SHELL__?: Readonly<{
      format: "omnidraw.preview-inspection-shell.v1";
      mount(job: TBrowserMountJob): Promise<void>;
      query(target: TInspectionTargetInput): readonly ReturnType<typeof projectTarget>[];
      validateActionPoint(targetId: number): TWidgetInspectionPointCheck;
      validateFocusedTarget(targetId: number): Readonly<{ targetId: number; valid: boolean; reason: string }>;
      armNativeKeyboardGuard(targetId: number, operation: TKeyboardOperation): TKeyboardGuard;
      finishNativeKeyboardGuard(guardId: number): Readonly<{
        guardId: number;
        targetId: number;
        operation: TKeyboardOperation;
        valid: boolean;
        reason: string;
        keydownObserved: boolean;
        beforeinputObserved: boolean;
        defaultPrevented: boolean;
      }>;
      waitFrames(count: number, timeoutMs: number): Promise<void>;
      snapshot(): ReturnType<typeof snapshot>;
      destroy(reason: string): Promise<void>;
    }>;
  }
}

const rootElement = document.querySelector<HTMLDivElement>("#widget-root");
if (rootElement === null) throw new Error("Preview inspection root is missing.");
const root: HTMLDivElement = rootElement;

let host: IWidgetBrowserHost | undefined;
let mountHandle: IWidgetBrowserInspectionMount | undefined;
let activeArtifactHash: string | undefined;
let activeJob: TBrowserMountJob | undefined;
let nextGuardId = 1;
const runtimeEvents: Array<Readonly<{
  origin: string;
  phase: string;
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  artifactHash?: string;
  runtimeGeneration?: number;
  lifecycleGeneration?: number;
}>> = [];
const guards = new Map<number, {
  ticket: TKeyboardGuard;
  keydownObserved: boolean;
  beforeinputObserved: boolean;
  defaultPrevented: boolean;
  remove(): void;
}>();

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

async function digestSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function projectTarget(target: TWidgetInspectionTarget) {
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

function recordDiagnostic(diagnostic: TWidgetHostDiagnostic): void {
  if (runtimeEvents.length >= 100) return;
  const details = mountHandle?.diagnostics();
  runtimeEvents.push(fnWidgetHostDiagnosticRuntimeEvent(
    diagnostic,
    details === undefined ? undefined : {
      artifactHash: details.artifactHash,
      generation: details.generation,
    },
  ));
}

function recordShellFailure(code: string): void {
  if (runtimeEvents.length >= 100) return;
  runtimeEvents.push(Object.freeze({
    origin: "shell",
    phase: "mount",
    code,
    severity: "error",
    message: `shell ${code}`,
    ...(activeArtifactHash === undefined ? {} : {
      artifactHash: activeArtifactHash,
      runtimeGeneration: 1,
      lifecycleGeneration: 1,
    }),
  }));
}

async function mount(job: TBrowserMountJob): Promise<void> {
  if (activeJob !== undefined) throw new Error("Preview inspection shell is single-use.");
  const bytes = decodeBase64(job.artifact.bytesBase64);
  if (await digestSha256(bytes) !== job.artifact.digestSha256) {
    throw new Error("Preview inspection artifact digest is invalid.");
  }
  root.style.width = `${job.viewport.width}px`;
  root.style.height = `${job.viewport.height}px`;
  activeJob = job;
  activeArtifactHash = job.artifact.artifactHash;
  const functions: IWidgetFunctionHostPort = {
    async invoke(request) {
      const invoke = window.__OMNIDRAW_PREVIEW_INSPECTION_INVOKE__;
      if (invoke === undefined) throw new Error("Inspection function bridge is unavailable.");
      return await invoke({ functionName: request.functionName, input: request.input }) as never;
    },
  };
  let browserHost: IWidgetBrowserHost;
  try {
    browserHost = await createWidgetBrowserHost({
      document,
      catalog: job.hostConfiguration,
      createId: () => crypto.randomUUID(),
      digestSha256,
    });
  } catch (error) {
    recordShellFailure("INSPECTION_CREATE_HOST_FAILED");
    throw error;
  }
  host = browserHost;
  const runtime = job.artifact.runtime ?? job.artifact.runtimeDescriptor;
  if (runtime === undefined) throw new Error("Inspection runtime metadata is unavailable.");
  let artifact: Awaited<ReturnType<IWidgetBrowserHost["validateArtifact"]>>;
  try {
    artifact = await browserHost.validateArtifact({
      ...job.artifact,
      ...record(runtime),
      bytes,
      digestSha256: job.artifact.digestSha256,
      runtime,
      functions: job.functionDescriptors,
    });
  } catch (error) {
    recordShellFailure("INSPECTION_VALIDATE_ARTIFACT_FAILED");
    throw error;
  }
  activeArtifactHash = artifact.artifactHash;
  let mounted: IWidgetBrowserInspectionMount;
  try {
    mounted = await browserHost.inspect({
      mode: "preview",
      artifact,
      container: root,
      subject: {
        canvasId: `inspection-${job.jobId}`,
        elementId: `inspection-${job.jobId}`,
        widgetInstanceId: `inspection-${job.jobId}`,
        widgetKey: job.widgetKey,
      },
      viewport: {
        width: job.viewport.width,
        height: job.viewport.height,
        scale: 1,
        visibility: "visible",
        distance: 0,
        priority: 1,
        occlusion: 0,
      },
      props: job.props ?? {},
      theme: job.theme,
      functions,
      onDiagnostic: recordDiagnostic,
      onFatal: () => recordDiagnostic({
        format: "omnidraw.widget-host-diagnostic.v1",
        phase: "runtime",
        category: "lifecycle",
        code: "INSPECTION_FATAL",
        fatal: true,
        message: "The inspection widget failed.",
      }),
    });
  } catch (error) {
    recordShellFailure(error instanceof WidgetHostError
      ? error.code
      : "INSPECTION_CAPSULE_MOUNT_FAILED");
    throw error;
  }
  mountHandle = mounted;
  try {
    await mounted.ready();
  } catch (error) {
    recordShellFailure(error instanceof WidgetHostError
      ? error.code
      : "INSPECTION_READY_FAILED");
    throw error;
  }
}

function query(target: TInspectionTargetInput) {
  const inspection = mountHandle?.inspection;
  if (inspection === undefined) throw new Error("Preview inspection is not mounted.");
  const request: TWidgetInspectionQuery = target.by === "css"
    ? { css: target.selector, maxResults: 2 }
    : target.by === "role"
      ? { role: target.role, name: target.name, exact: target.exact, maxResults: 2 }
      : { label: target.text, exact: target.exact, maxResults: 2 };
  return Object.freeze(inspection.query(request).map(projectTarget));
}

function focusedTarget(targetId: number) {
  const target = mountHandle?.inspection.visibleSummary({ maxResults: 128 })
    .find((candidate) => candidate.id === targetId);
  if (target === undefined) return { targetId, valid: false, reason: "missing" } as const;
  if (target.sensitive) return { targetId, valid: false, reason: "sensitive" } as const;
  if (!target.editable) return { targetId, valid: false, reason: "not_editable" } as const;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return { targetId, valid: false, reason: "not_focused" } as const;
  const bounds = active.getBoundingClientRect();
  const sameBounds = Math.abs(bounds.x - target.bounds.x) < 1
    && Math.abs(bounds.y - target.bounds.y) < 1
    && Math.abs(bounds.width - target.bounds.width) < 1
    && Math.abs(bounds.height - target.bounds.height) < 1;
  return sameBounds
    ? { targetId, valid: true, reason: "valid" } as const
    : { targetId, valid: false, reason: "not_focused" } as const;
}

function armKeyboardGuard(targetId: number, operation: TKeyboardOperation): TKeyboardGuard {
  const ticket = Object.freeze({ guardId: nextGuardId++, targetId, operation });
  const state = {
    ticket,
    keydownObserved: false,
    beforeinputObserved: false,
    defaultPrevented: false,
    remove: () => {},
  };
  const onKeydown = (event: KeyboardEvent) => {
    state.keydownObserved = true;
    state.defaultPrevented ||= event.defaultPrevented;
  };
  const onBeforeInput = (event: InputEvent) => {
    state.beforeinputObserved = true;
    state.defaultPrevented ||= event.defaultPrevented;
  };
  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("beforeinput", onBeforeInput, true);
  state.remove = () => {
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("beforeinput", onBeforeInput, true);
  };
  guards.set(ticket.guardId, state);
  return ticket;
}

function finishKeyboardGuard(guardId: number) {
  const state = guards.get(guardId);
  if (state === undefined) throw new Error("Inspection keyboard guard is stale.");
  guards.delete(guardId);
  state.remove();
  const focused = focusedTarget(state.ticket.targetId);
  const observed = state.ticket.operation === "insert_text"
    ? state.beforeinputObserved
    : state.keydownObserved;
  const valid = focused.valid && observed && !state.defaultPrevented;
  return Object.freeze({
    ...state.ticket,
    valid,
    reason: valid ? "valid" : focused.valid ? "event_missing" : "focus_redirected",
    keydownObserved: state.keydownObserved,
    beforeinputObserved: state.beforeinputObserved,
    defaultPrevented: state.defaultPrevented,
  });
}

function waitFrames(count: number, timeoutMs: number): Promise<void> {
  if (!Number.isSafeInteger(count) || count < 1 || count > 120) return Promise.reject(new TypeError("Inspection frame count is invalid."));
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) return Promise.reject(new TypeError("Inspection frame timeout is invalid."));
  return new Promise((resolve, reject) => {
    let remaining = count;
    const timeout = window.setTimeout(() => reject(new Error("Inspection animation-frame wait timed out.")), timeoutMs);
    const frame = () => {
      remaining -= 1;
      if (remaining === 0) {
        window.clearTimeout(timeout);
        resolve();
      } else window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
  });
}

function snapshot() {
  const job = activeJob;
  if (job === undefined) throw new Error("Preview inspection is not mounted.");
  const diagnostics = mountHandle?.diagnostics();
  const targets = mountHandle?.inspection.visibleSummary({ maxResults: 128 }) ?? [];
  const canvases = mountHandle?.inspection.canvases({ maxResults: 16 }) ?? [];
  return Object.freeze({
    artifactDigestSha256: job.artifact.digestSha256,
    artifactHash: activeArtifactHash,
    runtimeGeneration: diagnostics?.generation ?? 1,
    lifecycleGeneration: diagnostics?.generation ?? 1,
    scannedElements: targets.length,
    targets: Object.freeze(targets.map(projectTarget)),
    canvases: Object.freeze(canvases.map((canvas) => Object.freeze({ ...canvas, bounds: Object.freeze({ ...canvas.bounds }) }))),
    runtimeEvents: Object.freeze([...runtimeEvents]),
    droppedCounts: Object.freeze({ targets: 0, canvases: 0, runtimeEvents: 0 }),
  });
}

async function destroy(reason: string): Promise<void> {
  for (const guard of guards.values()) guard.remove();
  guards.clear();
  const mounted = mountHandle;
  const activeHost = host;
  mountHandle = undefined;
  host = undefined;
  activeArtifactHash = undefined;
  activeJob = undefined;
  await mounted?.dispose(reason);
  await activeHost?.dispose();
  root.replaceChildren();
}

window.__OMNIDRAW_PREVIEW_INSPECTION_SHELL__ = Object.freeze({
  format: "omnidraw.preview-inspection-shell.v1",
  mount,
  query,
  validateActionPoint(targetId) {
    const inspection = mountHandle?.inspection;
    if (inspection === undefined) throw new Error("Preview inspection is not mounted.");
    return inspection.validateActionPoint(targetId);
  },
  validateFocusedTarget: focusedTarget,
  armNativeKeyboardGuard: armKeyboardGuard,
  finishNativeKeyboardGuard: finishKeyboardGuard,
  waitFrames,
  snapshot,
  destroy,
});
