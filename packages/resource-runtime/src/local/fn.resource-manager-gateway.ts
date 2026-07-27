/**
 * @file Pure conversion from the legacy-neutral manager model to public gateway contracts.
 */

import type {
  TResourceBinding,
  TResourceEffect,
  TResourceId,
  TResourceKind,
  TResourcePermission,
  TResourceRequirement,
} from '../types';
import type {
  TManagedResourceRequirement,
  TResourceBindingRecord,
  TResourceScope,
} from './ResourceManager';

export type TResourceExactGatewayAuthorization = Readonly<{
  slot: string;
  requirement: TResourceRequirement;
  binding: TResourceBinding;
}>;

export function fnResourceExactGatewayAuthorization(args: Readonly<{
  resourceId: TResourceId;
  kind: TResourceKind;
  effect: TResourcePermission;
}>): TResourceExactGatewayAuthorization {
  const slot = `resource:${args.kind}:${args.resourceId}`;
  return {
    slot,
    requirement: {
      slot,
      kind: args.kind,
      effect: args.effect,
      required: true,
    },
    binding: {
      slot,
      resourceId: args.resourceId,
      kind: args.kind,
      allowRead: args.effect === 'read',
      allowWrite: args.effect === 'write',
      required: true,
    },
  };
}

export function fnResourceEffectFromScope(scope: TResourceScope): TResourceEffect {
  const read = scope.includes('read');
  const write = scope.includes('write');
  return read && write ? 'read_write' : read ? 'read' : 'write';
}

export function fnResourceRequirementFromManaged(
  slot: string,
  requirement: TManagedResourceRequirement,
): TResourceRequirement {
  return {
    slot,
    kind: requirement.kind,
    effect: fnResourceEffectFromScope(requirement.scope),
    required: requirement.required,
    ...(requirement.arbitrarySql === undefined
      ? {}
      : { arbitrarySql: requirement.arbitrarySql }),
    ...(requirement.operations === undefined
      ? {}
      : { operations: requirement.operations }),
  };
}

export function fnResourceBindingFromManaged(
  requirement: TResourceRequirement,
  binding: TResourceBindingRecord,
): TResourceBinding {
  return {
    slot: binding.slot_name,
    resourceId: binding.resource_id,
    kind: requirement.kind,
    allowRead: binding.allow_read,
    allowWrite: binding.allow_write,
    definitionId: binding.definition_name,
  };
}
