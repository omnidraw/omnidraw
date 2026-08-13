import type {
  TInspectActionResult,
  TInspectArtifact,
  TInspectDiagnostic,
  TInspectEvidence,
  TInspectIdentity,
  TInspectStage,
  TInspectVerification,
  TWidgetPreviewInspectResult,
} from '#backend/shell/agent';
import { fnClassifyWidgetPreviewInspection } from '#backend/shell/agent/tools/fn.widget-preview-inspect';
import type { TWidgetCapsuleTheme } from '#backend/core/widget-domain';
import type {
  TPreviewInspectionBrowserActionResult,
  TPreviewInspectionBrowserFailureEvidence,
  TPreviewInspectionBrowserResult,
  TPreviewInspectionRuntimeEvent,
  TPreviewInspectionBrowserTarget,
} from '../preview/interface';

type TProjectCompletedArgs = Readonly<{
  surface: 'artifact' | 'preview';
  browser: TPreviewInspectionBrowserResult;
  identity: TInspectIdentity;
  artifact: TInspectArtifact;
  page: TInspectEvidence['page'];
  durationMs: number;
  previewState: TInspectVerification['previewState'];
  digestSha256(value: string): string;
  mapLocation?(event: TPreviewInspectionRuntimeEvent): TInspectDiagnostic['location'] | undefined;
}>;

type TProjectFailureArgs = Readonly<{
  surface: 'artifact' | 'preview';
  error: unknown;
  stage: TInspectStage;
  identity: TInspectIdentity;
  artifact?: TInspectArtifact;
  durationMs: number;
  cancelled: boolean;
  previewState: TInspectVerification['previewState'];
  browserEvidence?: TPreviewInspectionBrowserFailureEvidence;
  digestSha256(value: string): string;
  mapLocation?(event: TPreviewInspectionRuntimeEvent): TInspectDiagnostic['location'] | undefined;
}>;

