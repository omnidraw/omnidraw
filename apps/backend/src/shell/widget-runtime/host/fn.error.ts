import type {
  CapsuleHostErrorCode,
  CapsuleMountErrorCategory,
  CapsuleMountErrorCode,
  CapsuleMountErrorEvent,
} from '@omnidraw/capsule';
import type {
  TOmnidrawCapsuleError,
  TOmnidrawCapsuleErrorCategory,
} from '#backend/shell/widget-runtime/contract/types';

const WEBGL_CONTEXT_FAILURE_MESSAGES = Object.freeze([
  'Error creating WebGL context.',
  'Error creating WebGL context with your selected attributes.',
  'THREE.WebGLRenderer: Error creating WebGL context.',
  'THREE.WebGLRenderer: Error creating WebGL context with your selected attributes.',
  'WebGL platform or budget is unavailable.',
]);

const CANVAS_PROFILE_FAILURE_MESSAGES = Object.freeze([
  'The canvas element is not allowed',
]);

const MESSAGE_BUDGET_FAILURE_MESSAGES = Object.freeze([
  'marshal_error: VM string exceeds the configured byte limit.',
]);

const PERFORMANCE_API_FAILURE_MESSAGES = Object.freeze([
  "'performance' is not defined",
]);

type TThrownCapsuleHostError = Readonly<{
  code: CapsuleHostErrorCode;
  message?: unknown;
  cause?: unknown;
}>;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function hasKnownFailure(
  error: unknown,
  messages: readonly string[],
  depth = 0,
): boolean {
  if (depth > 4) return false;
  const value = record(error);
  if (value === null) return false;
  const candidates = [value.message, value.guestMessage];
  if (candidates.some((message) => (
    typeof message === 'string'
    && messages.includes(message)
  ))) return true;
  return hasKnownFailure(value.cause, messages, depth + 1);
}

function categoryForHostCode(
  code: CapsuleHostErrorCode,
): TOmnidrawCapsuleErrorCategory {
  switch (code) {
    case 'ARTIFACT_CACHE_MISS':
    case 'ARTIFACT_REJECTED':
      return 'artifact';
    case 'CAPABILITY_REJECTED':
      return 'capability';
    case 'CHANNEL_QUOTA':
      return 'budget';
    case 'CHANNEL_REJECTED':
      return 'channel';
    case 'DESTROYED':
    case 'LIFECYCLE_REJECTED':
    case 'NOT_PARKABLE':
    case 'VIEWPORT_REJECTED':
      return 'lifecycle';
    case 'PLATFORM_UNSUPPORTED':
      return 'target';
    case 'CONTAINER_INVALID':
    case 'MOUNT_FAILED':
      return 'host';
    case 'INTERNAL_ERROR':
      return 'internal';
  }
}

function mountCodeIsBudget(code: CapsuleMountErrorCode): boolean {
  return code === 'PAYLOAD_LIMIT'
    || code === 'RATE_LIMIT'
    || code === 'CONCURRENCY_LIMIT'
    || code === 'DEADLINE_EXCEEDED'
    || code === 'STREAM_OVERFLOW'
    || code === 'HANDLE_LIMIT'
    || code === 'HANDLE_QUOTA';
}

function categoryForMountEvent(
  event: Pick<CapsuleMountErrorEvent, 'category' | 'code'>,
): TOmnidrawCapsuleErrorCategory {
  if (mountCodeIsBudget(event.code)) return 'budget';
  if (event.code === 'INTERNAL' || event.code === 'TERMINAL_CLEANUP_FAILED') {
    return 'internal';
  }
  const category: CapsuleMountErrorCategory = event.category;
  switch (category) {
    case 'capability':
      return 'capability';
    case 'dom':
    case 'host':
      return 'host';
    case 'lifecycle':
      return 'lifecycle';
    case 'vm':
      return 'guest';
  }
}

