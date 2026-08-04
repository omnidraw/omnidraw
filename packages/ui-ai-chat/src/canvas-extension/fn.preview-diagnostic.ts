import type { TWidgetDiagnostic } from '@omnidraw/widget-contract';
import {
  fnCanonicalizeWidgetDiagnosticFingerprint,
} from '@omnidraw/widget-contract/fn.diagnostic';

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

type TDiagnosticRemediation = NonNullable<TWidgetDiagnostic['remediation']>;

const SERVER_FUNCTION_CAPABILITY_PREFIX = 'omnidraw.widget.functions.';

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

const SERVER_FUNCTION_BRIDGE_CODES = new Set([
  'CAPABILITY_NOT_FOUND',
  'CAPABILITY_DENIED',
  'CAPABILITY_IDENTITY_MISMATCH',
  'DESCRIPTOR_INVALID',
  'OPERATION_NOT_FOUND',
]);

const UNSUPPORTED_OPERATION_CODES = new Set([
  'OPERATION_NOT_FOUND',
  'OPERATION_KIND_MISMATCH',
  'HANDLE_OPERATION_DENIED',
]);

const CHANNEL_REJECTION_CODES = new Set([
  'CHANNEL_REJECTED',
  'BRIDGE_DELIVERY_FAILED',
]);

const CAPABILITY_DENIAL_CODES = new Set([
  'CAPABILITY_REJECTED',
  'CAPABILITY_DENIED',
  'CAPABILITY_IDENTITY_MISMATCH',
]);

const RETRYABLE_CODES = new Set([
  'RATE_LIMIT',
  'CONCURRENCY_LIMIT',
  'DEADLINE_EXCEEDED',
  'CHANNEL_QUOTA',
  'CALL_ABORTED',
  'LIFECYCLE_CHANGED',
  'INSTANCE_NOT_RUNNABLE',
]);

const NON_RETRYABLE_CODES = new Set([
  'CAPABILITY_NOT_FOUND',
  'CAPABILITY_DENIED',
  'CAPABILITY_REJECTED',
  'CAPABILITY_IDENTITY_MISMATCH',
  'DESCRIPTOR_INVALID',
  'OPERATION_NOT_FOUND',
  'OPERATION_KIND_MISMATCH',
  'HANDLE_OPERATION_DENIED',
  'INPUT_INVALID',
  'OUTPUT_INVALID',
  'ARTIFACT_REJECTED',
  'PLATFORM_UNSUPPORTED',
  'PAYLOAD_LIMIT',
  'MESSAGE_BUDGET_EXCEEDED',
  'WEBGL_CONTEXT_UNAVAILABLE',
  'CANVAS_PROFILE_REQUIRED',
  'PERFORMANCE_API_UNAVAILABLE',
]);

function isServerFunctionBridge(
  code: string,
  capability: string | undefined,
): boolean {
  return capability !== undefined
    && capability.startsWith(SERVER_FUNCTION_CAPABILITY_PREFIX)
    && SERVER_FUNCTION_BRIDGE_CODES.has(code);
}

function safeMessage(
  code: string,
  origin: TDiagnosticOrigin,
  capability: string | undefined,
): string {
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
  if (isServerFunctionBridge(code, capability)) {
    return 'The generated server-function binding was rejected by the Capsule '
      + 'bridge while initializing or calling the named operation. This is a '
      + 'generated binding/platform failure; widget source edits are unlikely '
      + 'to help.';
  }
  if (CHANNEL_REJECTION_CODES.has(code)) {
    return 'The Widget Preview browser data channel was rejected before the '
      + 'guest could use it. Reload the Preview; if the rejection persists, '
      + 'the sandbox host is at fault rather than the widget source.';
  }
  if (CAPABILITY_DENIAL_CODES.has(code)) {
    return 'The Widget Preview capability named by this diagnostic was denied '
      + 'by the browser sandbox. Verify the widget manifest requests only '
      + 'declared public capabilities.';
  }
  if (UNSUPPORTED_OPERATION_CODES.has(code)) {
    return 'The guest attempted an operation the granted Capsule capability '
      + 'does not support. Regenerate the widget so requested operations match '
      + 'the capability descriptor.';
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

function safeRetryability(
  code: string,
): TWidgetDiagnostic['retryability'] {
  if (RETRYABLE_CODES.has(code)) return 'retryable';
  if (NON_RETRYABLE_CODES.has(code)) return 'non-retryable';
  return 'unknown';
}

function safeRemediation(
  code: string,
  origin: TDiagnosticOrigin,
  capability: string | undefined,
  file: string | undefined,
): TDiagnosticRemediation | undefined {
  if (isServerFunctionBridge(code, capability)) return 'generated-binding';
  if (origin === 'budget' || code === 'MESSAGE_BUDGET_EXCEEDED') return 'budget';
  if (origin === 'guest' && file !== undefined) return 'widget-source';
  if (
    CHANNEL_REJECTION_CODES.has(code)
    || CAPABILITY_DENIAL_CODES.has(code)
    || code === 'PLATFORM_UNSUPPORTED'
    || code === 'WEBGL_CONTEXT_UNAVAILABLE'
    || code === 'PERFORMANCE_API_UNAVAILABLE'
  ) return 'platform';
  return undefined;
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
  const remediation = safeRemediation(code, origin, capability, file);
  return {
    formatVersion: 1,
    fingerprint,
    origin,
    phase: args.phase,
    code,
    severity: 'error',
    message: safeMessage(code, origin, capability),
    trust: 'untrusted',
    draftRevision: args.draftRevision,
    previewRevisionId: args.previewRevisionId,
    buildId,
    buildSequence: args.buildSequence,
    occurrenceCount: 1,
    retryability: safeRetryability(code),
    timestampMs: args.timestampMs,
    ...(capability === undefined ? {} : { capability }),
    ...(operation === undefined ? {} : { operation }),
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    ...(remediation === undefined ? {} : { remediation }),
  };
}
