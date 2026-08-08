import type {
  TInspectActionResult,
  TInspectArtifact,
  TInspectDiagnostic,
  TInspectEvidence,
  TInspectIdentity,
  TInspectStage,
  TWidgetPreviewInspectResult,
} from '@omnidraw/service-agent';
import type { TWidgetCapsuleTheme } from '@omnidraw/widget-contract';
import type {
  TPreviewInspectionBrowserActionResult,
  TPreviewInspectionBrowserResult,
  TPreviewInspectionRuntimeEvent,
  TPreviewInspectionBrowserTarget,
} from './preview-inspection/interface';

type TProjectCompletedArgs = Readonly<{
  browser: TPreviewInspectionBrowserResult;
  identity: TInspectIdentity;
  artifact: TInspectArtifact;
  page: TInspectEvidence['page'];
  durationMs: number;
  digestSha256(value: string): string;
  mapLocation?(event: TPreviewInspectionRuntimeEvent): TInspectDiagnostic['location'] | undefined;
}>;

type TProjectFailureArgs = Readonly<{
  error: unknown;
  stage: TInspectStage;
  identity: TInspectIdentity;
  artifact?: TInspectArtifact;
  durationMs: number;
  cancelled: boolean;
}>;

const ORIGINS: readonly TInspectDiagnostic['origin'][] = Object.freeze([
  'source',
  'install',
  'build',
  'capsule',
  'host',
  'guest',
  'capability',
  'channel',
  'budget',
  'lifecycle',
]);

function fnBoundedText(value: string, maximum: number): string {
  return value.replaceAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, maximum);
}

function fnUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function fnDiagnosticOrigin(value: string): TInspectDiagnostic['origin'] {
  if (value === 'guest' || value.startsWith('guest.')) return 'guest';
  return ORIGINS.includes(value as TInspectDiagnostic['origin'])
    ? value as TInspectDiagnostic['origin']
    : 'capsule';
}

function fnProjectTarget(
  target: TPreviewInspectionBrowserTarget,
): NonNullable<TInspectActionResult['target']> {
  return Object.freeze({
    id: target.id,
    tag: fnBoundedText(target.tag, 128),
    ...(target.role === undefined
      ? {}
      : { role: fnBoundedText(target.role, 128) }),
    ...(target.sensitive || target.name === undefined
      ? {}
      : { name: fnBoundedText(target.name, 512) }),
    bounds: Object.freeze({ ...target.bounds }),
  });
}

function fnProjectAction(
  action: TPreviewInspectionBrowserActionResult,
): TInspectActionResult {
  return Object.freeze({
    index: action.index,
    type: action.type,
    status: action.status,
    matchedCount: action.matchedCount,
    message: fnBoundedText(action.message, 2_000),
    ...(action.target === undefined ? {} : { target: fnProjectTarget(action.target) }),
  });
}

function fnErrorCode(error: unknown): string {
  if (
    error !== null
    && typeof error === 'object'
    && 'code' in error
    && typeof error.code === 'string'
    && /^[A-Z][A-Z0-9_]{0,255}$/.test(error.code)
  ) return error.code;
  return 'PREVIEW_INSPECTION_FAILED';
}

function fnErrorMessage(error: unknown): string {
  const code = fnErrorCode(error);
  if (code === 'PREVIEW_INSPECTION_TIMED_OUT') {
    return 'Preview inspection exceeded its whole-call timeout.';
  }
  if (code === 'PREVIEW_INSPECTION_CANCELLED') {
    return 'Preview inspection was cancelled.';
  }
  if (/^(?:BROWSER|INSPECTION_SHELL)_/.test(code)) {
    return 'The isolated Preview inspection browser could not complete the requested run.';
  }
  if (/^(?:WIDGET|PREVIEW)_/.test(code)) {
    return 'The exact widget Preview construction could not complete inspection.';
  }
  return 'Preview inspection failed during isolated execution.';
}

export function fnDefaultWidgetPreviewInspectionTheme(): TWidgetCapsuleTheme {
  return Object.freeze({
    format: 'omnidraw.widget-theme.v1',
    appearance: 'light',
    tokens: Object.freeze({
      background: '#ffffff',
      foreground: '#18181b',
      surface: '#ffffff',
      surfaceForeground: '#18181b',
      muted: '#f4f4f5',
      mutedForeground: '#71717a',
      primary: '#16a34a',
      primaryForeground: '#ffffff',
      accent: '#4f46e5',
      accentForeground: '#ffffff',
      destructive: '#dc2626',
      success: '#16a34a',
      border: '#e4e4e7',
    }),
  });
}

