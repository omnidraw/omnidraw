import type {
  CapsuleApiGroup,
  CapsuleApiGroupBuildPolicy,
  CapsuleBudgetRequest,
} from '@omnidraw/capsule/protocol';
import type {
  TWidgetCapsuleApiGroup,
  TWidgetCapsuleBudgetRequest,
} from '@omnidraw/widget-contract';
import { fnMapCapsuleApis } from '../contract/fn.apis';
import { fnMapCapsuleBudgetRequest } from '../contract/fn.budgets';
import {
  OMNIDRAW_CAPSULE_BUILD_POLICY,
  OMNIDRAW_CAPSULE_LIMITS,
} from './CONSTANTS';

export function fnOmnidrawCapsuleApis(
  apis: readonly TWidgetCapsuleApiGroup[],
): readonly CapsuleApiGroup[] {
  return fnMapCapsuleApis(apis);
}

export function fnOmnidrawCapsuleBudgetRequest(
  request: TWidgetCapsuleBudgetRequest,
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
