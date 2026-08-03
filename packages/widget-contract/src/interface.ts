/**
 * @file Narrow public capabilities for widget build, publication, artifact access, and GC.
 */

import type { TTenantContext } from '@omnidraw/tenant-core';
import type {
  TWidgetActiveRevisionCasResult,
  TWidgetArtifactDeleteRequest,
  TWidgetArtifactDeletionClaimRequest,
  TWidgetArtifactDeletionCompleteRequest,
  TWidgetArtifactDeletionCompleteResult,
  TWidgetArtifactDescriptor,
  TWidgetArtifactDigestReferenceRequest,
  TWidgetArtifactGcCandidateRequest,
  TWidgetArtifactGcRequest,
  TWidgetArtifactGcResult,
  TWidgetArtifactPut,
  TWidgetArtifactReadCapability,
  TWidgetArtifactReadCapabilityClaims,
  TWidgetArtifactReadCapabilityIssueRequest,
  TWidgetArtifactReadCapabilitySignRequest,
  TWidgetArtifactReadCapabilityVerifyRequest,
  TWidgetArtifactReadRequest,
  TWidgetArtifactResolutionRequest,
  TWidgetArtifactRetentionReconcileRequest,
  TWidgetArtifactRetentionReconcileResult,
  TWidgetArtifactRetentionRestoreRequest,
  TWidgetArtifactConstructionRequest,
  TWidgetArtifactConstructionResult,
  TWidgetArtifactConstructionSignRequest,
  TWidgetCapsuleArtifactInspectionRequest,
  TWidgetCapsuleArtifactInspectionResult,
  TWidgetCapsuleArtifactSignRequest,
  TWidgetCapsuleArtifactSignResult,
  TWidgetCapsuleHostConfiguration,
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetCapsuleRuntimeDescriptorCreateRequest,
  TWidgetCapsuleUiArtifact,
  TWidgetCapsuleUiBuildRequest,
  TWidgetBuildRequest,
  TWidgetBuildResult,
  TWidgetDefinitionCreate,
  TWidgetDefinitionArchiveInput,
  TWidgetDefinitionArchiveResult,
  TWidgetDefinitionDescriptor,
  TWidgetDefinitionId,
  TWidgetPublicationCommitInput,
  TWidgetPublicationCommitResult,
  TWidgetPublishedPlacementDescriptor,
  TWidgetPublishedPlacementTarget,
  TWidgetPreviewArtifactResolutionRequest,
  TWidgetPreviewBuildRequest,
  TWidgetPreviewBuildResult,
  TWidgetPreviewCommitInput,
  TWidgetPreviewCommitResult,
  TWidgetPreviewGetRequest,
  TWidgetPreviewMountLeaseAcquireRequest,
  TWidgetPreviewMountLeaseDescriptor,
  TWidgetPreviewMountLeaseReleaseRequest,
  TWidgetPreviewMountLeaseRenewRequest,
  TWidgetPreviewPromotionRequest,
  TWidgetPreviewPublicationReplayRequest,
  TWidgetPreviewPublicationReplayResult,
  TWidgetPreviewRevisionDescriptor,
  TWidgetPreviewRevisionGetRequest,
  TWidgetPreviewWorkspaceCloseRequest,
  TWidgetPublishRequest,
  TWidgetPublishConstructionRequest,
  TWidgetPublishResult,
  TWidgetRevisionDescriptor,
  TWidgetRevisionId,
  TWidgetRevisionSourceDescriptor,
  TWidgetRevisionSourceSnapshotReadRequest,
  TWidgetRevisionPruneRequest,
  TWidgetRevisionPruneResult,
  TWidgetResourceBindingInput,
  TWidgetRollbackInput,
  TWidgetServerFunctionDescriptor,
  TWidgetServerFunctionDescriptorExtractionRequest,
  TWidgetSourceSnapshot,
} from './types';

export interface IWidgetCapsuleHostConfigurationReader {
  read(): Promise<TWidgetCapsuleHostConfiguration>;
}

export interface IWidgetArtifactBuilder {
  build(tenant: TTenantContext, request: TWidgetBuildRequest): Promise<TWidgetBuildResult>;
}

/** Builds exact unsigned UI/source/server outputs without selecting signing authority. */
export interface IWidgetArtifactConstructor {
  construct(
    tenant: TTenantContext,
    request: TWidgetArtifactConstructionRequest,
  ): Promise<TWidgetArtifactConstructionResult>;
  closeWorkspace?(
    tenant: TTenantContext,
    request: Readonly<{ workspaceKey: string }>,
  ): Promise<void>;
  close?(): Promise<void>;
}

