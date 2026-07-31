/**
 * @file Public resource gateway, Resource Store, provider, management, and control-store SPIs.
 */

import type { TTenantContext } from '@omnidraw/tenant-core';
import type {
  TCreateResourceRequest,
  TDbResourceApplyRun,
  TDbResourceBackup,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TDbResourceDraftStatus,
  TResolvedResourceCall,
  TReserveResourcePlacementRequest,
  TResourceBinding,
  TResourceBindingReference,
  TResourceCall,
  TResourceCallResult,
  TResourceDataDeleteRequest,
  TResourceDataListRequest,
  TResourceDataMutationResult,
  TResourceDataPage,
  TResourceDataSetRequest,
  TResourceDescriptor,
  TResourceDrainLease,
  TResourceDrainRequest,
  TResourceDrainResult,
  TResourceId,
  TResourceKind,
  TResourceListFilter,
  TResourcePlacement,
  TResourceProviderCreateArgs,
  TResourceReconciliation,
  TResourceReleaseMode,
  TResourceReleaseResult,
  TResourceRequirement,
  TResourceSlot,
  TResourceUseInspection,
  TResourceWriteCapabilityClaims,
  TCommittedResourceWrite,
  TResourceWritePermitRecoveryCandidate,
  TResourceWritePermitRecoveryResult,
  TResourceWritePermitScope,
  TSafeResourceError,
  TSecretReveal,
  TUpdateResourcePlacementRequest,
  TUpdateResourceStateRequest,
} from './types';

/** Location-transparent logical capability used by widgets and functions. */
export interface IResourceGateway {
  call(
    tenant: TTenantContext,
    call: TResourceCall,
  ): Promise<TResourceCallResult>;
}

/** The authoritative execution boundary for resolved calls. */
export interface IResourceStore {
  call(
    tenant: TTenantContext,
    call: TResolvedResourceCall,
  ): Promise<TResourceCallResult>;
  reconcile(tenant: TTenantContext): Promise<void>;
  close(): Promise<void>;
}

export interface IResourceBindingResolver {
  resolveBinding(
    tenant: TTenantContext,
    slot: TResourceSlot,
  ): Promise<TResourceBinding | null>;
}

export interface IResourceRequirementResolver {
  resolveRequirement(
    tenant: TTenantContext,
    slot: TResourceSlot,
  ): Promise<TResourceRequirement | null>;
}

export interface IResourceProvider {
  readonly kind: TResourceKind;
  readonly reconcileReady?: boolean;
  provision(
    tenant: TTenantContext,
    resource: TResourceDescriptor,
    args: TResourceProviderCreateArgs,
  ): Promise<void>;
  delete(tenant: TTenantContext, resource: TResourceDescriptor): Promise<void>;
  call(
    tenant: TTenantContext,
    call: TResolvedResourceCall,
  ): Promise<TResourceCallResult>;
  reconcile?(
    tenant: TTenantContext,
    resource: TResourceDescriptor,
  ): Promise<TResourceReconciliation>;
  close?(): Promise<void>;
}

export interface IResourceWriteCapabilityVerifier {
  verifyWriteCapability(
    tenant: TTenantContext,
    capability: string,
  ): Promise<TResourceWriteCapabilityClaims | null>;
}

/** Revalidates the exact permit and live lease at the provider commit edge. */
export interface IResourceWritePermitGuard {
  assertCanCommit(): Promise<void>;
}

/**
 * Holds the authoritative attempt/lease permit across the provider callback.
 * Implementations must not allow lease reassignment until the callback settles.
 */
export interface IResourceWritePermitCoordinator {
  runWithWritePermit<T>(
    tenant: TTenantContext,
    scope: TResourceWritePermitScope,
    operation: (guard: IResourceWritePermitGuard) => Promise<T>,
  ): Promise<T>;
  /** Lists unresolved intents without trusting a provider-selected permit ID. */
  listRecoverableWritePermits?(
    tenant: TTenantContext,
    request: Readonly<{
      resourceId: TResourceId;
      afterPermitId?: string;
      limit: number;
    }>,
  ): Promise<readonly TResourceWritePermitRecoveryCandidate[]>;
  /** CAS-consumes a permit from a provider-owned durable commit proof. */
  reconcileCommittedWritePermit?(
    tenant: TTenantContext,
    write: TCommittedResourceWrite,
  ): Promise<TResourceWritePermitRecoveryResult>;
}

