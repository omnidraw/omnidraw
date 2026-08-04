/**
 * @file Public resource gateway, Resource Store, provider, management, and control-store SPIs.
 */

import type {
  TCreateDbResourceApplyRequest,
  TCreateDbResourceBackupRequest,
  TCreateDbResourceDraftChangeRequest,
  TCreateDbResourceDraftRequest,
  TCreateResourceRequest,
  TDbResourceApplyRun,
  TDbResourceBackup,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TDbResourceDraftStatus,
  TResolvedResourceCall,
  TReserveResourcePlacementRequest,
  TResourceBinding,
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
  TResourceWritePermitScope,
  TSafeResourceError,
  TSecretReveal,
  TUpdateResourcePlacementRequest,
  TUpdateResourceStateRequest,
} from './types';

/** Location-transparent logical capability used by widgets and functions. */
export interface IResourceGateway {
  call(call: TResourceCall): Promise<TResourceCallResult>;
}

/** The authoritative execution boundary for resolved calls. */
export interface IResourceStore {
  call(call: TResolvedResourceCall): Promise<TResourceCallResult>;
  reconcile(): Promise<void>;
  close(): Promise<void>;
}

export interface IResourceBindingResolver {
  resolveBinding(slot: TResourceSlot): Promise<TResourceBinding | null>;
}

export interface IResourceRequirementResolver {
  resolveRequirement(slot: TResourceSlot): Promise<TResourceRequirement | null>;
}

export interface IResourceProvider {
  readonly kind: TResourceKind;
  readonly reconcileReady?: boolean;
  provision(
    resource: TResourceDescriptor,
    args: TResourceProviderCreateArgs,
  ): Promise<void>;
  delete(resource: TResourceDescriptor): Promise<void>;
  call(
    call: TResolvedResourceCall,
  ): Promise<TResourceCallResult>;
  reconcile?(
    resource: TResourceDescriptor,
  ): Promise<TResourceReconciliation>;
  close?(): Promise<void>;
}

export interface IResourceWriteCapabilityVerifier {
  verifyWriteCapability(capability: string): Promise<TResourceWriteCapabilityClaims | null>;
}

/** Revalidates the exact live permit at the provider commit edge. */
export interface IResourceWritePermitGuard {
  assertCanCommit(): Promise<void>;
}

/**
 * Holds one authoritative in-memory permit across the provider callback.
 * The permit is consumed even when the outcome is unclear to the caller.
 */
export interface IResourceWritePermitCoordinator {
  runWithWritePermit<T>(
    scope: TResourceWritePermitScope,
    operation: (guard: IResourceWritePermitGuard) => Promise<T>,
  ): Promise<T>;
}

/** Neutral coordination for clients that currently hold a resource in active use. */
export interface IResourceUseCoordinator {
  inspect(resourceId: TResourceId): Promise<TResourceUseInspection>;
  drain(request: TResourceDrainRequest): Promise<TResourceDrainResult>;
  release(
    lease: TResourceDrainLease,
    mode: TResourceReleaseMode,
  ): Promise<TResourceReleaseResult>;
}

/** Resource catalog management; data access remains behind the store/gateway. */
export interface IResourceManagementService {
  listResources(filter?: TResourceListFilter): Promise<readonly TResourceDescriptor[]>;
  getResource(resourceId: TResourceId): Promise<TResourceDescriptor | null>;
  createResource(
    request: Readonly<{ kind: TResourceKind; name: string }>,
  ): Promise<TResourceDescriptor>;
  renameResource(
    request: Readonly<{ resourceId: TResourceId; name: string }>,
  ): Promise<TResourceDescriptor>;
  deleteResource(resourceId: TResourceId): Promise<void>;
  listResourceData(
    request: TResourceDataListRequest,
  ): Promise<TResourceDataPage>;
  setResourceData(
    request: TResourceDataSetRequest,
  ): Promise<TResourceDataMutationResult>;
  deleteResourceData(
    request: TResourceDataDeleteRequest,
  ): Promise<boolean>;
}