export function fnProjectWidgetPreviewInspectionCompleted(
  args: TProjectCompletedArgs,
): TWidgetPreviewInspectResult {
  const actions = Object.freeze(args.browser.actionResults.map(fnProjectAction));
  let mismatchedDiagnostics = 0;
  let diagnosticBytes = 0;
  const diagnosticsByFingerprint = new Map<string, TInspectDiagnostic>();
  for (const event of args.browser.runtimeEvents) {
    if (
      (event.artifactHash !== undefined
        && event.artifactHash !== args.browser.capsuleArtifactHash)
      || (event.runtimeGeneration !== undefined
        && event.runtimeGeneration !== args.browser.runtimeGeneration)
      || (event.lifecycleGeneration !== undefined
        && event.lifecycleGeneration !== args.browser.lifecycleGeneration)
    ) {
      mismatchedDiagnostics += 1;
      continue;
    }
    const origin = fnDiagnosticOrigin(event.origin);
    const phase = fnBoundedText(event.phase, 256);
    const code = fnBoundedText(event.code, 256) || 'CAPSULE_RUNTIME_EVENT';
    const message = fnBoundedText(event.message, 2_000);
    const location = args.mapLocation?.(event);
    const fingerprint = args.digestSha256([
      origin,
      phase,
      code,
      event.severity,
      message,
      location?.file ?? '',
      String(location?.line ?? ''),
      String(location?.column ?? ''),
    ].join('\u0000'));
    const existing = diagnosticsByFingerprint.get(fingerprint);
    if (existing !== undefined) {
      diagnosticsByFingerprint.set(fingerprint, Object.freeze({
        ...existing,
        occurrenceCount: existing.occurrenceCount + 1,
      }));
      continue;
    }
    if (diagnosticsByFingerprint.size >= 100) {
      mismatchedDiagnostics += 1;
      continue;
    }
    const entryBytes = fnUtf8ByteLength(fingerprint)
      + fnUtf8ByteLength(phase)
      + fnUtf8ByteLength(code)
      + fnUtf8ByteLength(message)
      + (location === undefined ? 0 : fnUtf8ByteLength(location.file));
    if (diagnosticBytes + entryBytes > 64 * 1_024) {
      mismatchedDiagnostics += 1;
      continue;
    }
    diagnosticBytes += entryBytes;
    diagnosticsByFingerprint.set(fingerprint, Object.freeze({
      fingerprint,
      origin,
      phase,
      code,
      severity: event.severity,
      message,
      trust: origin === 'guest' ? 'untrusted' : 'trusted',
      retryability: 'unknown',
      occurrenceCount: 1,
      ...(location === undefined ? {} : { location }),
    }));
  }
  const diagnostics = Object.freeze([...diagnosticsByFingerprint.values()]);
  const elements = Object.freeze(args.browser.targets.slice(0, 128).map((target) => {
    const state = Object.freeze({ ...(target.state ?? {}) });
    return Object.freeze({
      id: target.id,
      tag: fnBoundedText(target.tag, 128),
      ...(target.role === undefined
        ? {}
        : { role: fnBoundedText(target.role, 128) }),
      ...(target.sensitive || target.name === undefined
        ? {}
        : { name: fnBoundedText(target.name, 512) }),
      ...(target.sensitive || target.text === undefined
        ? {}
        : { text: fnBoundedText(target.text, 512) }),
      bounds: Object.freeze({ ...target.bounds }),
      ...(Object.keys(state).length === 0 ? {} : { state }),
      computed: Object.freeze({ ...target.computed }),
    });
  }));
  const canvases = Object.freeze(args.browser.canvases.slice(0, 16).map((canvas) => Object.freeze({
    id: canvas.id,
    bounds: Object.freeze({ ...canvas.bounds }),
    width: canvas.width,
    height: canvas.height,
    context: canvas.context,
  })));
  const elementOmittedCount = Math.max(
    args.browser.droppedCounts.targets,
    args.browser.targets.length - elements.length,
  );
  const canvasOmittedCount = Math.max(
    args.browser.droppedCounts.canvases,
    args.browser.canvases.length - canvases.length,
  );
  const evidence: TInspectEvidence = Object.freeze({
    page: Object.freeze({ ...args.page }),
    actions,
    diagnostics: Object.freeze({
      entries: diagnostics,
      droppedCount: args.browser.droppedCounts.runtimeEvents + mismatchedDiagnostics,
      truncated: args.browser.droppedCounts.runtimeEvents + mismatchedDiagnostics > 0,
    }),
    elements: Object.freeze({
      entries: elements,
      scannedCount: Math.min(4_096, args.browser.scannedElements),
      omittedCount: elementOmittedCount,
      truncated: elementOmittedCount > 0,
    }),
    canvases: Object.freeze({
      entries: canvases,
      omittedCount: canvasOmittedCount,
      truncated: canvasOmittedCount > 0,
    }),
  });
  const completed = actions.every((action) => action.status === 'passed')
    && diagnostics.every((diagnostic) => diagnostic.severity !== 'error');
  return Object.freeze({
    status: completed ? 'completed' : 'completed_with_errors',
    identity: args.identity,
    artifact: args.artifact,
    fidelity: Object.freeze({
      source: 'exact',
      artifact: 'exact',
      runtimePolicy: 'narrowed',
      bindings: 'none',
      network: 'denied',
      overall: 'artifact_exact',
    }),
    screenshot: Object.freeze({
      mimeType: 'image/png',
      width: args.browser.screenshotWidth,
      height: args.browser.screenshotHeight,
      byteSize: args.browser.screenshotPng.byteLength,
      digestSha256: args.browser.screenshotDigestSha256,
    }),
    evidence,
    durationMs: Math.max(0, args.durationMs),
  });
}

export function fnProjectWidgetPreviewInspectionFailure(
  args: TProjectFailureArgs,
): TWidgetPreviewInspectResult {
  const code = fnErrorCode(args.error);
  const timedOut = code === 'PREVIEW_INSPECTION_TIMED_OUT';
  const cancelled = args.cancelled || code === 'PREVIEW_INSPECTION_CANCELLED';
  return Object.freeze({
    status: timedOut ? 'timed_out' : cancelled ? 'cancelled' : 'failed',
    stage: args.stage,
    failure: Object.freeze({
      code,
      message: fnErrorMessage(args.error),
      retryable: args.error !== null
        && typeof args.error === 'object'
        && 'retryable' in args.error
        && args.error.retryable === true,
    }),
    identity: args.identity,
    ...(args.artifact === undefined ? {} : { artifact: args.artifact }),
    durationMs: Math.max(0, args.durationMs),
  });
}