type TProjectRuntimeDiagnosticsArgs = Readonly<{
  runtimeEvents: readonly TPreviewInspectionRuntimeEvent[];
  artifactHash: string;
  runtimeGeneration: number;
  lifecycleGeneration: number;
  droppedRuntimeEventCount: number;
  digestSha256(value: string): string;
  mapLocation?(event: TPreviewInspectionRuntimeEvent): TInspectDiagnostic['location'] | undefined;
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

function fnSafeRuntimeMessage(code: string, value: string): string {
  if (/FUNCTION_INPUT|INPUT_SCHEMA/.test(code)) return 'Function input did not match its declared schema.';
  if (/FUNCTION_OUTPUT|OUTPUT_SCHEMA/.test(code)) return 'Function output did not match its declared schema.';
  if (/FUNCTION_DESCRIPTOR|DESCRIPTOR/.test(code)) return 'Function descriptor validation failed.';
  if (/RESOURCE.*(?:REQUIRED|BINDING_REQUIRED)/.test(code)) return 'A required manifest resource reference is missing.';
  if (/RESOURCE.*(?:STALE|NOT_FOUND)/.test(code)) return 'A manifest resource reference is unavailable.';
  if (/RESOURCE.*NOT_READY/.test(code)) return 'A manifest resource is not ready.';
  if (/RESOURCE.*KIND/.test(code)) return 'A manifest resource has the wrong kind.';
  if (/(?:WRITE_APPROVAL|APPROVAL_REQUIRED)/.test(code)) return 'The diagnostic write was not executed because approval is required.';
  if (/RESOURCE|PROVIDER/.test(code)) return 'The resource provider call failed safely.';
  return fnBoundedText(value, 2_000)
    .replace(/(?:file:\/\/)?\/?(?:Users|home|private|tmp|var)\/[A-Za-z0-9_./\\-]+/g, 'widget://project')
    .replace(/(?:postgres|mysql|libsql|https?):\/\/[^\s]+/gi, '[redacted]')
    .replace(/\b(token|secret|password|credential)\s*[=:]\s*\S+/gi, '$1=[redacted]');
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

function fnNextAction(
  surface: 'artifact' | 'preview',
  previewState: TInspectVerification['previewState'],
): TInspectVerification['nextAction'] {
  if (surface === 'artifact') return 'use_preview_mode_for_resources';
  if (previewState === 'absent' || previewState === 'failed') return 'repair_visible_preview';
  if (previewState === 'mounting') return 'retry_after_settle';
  if (previewState === 'retired') return 'reopen_preview';
  if (previewState === 'ambiguous') return 'remove_duplicate_previews';
  if (previewState === 'generation_mismatch') return 'retry_current_generation';
  return 'none';
}

export function fnProjectWidgetPreviewRuntimeDiagnostics(
  args: TProjectRuntimeDiagnosticsArgs,
): TInspectEvidence['diagnostics'] {
  let droppedCount = args.droppedRuntimeEventCount;
  let diagnosticBytes = 0;
  const diagnosticsByFingerprint = new Map<string, TInspectDiagnostic>();
  for (const event of args.runtimeEvents) {
    if (
      (event.artifactHash !== undefined && event.artifactHash !== args.artifactHash)
      || (event.runtimeGeneration !== undefined
        && event.runtimeGeneration !== args.runtimeGeneration)
      || (event.lifecycleGeneration !== undefined
        && event.lifecycleGeneration !== args.lifecycleGeneration)
    ) {
      droppedCount += 1;
      continue;
    }
    const origin = fnDiagnosticOrigin(event.origin);
    const phase = fnBoundedText(event.phase, 256);
    const code = fnBoundedText(event.code, 256) || 'CAPSULE_RUNTIME_EVENT';
    const message = fnSafeRuntimeMessage(code, event.message);
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
      droppedCount += 1;
      continue;
    }
    const entryBytes = fnUtf8ByteLength(fingerprint)
      + fnUtf8ByteLength(phase)
      + fnUtf8ByteLength(code)
      + fnUtf8ByteLength(message)
      + (location === undefined ? 0 : fnUtf8ByteLength(location.file));
    if (diagnosticBytes + entryBytes > 64 * 1_024) {
      droppedCount += 1;
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
  return Object.freeze({
    entries: Object.freeze([...diagnosticsByFingerprint.values()]),
    droppedCount,
    truncated: droppedCount > 0,
  });
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
  const projectedDiagnostics = fnProjectWidgetPreviewRuntimeDiagnostics({
    runtimeEvents: args.browser.runtimeEvents,
    artifactHash: args.browser.artifactHash,
    runtimeGeneration: args.browser.runtimeGeneration,
    lifecycleGeneration: args.browser.lifecycleGeneration,
    droppedRuntimeEventCount: args.browser.droppedCounts.runtimeEvents,
    digestSha256: args.digestSha256,
    ...(args.mapLocation === undefined ? {} : { mapLocation: args.mapLocation }),
  });
  const diagnostics = projectedDiagnostics.entries;
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
      droppedCount: projectedDiagnostics.droppedCount,
      truncated: projectedDiagnostics.truncated,
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
  const functional = fnClassifyWidgetPreviewInspection({
    actions,
    diagnostics,
    elements,
  });
  const completed = functional === 'observed' || functional === 'not_exercised';
  const verification = Object.freeze({
    surface: args.surface,
    generation: 'current' as const,
    artifact: 'exact' as const,
    manifest: 'exact' as const,
    resources: args.surface === 'preview' ? 'manifest_bound' as const : 'not_available' as const,
    canvasParity: args.surface === 'preview' ? 'same_runtime_policy' as const : 'not_claimed' as const,
    visibleFrame: 'not_claimed' as const,
    executionTarget: 'diagnostic_clone' as const,
    previewState: args.previewState,
    nextAction: fnNextAction(args.surface, args.previewState),
    functional,
  });
  return Object.freeze({
    status: completed ? 'completed' : 'completed_with_errors',
    identity: args.identity,
    artifact: args.artifact,
    fidelity: args.surface === 'preview'
      ? Object.freeze({
          source: 'exact' as const,
          artifact: 'exact' as const,
          runtimePolicy: 'preview' as const,
          bindings: 'manifest' as const,
          network: 'denied' as const,
          overall: 'preview_policy_exact' as const,
        })
      : Object.freeze({
          source: 'exact' as const,
          artifact: 'exact' as const,
          runtimePolicy: 'narrowed' as const,
          bindings: 'unavailable' as const,
          network: 'denied' as const,
          overall: 'artifact_exact' as const,
        }),
    verification,
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
  const diagnostics = args.browserEvidence === undefined
    ? undefined
    : fnProjectWidgetPreviewRuntimeDiagnostics({
        runtimeEvents: args.browserEvidence.runtimeEvents,
        artifactHash: args.browserEvidence.artifactHash,
        runtimeGeneration: args.browserEvidence.runtimeGeneration,
        lifecycleGeneration: args.browserEvidence.lifecycleGeneration,
        droppedRuntimeEventCount: args.browserEvidence.droppedRuntimeEventCount,
        digestSha256: args.digestSha256,
        ...(args.mapLocation === undefined ? {} : { mapLocation: args.mapLocation }),
      });
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
    verification: Object.freeze({
      surface: args.surface,
      generation: 'current',
      artifact: 'exact',
      manifest: 'exact',
      resources: args.surface === 'preview' ? 'manifest_bound' : 'not_available',
      canvasParity: args.surface === 'preview' ? 'same_runtime_policy' : 'not_claimed',
      visibleFrame: 'not_claimed',
      executionTarget: 'diagnostic_clone',
      previewState: args.previewState,
      nextAction: fnNextAction(args.surface, args.previewState),
      functional: 'failed',
    }),
    ...(args.artifact === undefined ? {} : { artifact: args.artifact }),
    ...(diagnostics === undefined
      ? {}
      : { evidence: Object.freeze({ diagnostics }) }),
    durationMs: Math.max(0, args.durationMs),
  });
}
