/**
 * @file Pure per-function resource ceiling enforcement.
 */

import type { TResourceCall, TResourceEffect } from '@omnidraw/resource-runtime';

export type TFunctionResourceAccess = Readonly<{
  slot: string;
  effect: TResourceEffect;
}>;

export type TFunctionResourceCallDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{
      allowed: false;
      reason:
        | 'guest_authority'
        | 'fn_resource_call'
        | 'slot_not_declared'
        | 'fx_write'
        | 'effect_exceeded';
    }>;

type TArgs = Readonly<{
  functionEffect: 'fn' | 'fx' | 'tx';
  resources: readonly TFunctionResourceAccess[];
  call: TResourceCall;
}>;

function accessAllows(access: TResourceEffect, requested: 'read' | 'write'): boolean {
  return access === requested || access === 'read_write';
}

/** Manifest requirements and bindings are checked again by the underlying gateway. */
export function fnFunctionResourceCallDecision(args: TArgs): TFunctionResourceCallDecision {
  if (args.call.operationId !== undefined || (
    args.call.effect === 'write' && args.call.writeCapability !== undefined
  )) {
    return { allowed: false, reason: 'guest_authority' };
  }
  if (args.functionEffect === 'fn') return { allowed: false, reason: 'fn_resource_call' };
  const access = args.resources.find((candidate) => candidate.slot === args.call.slot);
  if (access === undefined) return { allowed: false, reason: 'slot_not_declared' };
  if (args.functionEffect === 'fx' && args.call.effect === 'write') {
    return { allowed: false, reason: 'fx_write' };
  }
  return accessAllows(access.effect, args.call.effect)
    ? { allowed: true }
    : { allowed: false, reason: 'effect_exceeded' };
}