/** Neutral coordination for clients that currently hold a resource in active use. */
export interface IResourceUseCoordinator {
  inspect(
    tenant: TTenantContext,
    resourceId: TResourceId,
  ): Promise<TResourceUseInspection>;
  drain(
    tenant: TTenantContext,
    request: TResourceDrainRequest,
  ): Promise<TResourceDrainResult>;
  release(
    tenant: TTenantContext,
    lease: TResourceDrainLease,
    mode: TResourceReleaseMode,
  ): Promise<TResourceReleaseResult>;
}

/** Resource catalog and binding management; data access remains behind the store/gateway. */
export interface IResourceManagementService {
  listResources(
    tenant: TTenantContext,
    filter?: TResourceListFilter,
  ): Promise<readonly TResourceDescriptor[]>;
  getResource(
    tenant: TTenantContext,
    resourceId: TResourceId,
  ): Promise<TResourceDescriptor | null>;
  createResource(
    tenant: TTenantContext,
    request: Readonly<{ kind: TResourceKind; name: string }>,
  ): Promise<TResourceDescriptor>;
  renameResource(
    tenant: TTenantContext,
    request: Readonly<{ resourceId: TResourceId; name: string }>,
  ): Promise<TResourceDescriptor>;
  deleteResource(tenant: TTenantContext, resourceId: TResourceId): Promise<void>;
  listResourceReferences(
    tenant: TTenantContext,
    resourceId: TResourceId,
  ): Promise<readonly TResourceBindingReference[]>;
  bindResource(
    tenant: TTenantContext,
    binding: TResourceBindingReference,
  ): Promise<TResourceBindingReference>;
  unbindResource(
    tenant: TTenantContext,
    request: Readonly<{ definitionId: string; revisionId: string; slot: TResourceSlot }>,
  ): Promise<boolean>;
  listResourceData(
    tenant: TTenantContext,
    request: TResourceDataListRequest,
  ): Promise<TResourceDataPage>;
  setResourceData(
    tenant: TTenantContext,
    request: TResourceDataSetRequest,
  ): Promise<TResourceDataMutationResult>;
  deleteResourceData(
    tenant: TTenantContext,
    request: TResourceDataDeleteRequest,
  ): Promise<boolean>;
}

/** Plaintext secret access is deliberately absent from the general management and gateway APIs. */
export interface IHumanResourceSecretService {
  revealSecret(
    tenant: TTenantContext,
    request: Readonly<{ resourceId: TResourceId; name: string }>,
  ): Promise<TSecretReveal | null>;
}

/**
 * Tenant-aware persistence SPI injected into the Resource Store implementation.
 * Storage keys are opaque to API and gateway consumers; implementations resolve them locally.
 */
export interface IResourceControlStore {
  listResources(
    tenant: TTenantContext,
    filter?: TResourceListFilter,
  ): Promise<readonly TResourceDescriptor[]>;
  getResource(
    tenant: TTenantContext,
    resourceId: TResourceId,
  ): Promise<TResourceDescriptor | null>;
  createResource(
    tenant: TTenantContext,
    request: TCreateResourceRequest,
  ): Promise<TResourceDescriptor>;
  renameResource(
    tenant: TTenantContext,
    request: Readonly<{ resourceId: TResourceId; name: string; nowMs: number }>,
  ): Promise<TResourceDescriptor | null>;
  updateResourceState(
    tenant: TTenantContext,
    request: TUpdateResourceStateRequest,
  ): Promise<TResourceDescriptor | null>;
  deleteResource(tenant: TTenantContext, resourceId: TResourceId): Promise<boolean>;