/** Plaintext secret access is deliberately absent from the general management and gateway APIs. */
export interface IHumanResourceSecretService {
  revealSecret(
    request: Readonly<{ resourceId: TResourceId; name: string }>,
  ): Promise<TSecretReveal | null>;
}

/**
 * Persistence SPI injected into the Resource Store implementation.
 * Storage keys are opaque to API and gateway consumers; implementations resolve them locally.
 */
export interface IResourceControlStore {
  listResources(filter?: TResourceListFilter): Promise<readonly TResourceDescriptor[]>;
  getResource(resourceId: TResourceId): Promise<TResourceDescriptor | null>;
  createResource(
    request: TCreateResourceRequest,
  ): Promise<TResourceDescriptor>;
  renameResource(
    request: Readonly<{ resourceId: TResourceId; name: string }>,
  ): Promise<TResourceDescriptor | null>;
  updateResourceState(
    request: TUpdateResourceStateRequest,
  ): Promise<TResourceDescriptor | null>;
  deleteResource(resourceId: TResourceId): Promise<boolean>;

  getPlacement(resourceId: TResourceId): Promise<TResourcePlacement | null>;
  reservePlacement(
    request: TReserveResourcePlacementRequest,
  ): Promise<TResourcePlacement>;
  updatePlacement(
    request: TUpdateResourcePlacementRequest,
  ): Promise<TResourcePlacement | null>;
  deletePlacement(resourceId: TResourceId): Promise<boolean>;

  createDbDraft(
    draft: TCreateDbResourceDraftRequest,
  ): Promise<TDbResourceDraft>;
  getDbDraft(draftId: string): Promise<TDbResourceDraft | null>;
  listDbDrafts(
    request: Readonly<{ resourceId: TResourceId; status?: TDbResourceDraftStatus; limit?: number }>,
  ): Promise<readonly TDbResourceDraft[]>;
  updateDbDraft(
    request: Readonly<{
      draftId: string;
      expectedStatus: TDbResourceDraftStatus | readonly TDbResourceDraftStatus[];
      status: TDbResourceDraftStatus;
      lastError: TSafeResourceError | null;
      appliedAtSec: string | null;
    }>,
  ): Promise<TDbResourceDraft | null>;
  appendDbDraftChange(
    change: TCreateDbResourceDraftChangeRequest,
  ): Promise<TDbResourceDraftChange>;
  listDbDraftChanges(draftId: string): Promise<readonly TDbResourceDraftChange[]>;

  createDbApply(
    apply: TCreateDbResourceApplyRequest,
  ): Promise<TDbResourceApplyRun>;
  getDbApply(applyId: string): Promise<TDbResourceApplyRun | null>;
  listDbApplies(
    request: Readonly<{ resourceId: TResourceId; limit?: number }>,
  ): Promise<readonly TDbResourceApplyRun[]>;
  updateDbApply(
    request: Readonly<{
      applyId: string;
      expectedStatus: TDbResourceApplyRun['status'] | readonly TDbResourceApplyRun['status'][];
      status: TDbResourceApplyRun['status'];
      lastError: TSafeResourceError | null;
      backupRetained: boolean;
      completedAtSec: string | null;
    }>,
  ): Promise<TDbResourceApplyRun | null>;

  createDbBackup(
    backup: TCreateDbResourceBackupRequest,
  ): Promise<TDbResourceBackup>;
  getDbBackup(
    request: Readonly<{ resourceId: TResourceId; applyRunId: string }>,
  ): Promise<TDbResourceBackup | null>;
  listDbBackups(resourceId: TResourceId): Promise<readonly TDbResourceBackup[]>;
  updateDbBackup(
    backup: TDbResourceBackup,
  ): Promise<TDbResourceBackup | null>;
}
