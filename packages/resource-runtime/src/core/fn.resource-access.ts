/**
 * @file Evaluates logical resource requirements and bindings without provider state.
 */

import type {
  TResourceBinding,
  TResourceBindingDecision,
  TResourceEffect,
  TResourceRequirement,
} from '../types';
import type { TTenantContext } from '@vibecanvas/tenant-core';

type TRequestedEffect = Exclude<TResourceEffect, 'read_write'>;

const HUMAN_RESOURCE_ROLES = new Set(['owner', 'admin', 'member']);
const SECRET_REVEAL_CAPABILITY = 'resource:secret:reveal';

export function fnResourceSecretRevealAllowed(context: TTenantContext): boolean {
  if (context.roles.includes('service')) return false;
  const human = context.roles.some((role) => HUMAN_RESOURCE_ROLES.has(role));
  const allowed = context.capabilities.includes('*')
    || context.capabilities.includes(SECRET_REVEAL_CAPABILITY);
  return human && allowed;
}

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
  return fnResourceBindingDecision(requirement, binding, requested).allowed;
}

export function fnResourceBindingDecision(
  requirement: TResourceRequirement,
  binding: TResourceBinding,
  requested: TRequestedEffect,
): TResourceBindingDecision {
  if (requirement.slot !== binding.slot) return { allowed: false, reason: 'slot_mismatch' };
  if (requirement.kind !== binding.kind) return { allowed: false, reason: 'kind_mismatch' };
  if (!fnResourceEffectAllows(requirement.effect, requested)) {
    return { allowed: false, reason: 'requirement_denied' };
  }
  if (requested === 'read' ? !binding.allowRead : !binding.allowWrite) {
    return { allowed: false, reason: 'binding_denied' };
  }
  return { allowed: true };
}