  getPlacement(
    tenant: TTenantContext,
    resourceId: TResourceId,
  ): Promise<TResourcePlacement | null>;
  reservePlacement(
    tenant: TTenantContext,
    request: TReserveResourcePlacementRequest,
  ): Promise<TResourcePlacement>;
  updatePlacement(
    tenant: TTenantContext,
    request: TUpdateResourcePlacementRequest,
  ): Promise<TResourcePlacement | null>;
  deletePlacement(tenant: TTenantContext, resourceId: TResourceId): Promise<boolean>;

  resolveBinding(
    tenant: TTenantContext,
    request: Readonly<{ definitionId: string; revisionId: string; slot: TResourceSlot }>,
  ): Promise<TResourceBindingReference | null>;
  listBindingsForResource(
    tenant: TTenantContext,
    resourceId: TResourceId,
  ): Promise<readonly TResourceBindingReference[]>;
  putBinding(
    tenant: TTenantContext,
    binding: TResourceBindingReference,
  ): Promise<TResourceBindingReference>;
  deleteBinding(
    tenant: TTenantContext,
    request: Readonly<{ definitionId: string; revisionId: string; slot: TResourceSlot }>,
  ): Promise<boolean>;

  createDbDraft(
    tenant: TTenantContext,
    draft: TDbResourceDraft,
  ): Promise<TDbResourceDraft>;
  getDbDraft(tenant: TTenantContext, draftId: string): Promise<TDbResourceDraft | null>;
  listDbDrafts(
    tenant: TTenantContext,
    request: Readonly<{ resourceId: TResourceId; status?: TDbResourceDraftStatus; limit?: number }>,
  ): Promise<readonly TDbResourceDraft[]>;
  updateDbDraft(
    tenant: TTenantContext,
    request: Readonly<{
      draftId: string;
      expectedStatus: TDbResourceDraftStatus | readonly TDbResourceDraftStatus[];
      status: TDbResourceDraftStatus;
      lastError: TSafeResourceError | null;
      appliedAtMs: number | null;
      nowMs: number;
    }>,
  ): Promise<TDbResourceDraft | null>;
  appendDbDraftChange(
    tenant: TTenantContext,
    change: TDbResourceDraftChange,
  ): Promise<TDbResourceDraftChange>;
  listDbDraftChanges(
    tenant: TTenantContext,
    draftId: string,
  ): Promise<readonly TDbResourceDraftChange[]>;

  createDbApply(
    tenant: TTenantContext,
    apply: TDbResourceApplyRun,
  ): Promise<TDbResourceApplyRun>;
  getDbApply(tenant: TTenantContext, applyId: string): Promise<TDbResourceApplyRun | null>;
  listDbApplies(
    tenant: TTenantContext,
    request: Readonly<{ resourceId: TResourceId; limit?: number }>,
  ): Promise<readonly TDbResourceApplyRun[]>;
  updateDbApply(
    tenant: TTenantContext,
    request: Readonly<{
      applyId: string;
      expectedStatus: TDbResourceApplyRun['status'] | readonly TDbResourceApplyRun['status'][];
      status: TDbResourceApplyRun['status'];
      lastError: TSafeResourceError | null;
      backupRetained: boolean;
      completedAtMs: number | null;
    }>,
  ): Promise<TDbResourceApplyRun | null>;

  createDbBackup(
    tenant: TTenantContext,
    backup: TDbResourceBackup,
  ): Promise<TDbResourceBackup>;
  getDbBackup(
    tenant: TTenantContext,
    request: Readonly<{ resourceId: TResourceId; applyRunId: string }>,
  ): Promise<TDbResourceBackup | null>;
  listDbBackups(
    tenant: TTenantContext,
    resourceId: TResourceId,
  ): Promise<readonly TDbResourceBackup[]>;
  updateDbBackup(
    tenant: TTenantContext,
    backup: TDbResourceBackup,
  ): Promise<TDbResourceBackup | null>;
}
