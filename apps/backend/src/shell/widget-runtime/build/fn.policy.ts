import type {
  CapsuleApiGroup,
  CapsuleApiGroupBuildPolicy,
  CapsuleBudgetRequest,
} from '@omnidraw/capsule/protocol';
import type {
  TWidgetRuntimeApiGroup,
  TWidgetRuntimeBudgetRequest,
} from '@omnidraw/sdk/contract';
import { fnMapCapsuleApis } from '#backend/shell/widget-runtime/contract/fn.apis';
import { fnMapCapsuleBudgetRequest } from '#backend/shell/widget-runtime/contract/fn.budgets';
import {
  OMNIDRAW_CAPSULE_BUILD_POLICY,
  OMNIDRAW_CAPSULE_LIMITS,
} from './CONSTANTS';

export function fnOmnidrawCapsuleApis(
  apis: readonly TWidgetRuntimeApiGroup[],
): readonly CapsuleApiGroup[] {
  return fnMapCapsuleApis(apis);
}

export function fnOmnidrawCapsuleBudgetRequest(
  request: TWidgetRuntimeBudgetRequest,
): CapsuleBudgetRequest {
  const result = fnMapCapsuleBudgetRequest(request);
  for (const [key, value] of Object.entries(result)) {
    const ceiling = key === 'gpuBytes'
      ? OMNIDRAW_CAPSULE_LIMITS.gpuBytes
      : undefined;
    if (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || value < 0
      || (key !== 'cpuMs' && !Number.isSafeInteger(value))
      || (ceiling !== undefined && value > ceiling)
    ) {
      throw new TypeError(`Capsule budget '${key}' exceeds Omnidraw policy.`);
    }
  }
  return result;
}

export function fnOmnidrawCapsuleBuildPolicy(): CapsuleApiGroupBuildPolicy {
  return OMNIDRAW_CAPSULE_BUILD_POLICY;
}