/** Applies Preview or release signing to one already-built immutable construction. */
export interface IWidgetArtifactConstructionSigner {
  signConstruction(
    tenant: TTenantContext,
    request: TWidgetArtifactConstructionSignRequest,
  ): Promise<TWidgetBuildResult>;
}

/** Compatibility build port plus the exact construction/promotion seam. */
export interface IWidgetArtifactConstructionBuilder
  extends IWidgetArtifactBuilder, IWidgetArtifactConstructor, IWidgetArtifactConstructionSigner {}

/** Trusted build port; implementations map Omnidraw inputs to public Capsule build APIs. */
export interface IWidgetCapsuleUiArtifactBuilder {
  buildCapsuleUiArtifact(
    tenant: TTenantContext,
    request: TWidgetCapsuleUiBuildRequest,
  ): Promise<TWidgetCapsuleUiArtifact>;
}

/** Trusted bytes-in/bytes-out signing port. Private signing material is never part of this contract. */
export interface IWidgetCapsuleArtifactSigner {
  signCapsuleArtifact(
    tenant: TTenantContext,
    request: TWidgetCapsuleArtifactSignRequest,
  ): Promise<TWidgetCapsuleArtifactSignResult>;
}

/** Verifies exact signed bytes and returns only serializable Capsule runtime metadata. */
export interface IWidgetCapsuleArtifactInspector {
  inspectCapsuleArtifact(
    tenant: TTenantContext,
    request: TWidgetCapsuleArtifactInspectionRequest,
  ): Promise<TWidgetCapsuleArtifactInspectionResult>;
}

export interface IWidgetCapsuleRuntimeDescriptorFactory {
  createCapsuleRuntimeDescriptor(
    request: TWidgetCapsuleRuntimeDescriptorCreateRequest,
  ): TWidgetCapsuleRuntimeDescriptor;
}

/**
 * Loads an already-built server artifact only inside a bounded registration
 * sandbox and returns its generated, serializable named-export descriptors.
 */
export interface IWidgetServerFunctionDescriptorExtractor {
  extractServerFunctionDescriptors(
    tenant: TTenantContext,
    request: TWidgetServerFunctionDescriptorExtractionRequest,
  ): Promise<readonly TWidgetServerFunctionDescriptor[]>;
}

export interface IWidgetBrowserUiArtifactReadCapabilityIssuer {
  issueBrowserUiArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityIssueRequest,
  ): Promise<TWidgetArtifactReadCapability>;
}

export interface IWidgetServerExecutionArtifactReadCapabilityIssuer {
  issueServerExecutionArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityIssueRequest,
  ): Promise<TWidgetArtifactReadCapability>;
}

export interface IWidgetSourceBuildArtifactReadCapabilityIssuer {
  issueSourceBuildArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityIssueRequest,
  ): Promise<TWidgetArtifactReadCapability>;
}

/** Internal authority boundary supplied with a service-generated nonce. */
export interface IWidgetArtifactReadCapabilitySigner {
  issueArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilitySignRequest,
  ): Promise<TWidgetArtifactReadCapability>;
}

export interface IWidgetArtifactReadCapabilityVerifier {
  verifyArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityVerifyRequest,
  ): Promise<TWidgetArtifactReadCapabilityClaims | null>;
}

export interface IWidgetArtifactReader {
  getArtifact(
    tenant: TTenantContext,
    request: TWidgetArtifactReadRequest,
  ): Promise<TWidgetArtifactDescriptor | null>;

  readArtifact(
    tenant: TTenantContext,
    request: TWidgetArtifactReadRequest,
  ): Promise<Uint8Array | null>;
}

export interface IWidgetArtifactStore extends IWidgetArtifactReader {
  putArtifact(
    tenant: TTenantContext,
    artifact: TWidgetArtifactPut,
  ): Promise<TWidgetArtifactDescriptor>;

  deleteArtifact(
    tenant: TTenantContext,
    request: TWidgetArtifactDeleteRequest,
  ): Promise<boolean>;
}

export interface IWidgetRevisionReader {
  getRevision(
    tenant: TTenantContext,
    revisionId: TWidgetRevisionId,
  ): Promise<TWidgetRevisionDescriptor | null>;

