/**
 * @file Public resource gateway, provider, binding, and active-use capabilities.
 */

import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  TResolvedResourceCall,
  TResourceBinding,
  TResourceCall,
  TResourceCallResult,
  TResourceDrainLease,
  TResourceId,
  TResourceKind,
  TResourceWriteCapabilityClaims,
} from './types';

export interface IResourceGateway {
  call(
    tenant: TTenantContext,
    call: TResourceCall,
  ): Promise<TResourceCallResult>;
}

export interface IResourceBindingResolver {
  resolveBinding(
    tenant: TTenantContext,
    slot: string,
  ): Promise<TResourceBinding | null>;
}

export interface IResourceProvider {
  readonly kind: TResourceKind;
  call(call: TResolvedResourceCall): Promise<TResourceCallResult>;
}

export interface IResourceWriteCapabilityVerifier {
  verifyWriteCapability(
    tenant: TTenantContext,
    capability: string,
  ): Promise<TResourceWriteCapabilityClaims | null>;
}

export interface IResourceUseCoordinator {
  drain(tenant: TTenantContext, resourceId: TResourceId): Promise<TResourceDrainLease>;
  release(tenant: TTenantContext, lease: TResourceDrainLease): Promise<void>;
}
