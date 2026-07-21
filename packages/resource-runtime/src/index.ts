/**
 * @file Public logical resource runtime contract surface.
 */

export type {
  IResourceBindingResolver,
  IResourceGateway,
  IResourceProvider,
  IResourceUseCoordinator,
  IResourceWriteCapabilityVerifier,
} from './interface';
export type {
  TResolvedResourceCall,
  TResourceBinding,
  TResourceCall,
  TResourceCallResult,
  TResourceDrainLease,
  TResourceEffect,
  TResourceId,
  TResourceKind,
  TResourceOperationName,
  TResourceRequirement,
  TResourceSlot,
  TResourceWriteCapabilityClaims,
} from './types';
export {
  fnResourceBindingAllows,
  fnResourceEffectAllows,
} from './core/fn.resource-access';
export { fnResourceWriteCapabilityMatches } from './core/fn.write-capability';