  getActiveRevision(
    tenant: TTenantContext,
    definitionId: TWidgetDefinitionId,
  ): Promise<TWidgetRevisionDescriptor | null>;
}

export interface IWidgetRevisionSourceReader {
  getRevisionSource(
    tenant: TTenantContext,
    revisionId: TWidgetRevisionId,
  ): Promise<TWidgetRevisionSourceDescriptor | null>;
}

/** Trusted source inspector returning a decoded, integrity-checked immutable snapshot. */
export interface IWidgetRevisionSourceSnapshotReader {
  readRevisionSourceSnapshot(
    tenant: TTenantContext,
    request: TWidgetRevisionSourceSnapshotReadRequest,
  ): Promise<TWidgetSourceSnapshot | null>;
}

export interface IWidgetPreviewService {
  buildPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewBuildRequest,
  ): Promise<TWidgetPreviewBuildResult>;
}

export interface IWidgetDurablePreviewService extends IWidgetPreviewService {
  loadPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewGetRequest,
  ): Promise<TWidgetPreviewBuildResult | null>;

  loadPreviewRevision(
    tenant: TTenantContext,
    request: TWidgetPreviewRevisionGetRequest,
  ): Promise<TWidgetPreviewBuildResult | null>;
}

export interface IWidgetPreviewWorkspaceService {
  closePreviewWorkspace(
    tenant: TTenantContext,
    request: TWidgetPreviewWorkspaceCloseRequest,
  ): Promise<void>;
}

export interface IWidgetPreviewRevisionReader {
  getPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewGetRequest,
  ): Promise<TWidgetPreviewRevisionDescriptor | null>;

  getPreviewRevision(
    tenant: TTenantContext,
    request: TWidgetPreviewRevisionGetRequest,
  ): Promise<TWidgetPreviewRevisionDescriptor | null>;
}

/** Durable metadata authority for immutable frame-owned Preview revisions. */
export interface IWidgetPreviewStore extends IWidgetPreviewRevisionReader {
  commitPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewCommitInput,
  ): Promise<TWidgetPreviewCommitResult>;

  resolvePreviewArtifact(
    tenant: TTenantContext,
    request: TWidgetPreviewArtifactResolutionRequest,
  ): Promise<TWidgetArtifactDescriptor | null>;

  getPreviewBindings(
    tenant: TTenantContext,
    request: TWidgetPreviewRevisionGetRequest,
  ): Promise<readonly TWidgetResourceBindingInput[]>;

  acquirePreviewMountLease(
    tenant: TTenantContext,
    request: TWidgetPreviewMountLeaseAcquireRequest,
  ): Promise<TWidgetPreviewMountLeaseDescriptor | null>;

  renewPreviewMountLease(
    tenant: TTenantContext,
    request: TWidgetPreviewMountLeaseRenewRequest,
  ): Promise<TWidgetPreviewMountLeaseDescriptor | null>;

  releasePreviewMountLease(
    tenant: TTenantContext,
    request: TWidgetPreviewMountLeaseReleaseRequest,
  ): Promise<boolean>;
}

/** Internal exact-construction reader used only by trusted promotion orchestration. */
export interface IWidgetPreviewConstructionReader {
  readPreviewConstruction(
    tenant: TTenantContext,
    request: TWidgetPreviewRevisionGetRequest,
  ): Promise<TWidgetArtifactConstructionResult | null>;
}

export interface IWidgetPreviewPromotionService {
  replayPreviewPublication(
    tenant: TTenantContext,
    request: TWidgetPreviewPublicationReplayRequest,
  ): Promise<TWidgetPreviewPublicationReplayResult | null>;

  publishPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewPromotionRequest,
  ): Promise<TWidgetPublishResult>;
}

export interface IWidgetPublishedPlacementReader {
  listPublishedPlacements(
    tenant: TTenantContext,
  ): Promise<readonly TWidgetPublishedPlacementDescriptor[]>;

  resolvePublishedPlacement(
    tenant: TTenantContext,
    target: TWidgetPublishedPlacementTarget,
  ): Promise<TWidgetPublishedPlacementDescriptor | null>;
}

/** Tenant-qualified metadata store; publication and rollback methods are atomic CAS operations. */
export interface IWidgetControlStore extends IWidgetRevisionReader, IWidgetRevisionSourceReader {
  listPublishedDefinitions(
    tenant: TTenantContext,
    limit: number,
  ): Promise<readonly TWidgetDefinitionDescriptor[]>;

