/**
 * @file Evaluates logical resource requirements and bindings without provider state.
 */

import type {
  TResourceBinding,
  TResourceEffect,
  TResourceRequirement,
} from '../types';

type TRequestedEffect = Exclude<TResourceEffect, 'read_write'>;

export function fnResourceEffectAllows(
  declared: TResourceEffect,
  requested: TRequestedEffect,
): boolean {
  return declared === 'read_write' || declared === requested;
}

export function fnResourceBindingAllows(
  requirement: TResourceRequirement,
  binding: TResourceBinding,
  requested: TRequestedEffect,
): boolean {
  if (requirement.slot !== binding.slot || requirement.kind !== binding.kind) return false;
  if (!fnResourceEffectAllows(requirement.effect, requested)) return false;
  return requested === 'read' ? binding.allowRead : binding.allowWrite;
}
