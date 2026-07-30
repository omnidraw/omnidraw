import type { TWidgetDiagnostic } from '@vibecanvas/widget-contract';
import {
  fnCanonicalizeWidgetDiagnosticFingerprint,
} from '@vibecanvas/widget-contract/fn.diagnostic';

type TPreviewDiagnosticPhase = 'verifying' | 'mounting' | 'starting' | 'runtime';

type TArgs = Readonly<{
  error: unknown;
  phase: TPreviewDiagnosticPhase;
  draftRevision: string;
  previewRevisionId: string;
  buildSequence: number;
  timestampMs: number;
  encodeFingerprint(value: string): Uint8Array;
  digestSha256(value: Uint8Array): Promise<string>;
}>;

type TDiagnosticOrigin =
  | 'host'
  | 'guest'
  | 'capability'
  | 'channel'
  | 'budget'
  | 'lifecycle';

const WIDGET_DIAGNOSTIC_COORDINATE_MAXIMUM = 10_000_000;

function safeCoordinate(value: unknown): number | undefined {
  return Number.isSafeInteger(value)
    && Number(value) >= 1
    && Number(value) <= WIDGET_DIAGNOSTIC_COORDINATE_MAXIMUM
    ? Number(value)
    : undefined;
}

function record(error: unknown): Readonly<Record<string, unknown>> | null {
  return typeof error === 'object' && error !== null
    ? error as Readonly<Record<string, unknown>>
    : null;
}

function originFromCategory(value: unknown): TDiagnosticOrigin | null {
  switch (value) {
    case 'budget':
    case 'capability':
    case 'channel':
    case 'guest':
    case 'lifecycle':
    case 'host':
      return value;
    case 'artifact':
    case 'build':
    case 'internal':
    case 'target':
      return 'host';
    default:
      return null;
  }
}

function originFromCode(value: string): TDiagnosticOrigin {
  if (/(?:BUDGET|QUOTA|LIMIT|OVERFLOW|DEADLINE)/.test(value)) return 'budget';
  if (/(?:CAPABILITY|PROVIDER|GRANT)/.test(value)) return 'capability';
  if (/(?:CHANNEL|BRIDGE_DELIVERY)/.test(value)) return 'channel';
  if (/(?:GUEST|VM_)/.test(value)) return 'guest';
  if (/(?:LIFECYCLE|DESTROY|PARK|VIEWPORT|CATALOG_INVALIDATED)/.test(value)) {
    return 'lifecycle';
  }
  return 'host';
}

function fallbackCode(phase: TPreviewDiagnosticPhase): string {
  switch (phase) {
    case 'verifying':
      return 'WIDGET_PREVIEW_VERIFY_FAILED';
    case 'mounting':
      return 'WIDGET_PREVIEW_MOUNT_FAILED';
    case 'starting':
      return 'WIDGET_PREVIEW_START_FAILED';
    case 'runtime':
      return 'WIDGET_PREVIEW_RUNTIME_FAILED';
  }
}

function safeDiagnosticId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,299}$/.test(normalized)
    ? normalized
    : undefined;
}

function safeCode(error: Readonly<Record<string, unknown>> | null, phase: TPreviewDiagnosticPhase): string {
  const candidate = error?.capsuleCode ?? error?.code;
  if (typeof candidate !== 'string') return fallbackCode(phase);
  const normalized = candidate.trim().toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
  return /^[A-Z][A-Z0-9_]{1,127}$/.test(normalized)
    ? normalized
    : fallbackCode(phase);
}

function safeMessage(code: string, origin: TDiagnosticOrigin): string {
  if (code === 'PERFORMANCE_API_UNAVAILABLE') {
    return 'Capsule widgets do not expose the ambient performance API. '
      + 'Use the monotonic timestamp passed to requestAnimationFrame callbacks '
      + 'for animation timing.';
  }
  if (code === 'MESSAGE_BUDGET_EXCEEDED') {
    return 'The widget exceeded its Capsule message budget. Reduce or split '
      + 'the guest-host payload, or request a measured ui.budgets.messageBytes '
      + 'value within the host ceiling.';
  }
  if (code === 'WEBGL_CONTEXT_UNAVAILABLE') {
    return 'WebGL Preview requires browser WebGL2 support and the public '
      + 'WEBGL API group. Add WEBGL to ui.apis.';
  }
  if (code === 'CANVAS_PROFILE_REQUIRED') {
    return 'Canvas rendering requires the matching public Capsule API group: '
      + 'CANVAS_2D, WEBGL, or WEBGPU.';
  }
  switch (origin) {
    case 'budget':
      return 'The Widget Preview exceeded a browser sandbox resource budget.';
    case 'capability':
      return 'A Widget Preview browser capability was denied or failed.';
    case 'channel':
      return 'A Widget Preview browser data channel was rejected.';
    case 'guest':
      return 'The Widget Preview guest runtime failed.';
    case 'lifecycle':
      return 'The Widget Preview browser lifecycle operation failed.';
    case 'host':
      return 'The Widget Preview browser sandbox host failed safely.';
  }
}

/**
 * Reduces an untrusted browser-runtime failure to the bounded diagnostic
 * contract without forwarding guest-controlled message text.
 */
export async function fnNormalizePreviewDiagnostic(
  args: TArgs,
): Promise<TWidgetDiagnostic> {
  const error = record(args.error);
  const code = safeCode(error, args.phase);
  const origin = originFromCategory(error?.category) ?? originFromCode(code);
  const buildId = args.previewRevisionId;
  const capability = safeDiagnosticId(error?.capability ?? error?.capabilityId);
  const operation = safeDiagnosticId(error?.operation);
  const file = (
    typeof error?.file === 'string'
    && /^widget:\/\/[A-Za-z0-9@_+.,=/~-]{1,500}$/.test(error.file)
  ) ? error.file : undefined;
  const line = safeCoordinate(error?.line);
  const column = line === undefined ? undefined : safeCoordinate(error?.column);
  const fingerprintSource = fnCanonicalizeWidgetDiagnosticFingerprint({
    origin,
    phase: args.phase,
    code,
    buildId,
    previewRevisionId: args.previewRevisionId,
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    ...(capability === undefined ? {} : { capability }),
    ...(operation === undefined ? {} : { operation }),
  });
  const fingerprint = await args.digestSha256(
    args.encodeFingerprint(fingerprintSource),
  );
  return {
    formatVersion: 1,
    fingerprint,
    origin,
    phase: args.phase,
    code,
    severity: 'error',
    message: safeMessage(code, origin),
    trust: 'untrusted',
    draftRevision: args.draftRevision,
    previewRevisionId: args.previewRevisionId,
    buildId,
    buildSequence: args.buildSequence,
    occurrenceCount: 1,
    retryability: 'unknown',
    timestampMs: args.timestampMs,
    ...(capability === undefined ? {} : { capability }),
    ...(operation === undefined ? {} : { operation }),
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  };
}
