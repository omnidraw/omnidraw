import { randomUUID } from 'node:crypto';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  IWidgetBrowserUiArtifactReadCapabilityIssuer,
  IWidgetArtifactReadCapabilitySigner,
  IWidgetArtifactReadCapabilityVerifier,
  IWidgetArtifactStore,
  IWidgetControlStore,
  IWidgetPreviewStore,
  IWidgetServerPreviewArtifactReadCapabilityIssuer,
  IWidgetServerExecutionArtifactReadCapabilityIssuer,
  IWidgetSourceBuildArtifactReadCapabilityIssuer,
  IWidgetUiPreviewArtifactReadCapabilityIssuer,
  TWidgetArtifactDeleteRequest,
  TWidgetArtifactDescriptor,
  TWidgetArtifactPut,
  TWidgetArtifactReadCapability,
  TWidgetArtifactReadCapabilityIssueRequest,
  TWidgetArtifactReadPurpose,
  TWidgetArtifactReadRequest,
  TWidgetPreviewArtifactReadCapabilityIssueRequest,
} from '..';
import { LocalWidgetArtifactStore } from './LocalWidgetArtifactStore';
import {
  fnWidgetArtifactAudience,
  fnWidgetArtifactCapabilityContextIsValid,
  fnWidgetArtifactPurposeAllowsKind,
} from './fn.artifact-read-policy';

export type TWidgetArtifactServiceConfig = Readonly<{
  controlStore: IWidgetControlStore;
  blobs: LocalWidgetArtifactStore;
  capabilityIssuer: IWidgetArtifactReadCapabilitySigner;
  capabilityVerifier: IWidgetArtifactReadCapabilityVerifier;
  previewStore?: Pick<IWidgetPreviewStore, 'resolvePreviewArtifact'>;
  now?: () => number;
  createNonce?: () => string;
}>;