  createDefinition(
    tenant: TTenantContext,
    request: TWidgetDefinitionCreate,
  ): Promise<TWidgetDefinitionDescriptor>;

  getDefinition(
    tenant: TTenantContext,
    definitionId: TWidgetDefinitionId,
  ): Promise<TWidgetDefinitionDescriptor | null>;

  getDefinitionBySlug(
    tenant: TTenantContext,
    slug: string,
  ): Promise<TWidgetDefinitionDescriptor | null>;

  archiveDefinition(
    tenant: TTenantContext,
    request: TWidgetDefinitionArchiveInput,
  ): Promise<TWidgetDefinitionArchiveResult>;

  commitPublication(
    tenant: TTenantContext,
    request: TWidgetPublicationCommitInput,
  ): Promise<TWidgetPublicationCommitResult>;

  replayPreviewPublication(
    tenant: TTenantContext,
    request: TWidgetPreviewPublicationReplayRequest,
  ): Promise<TWidgetPreviewPublicationReplayResult | null>;

  rollbackPublication(
    tenant: TTenantContext,
    request: TWidgetRollbackInput,
  ): Promise<TWidgetActiveRevisionCasResult>;

  resolveArtifactReference(
    tenant: TTenantContext,
    request: TWidgetArtifactResolutionRequest,
  ): Promise<TWidgetArtifactDescriptor | null>;

  isArtifactDigestReferenced(
    tenant: TTenantContext,
    request: TWidgetArtifactDigestReferenceRequest,
  ): Promise<boolean>;

  pruneInactiveRevisions(
    tenant: TTenantContext,
    request: TWidgetRevisionPruneRequest,
  ): Promise<TWidgetRevisionPruneResult>;

  reconcileArtifactRetention(
    tenant: TTenantContext,
    request: TWidgetArtifactRetentionReconcileRequest,
  ): Promise<TWidgetArtifactRetentionReconcileResult>;

  listArtifactGcCandidates(
    tenant: TTenantContext,
    request: TWidgetArtifactGcCandidateRequest,
  ): Promise<readonly TWidgetArtifactDescriptor[]>;

  /**
   * Durably changes an unreferenced candidate to `deleting`. The returned
   * tombstone must commit before metadata finalization or physical unlink.
   */
  claimArtifactDeletion(
    tenant: TTenantContext,
    request: TWidgetArtifactDeletionClaimRequest,
  ): Promise<TWidgetArtifactDescriptor | null>;

  /**
   * Finalizes a committed tombstone. Callers must fence this metadata change
   * and any requested physical unlink in one mutation transaction.
   */
  completeArtifactDeletion(
    tenant: TTenantContext,
    request: TWidgetArtifactDeletionCompleteRequest,
  ): Promise<TWidgetArtifactDeletionCompleteResult>;

  restoreArtifactRetention(
    tenant: TTenantContext,
    request: TWidgetArtifactRetentionRestoreRequest,
  ): Promise<boolean>;

}

export interface IWidgetPublicationService extends IWidgetRevisionReader, IWidgetRevisionSourceReader {
  publish(
    tenant: TTenantContext,
    request: TWidgetPublishRequest,
  ): Promise<TWidgetPublishResult>;

  publishConstruction(
    tenant: TTenantContext,
    request: TWidgetPublishConstructionRequest,
  ): Promise<TWidgetPublishResult>;

  rollback(
    tenant: TTenantContext,
    request: TWidgetRollbackInput,
  ): Promise<TWidgetActiveRevisionCasResult>;

  archive(
    tenant: TTenantContext,
    request: TWidgetDefinitionArchiveInput,
  ): Promise<TWidgetDefinitionArchiveResult>;
}

export interface IWidgetArtifactGarbageCollector {
  collect(
    tenant: TTenantContext,
    request: TWidgetArtifactGcRequest,
  ): Promise<TWidgetArtifactGcResult>;
}

/**
 * Serializes filesystem artifact mutations with their authoritative metadata.
 * Local adapters use the organization database write transaction as the
 * cross-runtime fence; managed adapters may provide an equivalent coordinator.
 */
export interface IWidgetArtifactMutationCoordinator {
  runArtifactMutation<T>(
    tenant: TTenantContext,
    operation: () => Promise<T>,
  ): Promise<T>;
}
