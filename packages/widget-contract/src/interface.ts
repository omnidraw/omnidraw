/**
 * @file Narrow public capabilities for widget build, publication, artifact access, and GC.
 */

import type { TTenantContext } from '@vibecanvas/tenant-core';
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
  TWidgetBuildRequest,
  TWidgetBuildResult,
  TWidgetDefinitionCreate,
  TWidgetDefinitionDescriptor,
  TWidgetDefinitionId,
  TWidgetPublicationCommitInput,
  TWidgetPublicationCommitResult,
  TWidgetPreviewArtifactActivationRequest,
  TWidgetPublishRequest,
  TWidgetPublishResult,
  TWidgetRevisionDescriptor,
  TWidgetRevisionId,
  TWidgetRevisionPruneRequest,
  TWidgetRevisionPruneResult,
  TWidgetRollbackInput,
} from './types';

export interface IWidgetArtifactBuilder {
  build(tenant: TTenantContext, request: TWidgetBuildRequest): Promise<TWidgetBuildResult>;
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

/** Tenant-qualified metadata store; publication and rollback methods are atomic CAS operations. */
export interface IWidgetControlStore extends IWidgetRevisionReader {
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

  commitPublication(
    tenant: TTenantContext,
    request: TWidgetPublicationCommitInput,
  ): Promise<TWidgetPublicationCommitResult>;

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

  /**
   * Attaches a UI artifact to an existing non-ready preview and marks it ready.
   * Implementations must reject a committed deletion tombstone and serialize
   * the preview reference with artifact claim/completion.
   */
  activatePreviewArtifact(
    tenant: TTenantContext,
    request: TWidgetPreviewArtifactActivationRequest,
  ): Promise<boolean>;
}

export interface IWidgetPublicationService extends IWidgetRevisionReader {
  publish(
    tenant: TTenantContext,
    request: TWidgetPublishRequest,
  ): Promise<TWidgetPublishResult>;

  rollback(
    tenant: TTenantContext,
    request: TWidgetRollbackInput,
  ): Promise<TWidgetActiveRevisionCasResult>;
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
