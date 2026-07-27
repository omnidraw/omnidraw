/**
 * @file Narrow capabilities for deriving tenant context and resolving placement.
 */

import type {
  TIdentityRequest,
  TOrganizationId,
  TTenantContext,
  TTenantContextRequest,
  TTenantIdentity,
  TTenantPlacement,
} from './types';

export interface IIdentityProvider {
  resolveIdentity(request: TIdentityRequest): Promise<TTenantIdentity>;
}

export interface ITenantContextProvider {
  resolveTenantContext(request: TTenantContextRequest): Promise<TTenantContext>;
}

export interface IPlacementDirectory {
  resolvePlacement(orgId: TOrganizationId): Promise<TTenantPlacement | null>;
}
