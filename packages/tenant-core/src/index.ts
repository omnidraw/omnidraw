/**
 * @file Public tenant context contract surface.
 */

export type {
  IIdentityProvider,
  IPlacementDirectory,
  ITenantContextProvider,
} from './interface';
export type {
  TAccountId,
  TCanvasId,
  TCellId,
  TIdentityRequest,
  TInvocationId,
  TOrganizationId,
  TPlacementEpoch,
  TRequestId,
  TTenantCapability,
  TTenantContext,
  TTenantContextRequest,
  TTenantIdentity,
  TTenantPlacement,
  TTenantRole,
} from './types';
export { fnScopedKey } from './core/fn.scoped-key';
export {
  fnFreezeTenantContext,
  fnTenantContextHasCapability,
  fnTenantContextMatchesPlacement,
} from './core/fn.tenant-context';
