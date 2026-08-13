import type {
  CapsuleBudgetRequest,
} from '@omnidraw/capsule/protocol';
import type {
  TOmnidrawCapsuleBudgetRequest,
} from './types';
import { OMNIDRAW_CAPSULE_BUDGET_DIMENSIONS } from './CONSTANTS';

/**
 * Copies only Capsule's public budget dimensions and preserves explicit zeroes.
 */
export function fnMapCapsuleBudgetRequest(
  budgets: TOmnidrawCapsuleBudgetRequest,
): CapsuleBudgetRequest {
  const mapped: Record<string, number> = {};
  for (const dimension of OMNIDRAW_CAPSULE_BUDGET_DIMENSIONS) {
    const value = budgets[dimension];
    if (value !== undefined) mapped[dimension] = value;
  }
  return Object.freeze(mapped);
}
