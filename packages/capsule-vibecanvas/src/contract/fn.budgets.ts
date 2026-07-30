import type {
  CapsuleBudgetRequest,
} from '@omnidraw/capsule/protocol';
import type {
  TVibecanvasCapsuleBudgetRequest,
} from './types';
import { VIBECANVAS_CAPSULE_BUDGET_DIMENSIONS } from './CONSTANTS';

/**
 * Copies only Capsule's public budget dimensions and preserves explicit zeroes.
 */
export function fnMapCapsuleBudgetRequest(
  budgets: TVibecanvasCapsuleBudgetRequest,
): CapsuleBudgetRequest {
  const mapped: Record<string, number> = {};
  for (const dimension of VIBECANVAS_CAPSULE_BUDGET_DIMENSIONS) {
    const value = budgets[dimension];
    if (value !== undefined) mapped[dimension] = value;
  }
  return Object.freeze(mapped);
}
