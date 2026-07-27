import type { CapsuleBuildErrorCode } from '@omnidraw/capsule/build';
import type {
  TVibecanvasCapsuleError,
  TVibecanvasCapsuleErrorCategory,
} from '../contract/types';

function categoryForBuildCode(
  code: CapsuleBuildErrorCode,
): TVibecanvasCapsuleErrorCategory {
  switch (code) {
    case 'BUILD_LIMIT_EXCEEDED':
      return 'budget';
    case 'UNSUPPORTED_LANGUAGE':
    case 'UNSUPPORTED_TARGET':
      return 'target';
    case 'BUILD_INPUT_INVALID':
    case 'CSS_POLICY_DENIED':
    case 'CSS_PROFILE_REQUIRED':
    case 'DEPENDENCY_CONTENT_UNREFERENCED':
    case 'MODULE_AMBIGUOUS':
    case 'MODULE_NOT_FOUND':
    case 'PATH_INVALID':
    case 'TRANSFORM_FAILED':
    case 'UNSUPPORTED_RUNTIME_IMPORT':
    case 'UNSUPPORTED_SYNTAX':
      return 'build';
  }
}

function messageForBuildCategory(
  category: TVibecanvasCapsuleErrorCategory,
): string {
  switch (category) {
    case 'artifact':
      return 'The widget UI artifact failed integrity verification.';
    case 'budget':
      return 'The widget UI build exceeded a configured resource limit.';
    case 'target':
      return 'The widget UI target is not supported.';
    default:
      return 'The widget UI build failed.';
  }
}

/** Maps a stable Capsule build code without exposing source text or stack data. */
export function fnMapCapsuleBuildError(
  code: CapsuleBuildErrorCode,
): TVibecanvasCapsuleError {
  const category = categoryForBuildCode(code);
  return Object.freeze({
    format: 'vibecanvas.capsule-error.v1',
    phase: 'build',
    category,
    capsuleCode: code,
    fatal: true,
    message: messageForBuildCategory(category),
  });
}