function messageForCategory(category: TOmnidrawCapsuleErrorCategory): string {
  switch (category) {
    case 'artifact':
      return 'The widget UI artifact was rejected.';
    case 'budget':
      return 'The widget exceeded a Capsule resource budget.';
    case 'capability':
      return 'A widget capability was denied or failed.';
    case 'channel':
      return 'A widget data channel was rejected.';
    case 'guest':
      return 'The widget runtime failed.';
    case 'lifecycle':
      return 'The widget lifecycle operation failed.';
    case 'target':
      return 'The widget UI target is not supported by this browser.';
    case 'internal':
      return 'The browser sandbox failed safely.';
    default:
      return 'The browser sandbox host rejected the operation.';
  }
}

/** Maps a thrown host boundary code to a bounded product-safe error. */
export function fnMapCapsuleHostError(
  code: CapsuleHostErrorCode,
): TOmnidrawCapsuleError {
  const category = categoryForHostCode(code);
  return Object.freeze({
    format: 'omnidraw.capsule-error.v1',
    phase: 'host',
    category,
    capsuleCode: code,
    fatal: true,
    message: messageForCategory(category),
  });
}

/**
 * Maps a thrown host error and only recognizes allowlisted nested guest causes.
 * Guest-controlled message and stack text never cross this boundary.
 */
export function fnMapThrownCapsuleHostError(
  error: TThrownCapsuleHostError,
): TOmnidrawCapsuleError {
  if (hasKnownFailure(error, PERFORMANCE_API_FAILURE_MESSAGES)) {
    return Object.freeze({
      format: 'omnidraw.capsule-error.v1',
      phase: 'host',
      category: 'capability',
      capsuleCode: 'PERFORMANCE_API_UNAVAILABLE',
      fatal: true,
      message: 'Capsule widgets do not expose the ambient performance API. '
        + 'Use the monotonic timestamp passed to requestAnimationFrame callbacks '
        + 'for animation timing.',
    });
  }
  if (hasKnownFailure(error, MESSAGE_BUDGET_FAILURE_MESSAGES)) {
    return Object.freeze({
      format: 'omnidraw.capsule-error.v1',
      phase: 'host',
      category: 'budget',
      capsuleCode: 'MESSAGE_BUDGET_EXCEEDED',
      fatal: true,
      message: 'The widget exceeded its Capsule message budget. Reduce or split '
        + 'the guest-host payload, or request a measured ui.budgets.messageBytes '
        + 'value within the host ceiling.',
    });
  }
  if (hasKnownFailure(error, WEBGL_CONTEXT_FAILURE_MESSAGES)) {
    return Object.freeze({
      format: 'omnidraw.capsule-error.v1',
      phase: 'host',
      category: 'capability',
      capsuleCode: 'WEBGL_CONTEXT_UNAVAILABLE',
      fatal: true,
      message: 'WebGL Preview requires browser WebGL2 support and the public '
        + 'WEBGL API group. Add WEBGL to ui.apis.',
    });
  }
  if (hasKnownFailure(error, CANVAS_PROFILE_FAILURE_MESSAGES)) {
    return Object.freeze({
      format: 'omnidraw.capsule-error.v1',
      phase: 'host',
      category: 'capability',
      capsuleCode: 'CANVAS_PROFILE_REQUIRED',
      fatal: true,
      message: 'Canvas rendering requires the matching public Capsule API '
        + 'group: CANVAS_2D, WEBGL, or WEBGPU.',
    });
  }
  return fnMapCapsuleHostError(error.code);
}

/** Maps a normalized live-mount event without forwarding guest/provider messages. */
export function fnMapCapsuleMountError(
  event: Pick<CapsuleMountErrorEvent, 'category' | 'code' | 'fatal'>
    & Readonly<{ capabilityId?: string; operation?: string }>,
): TOmnidrawCapsuleError {
  const category = categoryForMountEvent(event);
  return Object.freeze({
    format: 'omnidraw.capsule-error.v1',
    phase: 'runtime',
    category,
    capsuleCode: event.code,
    fatal: event.fatal,
    message: messageForCategory(category),
    ...(event.capabilityId === undefined ? {} : { capability: event.capabilityId }),
    ...(event.operation === undefined ? {} : { operation: event.operation }),
  });
}
