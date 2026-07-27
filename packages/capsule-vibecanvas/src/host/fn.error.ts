import type {
  CapsuleHostErrorCode,
  CapsuleMountErrorCategory,
  CapsuleMountErrorCode,
  CapsuleMountErrorEvent,
} from '@omnidraw/capsule';
import type {
  TVibecanvasCapsuleError,
  TVibecanvasCapsuleErrorCategory,
} from '../contract/types';

function categoryForHostCode(
  code: CapsuleHostErrorCode,
): TVibecanvasCapsuleErrorCategory {
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
): TVibecanvasCapsuleErrorCategory {
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

function messageForCategory(category: TVibecanvasCapsuleErrorCategory): string {
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
): TVibecanvasCapsuleError {
  const category = categoryForHostCode(code);
  return Object.freeze({
    format: 'vibecanvas.capsule-error.v1',
    phase: 'host',
    category,
    capsuleCode: code,
    fatal: true,
    message: messageForCategory(category),
  });
}

/** Maps a normalized live-mount event without forwarding guest/provider labels. */
export function fnMapCapsuleMountError(
  event: Pick<CapsuleMountErrorEvent, 'category' | 'code' | 'fatal'>,
): TVibecanvasCapsuleError {
  const category = categoryForMountEvent(event);
  return Object.freeze({
    format: 'vibecanvas.capsule-error.v1',
    phase: 'runtime',
    category,
    capsuleCode: event.code,
    fatal: event.fatal,
    message: messageForCategory(category),
  });
}