/** Reference-authorized metadata and immutable-byte artifact capability. */
export class WidgetArtifactService implements
  IWidgetArtifactStore,
  IWidgetBrowserUiArtifactReadCapabilityIssuer,
  IWidgetServerExecutionArtifactReadCapabilityIssuer,
  IWidgetSourceBuildArtifactReadCapabilityIssuer,
  IWidgetUiPreviewArtifactReadCapabilityIssuer,
  IWidgetServerPreviewArtifactReadCapabilityIssuer {
  readonly #now: () => number;
  readonly #createNonce: () => string;

  constructor(readonly config: TWidgetArtifactServiceConfig) {
    this.#now = config.now ?? Date.now;
    this.#createNonce = config.createNonce ?? randomUUID;
  }

  async putArtifact(
    tenant: TTenantContext,
    artifact: TWidgetArtifactPut,
  ): Promise<TWidgetArtifactDescriptor> {
    this.#assertOrganization(tenant);
    const blob = await this.config.blobs.writeArtifact({
      kind: artifact.kind,
      bytes: artifact.bytes,
      expectedDigestSha256: artifact.digestSha256,
    });
    return Object.freeze({
      orgId: tenant.orgId,
      id: artifact.id,
      kind: artifact.kind,
      digestSha256: blob.digestSha256,
      byteSize: blob.byteSize,
      retentionState: artifact.retentionState,
      retainUntilMs: artifact.retainUntilMs,
      createdAtMs: artifact.createdAtMs,
    });
  }

  issueBrowserUiArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityIssueRequest,
  ): Promise<TWidgetArtifactReadCapability> {
    return this.#issueArtifactReadCapability(tenant, request, 'browser_ui');
  }

  issueServerExecutionArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityIssueRequest,
  ): Promise<TWidgetArtifactReadCapability> {
    return this.#issueArtifactReadCapability(tenant, request, 'server_execution');
  }

  issueUiPreviewArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetPreviewArtifactReadCapabilityIssueRequest & Readonly<{ artifactKind: 'ui' }>,
  ): Promise<TWidgetArtifactReadCapability> {
    return this.#issuePreviewArtifactReadCapability(tenant, request, 'preview_ui');
  }

  issueServerPreviewArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetPreviewArtifactReadCapabilityIssueRequest & Readonly<{ artifactKind: 'server' }>,
  ): Promise<TWidgetArtifactReadCapability> {
    return this.#issuePreviewArtifactReadCapability(tenant, request, 'preview_server');
  }

  issueSourceBuildArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityIssueRequest,
  ): Promise<TWidgetArtifactReadCapability> {
    return this.#issueArtifactReadCapability(tenant, request, 'source_build');
  }

  issueSourceMapArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityIssueRequest,
  ): Promise<TWidgetArtifactReadCapability> {
    return this.#issueArtifactReadCapability(tenant, request, 'source_map');
  }

  issueCellMoveArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityIssueRequest,
  ): Promise<TWidgetArtifactReadCapability> {
    return this.#issueArtifactReadCapability(tenant, request, 'cell_move');
  }

  async #issueArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetArtifactReadCapabilityIssueRequest,
    purpose: TWidgetArtifactReadPurpose,
  ): Promise<TWidgetArtifactReadCapability> {
    this.#assertOrganization(tenant);
    const audience = fnWidgetArtifactAudience(tenant, purpose);
    if (
      !fnWidgetArtifactCapabilityContextIsValid(audience)
      || !fnWidgetArtifactPurposeAllowsKind(purpose, request.artifactKind)
    ) {
      throw this.#artifactNotFound();
    }
    const descriptor = await this.config.controlStore.resolveArtifactReference(tenant, {
      definitionId: request.definitionId,
      revisionId: request.revisionId,
      artifactId: request.artifactId,
      kind: request.artifactKind,
      digestSha256: request.digestSha256,
    });
    if (!descriptor) {
      throw this.#artifactNotFound();
    }
    const nonce = this.#createNonce();
    if (!fnWidgetArtifactCapabilityContextIsValid(nonce)) {
      throw this.#artifactNotFound();
    }
    return this.config.capabilityIssuer.issueArtifactReadCapability(tenant, {
      ...request,
      purpose,
      audience,
      nonce,
    });
  }

  async #issuePreviewArtifactReadCapability(
    tenant: TTenantContext,
    request: TWidgetPreviewArtifactReadCapabilityIssueRequest,
    purpose: Extract<TWidgetArtifactReadPurpose, 'preview_ui' | 'preview_server'>,
  ): Promise<TWidgetArtifactReadCapability> {
    this.#assertOrganization(tenant);
    const audience = fnWidgetArtifactAudience(tenant, purpose);
    if (
      !this.config.previewStore
      || !fnWidgetArtifactCapabilityContextIsValid(audience)
      || !fnWidgetArtifactPurposeAllowsKind(purpose, request.artifactKind)
    ) throw this.#artifactNotFound();
    const descriptor = await this.config.previewStore.resolvePreviewArtifact(tenant, {
      previewId: request.previewId,
      revisionId: request.previewRevisionId,
      artifactId: request.artifactId,
      kind: request.artifactKind,
      digestSha256: request.digestSha256,
      nowMs: this.#now(),
    });
    if (!descriptor) throw this.#artifactNotFound();
    const nonce = this.#createNonce();
    if (!fnWidgetArtifactCapabilityContextIsValid(nonce)) throw this.#artifactNotFound();
    return this.config.capabilityIssuer.issueArtifactReadCapability(tenant, {
      definitionId: request.previewId,
      revisionId: request.previewRevisionId,
      artifactId: request.artifactId,
      artifactKind: request.artifactKind,
      digestSha256: request.digestSha256,
      expiresAtMs: request.expiresAtMs,
      purpose,
      audience,
      nonce,
    });
  }

  async getArtifact(
    tenant: TTenantContext,
    request: TWidgetArtifactReadRequest,
  ): Promise<TWidgetArtifactDescriptor | null> {
    const audience = fnWidgetArtifactAudience(tenant, request.purpose);
    if (
      tenant.orgId !== this.config.blobs.config.orgId
      || !fnWidgetArtifactCapabilityContextIsValid(audience)
    ) return null;
    const nowMs = this.#now();
    const claims = await this.config.capabilityVerifier.verifyArtifactReadCapability(tenant, {
      readCapability: request.readCapability,
      purpose: request.purpose,
      audience,
      nowMs,
    });
    if (
      !claims
      || claims.artifactId !== request.artifactId
      || !fnWidgetArtifactPurposeAllowsKind(claims.purpose, claims.artifactKind)
    ) return null;
    if (claims.purpose === 'preview_ui' || claims.purpose === 'preview_server') {
      if (!this.config.previewStore) return null;
      return this.config.previewStore.resolvePreviewArtifact(tenant, {
        previewId: claims.definitionId,
        revisionId: claims.revisionId,
        artifactId: claims.artifactId,
        kind: claims.artifactKind as 'ui' | 'server',
        digestSha256: claims.digestSha256,
        nowMs,
      });
    }
    return this.config.controlStore.resolveArtifactReference(tenant, {
      definitionId: claims.definitionId,
      revisionId: claims.revisionId,
      artifactId: claims.artifactId,
      kind: claims.artifactKind,
      digestSha256: claims.digestSha256,
    });
  }

  async readArtifact(
    tenant: TTenantContext,
    request: TWidgetArtifactReadRequest,
  ): Promise<Uint8Array | null> {
    const descriptor = await this.getArtifact(tenant, request);
    if (!descriptor) return null;
    return this.config.blobs.readArtifact(descriptor);
  }

  async deleteArtifact(
    tenant: TTenantContext,
    request: TWidgetArtifactDeleteRequest,
  ): Promise<boolean> {
    this.#assertOrganization(tenant);
    await this.config.blobs.deleteArtifact({
      orgId: tenant.orgId,
      id: request.artifactId,
      kind: request.kind,
      digestSha256: request.digestSha256,
      byteSize: 0,
      retentionState: 'deleting',
      retainUntilMs: null,
      createdAtMs: 0,
    });
    return true;
  }

  #assertOrganization(tenant: TTenantContext): void {
    if (tenant.orgId !== this.config.blobs.config.orgId) {
      throw this.#artifactNotFound();
    }
  }

  #artifactNotFound(): Error {
    return Object.assign(new Error('Widget artifact was not found.'), {
      code: 'WIDGET_ARTIFACT_NOT_FOUND',
    });
  }
}
