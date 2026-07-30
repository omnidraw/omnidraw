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
import {
  VIBECANVAS_CAPSULE_BUILD_POLICY,
  VIBECANVAS_CAPSULE_LIMITS,
} from './CONSTANTS';

const BUDGET_KEYS = [
  'cpuMs',
  'memoryBytes',
  'domNodes',
  'handles',
  'messageBytes',
  'streamBytes',
  'assetBytes',
  'networkBytes',
  'gpuBytes',
  'lifecycleBytes',
] as const;

export function fnVibecanvasCapsuleApis(
  apis: readonly TWidgetCapsuleApiGroup[],
): readonly CapsuleApiGroup[] {
  return fnMapCapsuleApis(apis);
}

export function fnVibecanvasCapsuleBudgetRequest(
  request: TWidgetCapsuleBudgetRequest,
): CapsuleBudgetRequest {
  const result: Record<string, number> = {};
  for (const key of BUDGET_KEYS) {
    const value = request[key];
    if (value === undefined) continue;
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
    result[key] = value;
  }
  return Object.freeze(result);
}

export function fnVibecanvasCapsuleBuildPolicy(): CapsuleApiGroupBuildPolicy {
  return VIBECANVAS_CAPSULE_BUILD_POLICY;
}
