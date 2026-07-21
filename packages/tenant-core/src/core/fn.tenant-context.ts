/**
 * @file Evaluates immutable tenant context capabilities and placement fences.
 */

import type { TTenantCapability, TTenantContext, TTenantPlacement } from '../types';

export function fnFreezeTenantContext(context: TTenantContext): TTenantContext {
  return Object.freeze({
    ...context,
    roles: Object.freeze([...context.roles]),
    capabilities: Object.freeze([...context.capabilities]),
  });
}

export function fnTenantContextHasCapability(
  context: TTenantContext,
  capability: TTenantCapability,
): boolean {
  return context.capabilities.includes(capability);
}

export function fnTenantContextMatchesPlacement(
  context: TTenantContext,
  placement: TTenantPlacement,
): boolean {
  return context.orgId === placement.orgId
    && context.cellId === placement.cellId
    && context.placementEpoch === placement.epoch;
}
