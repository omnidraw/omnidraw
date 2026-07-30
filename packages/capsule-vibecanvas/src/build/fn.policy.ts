import type {
  CapsuleApiGroup,
  CapsuleApiGroupBuildPolicy,
  CapsuleBudgetRequest,
} from '@omnidraw/capsule/protocol';
import type {
  TWidgetCapsuleApiGroup,
  TWidgetCapsuleBudgetRequest,
} from '@vibecanvas/widget-contract';
import { fnMapCapsuleApis } from '../contract/fn.apis';
import { fnMapCapsuleBudgetRequest } from '../contract/fn.budgets';
import {
  VIBECANVAS_CAPSULE_BUILD_POLICY,
  VIBECANVAS_CAPSULE_LIMITS,
} from './CONSTANTS';

export function fnVibecanvasCapsuleApis(
  apis: readonly TWidgetCapsuleApiGroup[],
): readonly CapsuleApiGroup[] {
  return fnMapCapsuleApis(apis);
}

export function fnVibecanvasCapsuleBudgetRequest(
  request: TWidgetCapsuleBudgetRequest,
): CapsuleBudgetRequest {
  const result = fnMapCapsuleBudgetRequest(request);
  for (const [key, value] of Object.entries(result)) {
    const ceiling = key === 'gpuBytes'
      ? VIBECANVAS_CAPSULE_LIMITS.gpuBytes
      : undefined;
    if (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || value < 0
      || (key !== 'cpuMs' && !Number.isSafeInteger(value))
      || (ceiling !== undefined && value > ceiling)
    ) {
      throw new TypeError(`Capsule budget '${key}' exceeds Vibecanvas policy.`);
    }
  }
  return result;
}

export function fnVibecanvasCapsuleBuildPolicy(): CapsuleApiGroupBuildPolicy {
  return VIBECANVAS_CAPSULE_BUILD_POLICY;
}
