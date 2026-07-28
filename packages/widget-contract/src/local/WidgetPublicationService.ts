import { createHash, randomUUID } from 'node:crypto';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetCapsuleRuntimeDescriptor,
  ZWidgetManifestV3,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetManifest,
  fnValidateWidgetResourceBindings,
  fnValidateWidgetBuildIntegrity,
  fnWidgetBuildIntegrityDiagnostic,
  fnWidgetPreviewConstructionMatchesPublication,
  type IWidgetArtifactBuilder,
  type IWidgetArtifactConstructionSigner,
  type IWidgetArtifactMutationCoordinator,
  type IWidgetArtifactStore,
  type IWidgetControlStore,
  type IWidgetPublicationService,
  type TWidgetActiveRevisionCasResult,
  type TWidgetDefinitionArchiveInput,
  type TWidgetDefinitionArchiveResult,
  type TWidgetBuildResult,
  type TWidgetManifestV3,
  type TWidgetPublishConstructionRequest,
  type TWidgetPublishRequest,
  type TWidgetPublishResult,
  type TWidgetRevisionDescriptor,
  type TWidgetRevisionId,
  type TWidgetRevisionSourceDescriptor,
  type TWidgetRollbackInput,
} from '..';
import { WidgetArtifactOperationLane } from './WidgetArtifactOperationLane';
import { WidgetSourceSnapshot } from './WidgetSourceSnapshot';

export type TWidgetPublicationServiceConfig = Readonly<{
  builder: IWidgetArtifactBuilder;
  constructionSigner?: IWidgetArtifactConstructionSigner;
  artifacts: IWidgetArtifactStore;
  controlStore: IWidgetControlStore;
  mutationCoordinator: IWidgetArtifactMutationCoordinator;
  createId?: () => string;
  operationLane?: WidgetArtifactOperationLane;
  sourceSnapshots?: WidgetSourceSnapshot;
}>;

function invalidBindings(reason: string, slot?: string): Error {
  return Object.assign(new Error(
    slot === undefined
      ? `Widget resource bindings are invalid: ${reason}.`
      : `Widget resource binding '${slot}' is invalid: ${reason}.`,
  ), { code: 'WIDGET_RESOURCE_BINDINGS_INVALID' });
}

/** Build-and-commit orchestration for immutable published widget revisions. */
export class WidgetPublicationService implements IWidgetPublicationService {
  readonly #createId: () => string;
  readonly #operationLane: WidgetArtifactOperationLane;
  readonly #sourceSnapshots: WidgetSourceSnapshot;

  constructor(readonly config: TWidgetPublicationServiceConfig) {
    this.#createId = config.createId ?? randomUUID;
    this.#operationLane = config.operationLane ?? new WidgetArtifactOperationLane();
    this.#sourceSnapshots = config.sourceSnapshots ?? new WidgetSourceSnapshot();
  }

  async publish(
    tenant: TTenantContext,
    request: TWidgetPublishRequest,
  ): Promise<TWidgetPublishResult> {
    const { manifest, canonicalManifestJson } = this.#validatedRequest(request);
    const build = await this.config.builder.build(tenant, {
      snapshot: request.snapshot,
      manifest,
      canonicalManifestJson,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      buildPolicyId: request.buildPolicyId,
      signingPurpose: 'release',
    });
    return this.#commitBuild(tenant, request, manifest, canonicalManifestJson, build);
  }

  async publishConstruction(
    tenant: TTenantContext,
    request: TWidgetPublishConstructionRequest,
  ): Promise<TWidgetPublishResult> {
    const { manifest, canonicalManifestJson } = this.#validatedRequest(request);
    const construction = request.construction;
    if (!fnWidgetPreviewConstructionMatchesPublication({
      snapshot: request.snapshot,
      construction,
      canonicalManifestJson,
    })) {
      throw Object.assign(new Error(
        'The selected Preview construction does not match the publication request.',
      ), { code: 'WIDGET_PREVIEW_PROMOTION_STALE' });
    }
    const signer = this.config.constructionSigner
      ?? (
        'signConstruction' in this.config.builder
          ? this.config.builder as IWidgetArtifactConstructionSigner
          : null
      );
    if (signer === null) {
      throw Object.assign(new Error(
        'The configured widget builder cannot promote an existing Preview construction.',
      ), { code: 'WIDGET_PREVIEW_PROMOTION_UNAVAILABLE' });
    }
    // This is the only build-adjacent operation in promotion: it signs the
    // retained canonical unsigned bytes and never invokes guest construction.
    const build = await signer.signConstruction(tenant, {
      construction,
      signingPurpose: 'release',
    });
    return this.#commitBuild(
      tenant,
      request,
      manifest,
      canonicalManifestJson,
      build,
      construction.sourceArtifact,
    );
  }

  #validatedRequest(
    request: Pick<
      TWidgetPublishRequest,
      'manifest' | 'bindings'
    >,
  ): Readonly<{
    manifest: TWidgetManifestV3;
    canonicalManifestJson: string;
  }> {
    const manifest = ZWidgetManifestV3.parse(request.manifest);
    const bindingValidation = fnValidateWidgetResourceBindings(manifest, request.bindings);
    if (!bindingValidation.valid) {
      throw invalidBindings(bindingValidation.reason, bindingValidation.slot);
    }
    return Object.freeze({
      manifest,
      canonicalManifestJson: fnCanonicalizeWidgetManifest(manifest),
    });
  }

  async #commitBuild(
    tenant: TTenantContext,
    request: TWidgetPublishRequest | TWidgetPublishConstructionRequest,
    manifest: TWidgetManifestV3,
    canonicalManifestJson: string,
    build: TWidgetBuildResult,
    retainedSourceArtifact?: Readonly<{
      digestSha256: string;
      bytes: Uint8Array;
    }>,
  ): Promise<TWidgetPublishResult> {
    const parsedFunctionDescriptors = ZWidgetServerFunctionDescriptors.safeParse(
      build.functionDescriptors,
    );
    if (!parsedFunctionDescriptors.success) {
      throw Object.assign(new Error('Widget builder returned malformed server-function descriptors.'), {
        code: 'WIDGET_BUILD_INTEGRITY_FAILED',
      });
    }
    const functionDescriptors = parsedFunctionDescriptors.data;
    const runtimeDescriptor = ZWidgetCapsuleRuntimeDescriptor.parse(
      build.uiArtifact.runtimeDescriptor,
    );
    const normalizedBuild = {
      ...build,
      functionDescriptors,
      uiArtifact: { ...build.uiArtifact, runtimeDescriptor },
    };
    const integrity = fnValidateWidgetBuildIntegrity({
      snapshot: request.snapshot,
      manifest,
      canonicalManifestJson,
      builderIdentity: build.builderIdentity,
      capsuleBuildIdentity: build.capsuleBuildIdentity,
      buildPolicyId: build.buildPolicyId,
      build: normalizedBuild,
      digestSha256: (value) => createHash('sha256').update(value).digest('hex'),
    });
    if (!integrity.valid) {
      throw Object.assign(new Error(fnWidgetBuildIntegrityDiagnostic(integrity)), {
        code: 'WIDGET_BUILD_INTEGRITY_FAILED',
      });
    }
    const sourceArtifactBytes = retainedSourceArtifact
      ?? this.#sourceSnapshots.encodeArtifact(request.snapshot, {
        builderIdentity: build.builderIdentity,
      });

    return this.#operationLane.run(() => (
      this.config.mutationCoordinator.runArtifactMutation(tenant, async () => {
        const sourceArtifact = await this.config.artifacts.putArtifact(tenant, {
          id: this.#createId(),
          kind: 'source',
          digestSha256: sourceArtifactBytes.digestSha256,
          bytes: sourceArtifactBytes.bytes,
          retentionState: 'pinned',
          retainUntilMs: null,
          createdAtMs: request.nowMs,
        });
        const uiArtifact = await this.config.artifacts.putArtifact(tenant, {
          id: this.#createId(),
          kind: 'ui',
          digestSha256: build.uiArtifact.digestSha256,
          bytes: build.uiArtifact.bytes,
          retentionState: 'pinned',
          retainUntilMs: null,
          createdAtMs: request.nowMs,
        });
        const serverArtifact = build.serverArtifact === null
          ? null
          : await this.config.artifacts.putArtifact(tenant, {
              id: this.#createId(),
              kind: 'server',
              digestSha256: build.serverArtifact.digestSha256,
              bytes: build.serverArtifact.bytes,
              retentionState: 'pinned',
              retainUntilMs: null,
              createdAtMs: request.nowMs,
            });

        // Blob writes, metadata references, bindings, revision, and active pointer
        // share one authoritative mutation fence. A crash before commit leaves
        // only grace-owned orphan bytes.
        return this.config.controlStore.commitPublication(tenant, {
          expectedActiveRevisionId: request.expectedActiveRevisionId,
          revision: {
            id: request.revisionId,
            definitionId: request.definitionId,
            manifest,
            canonicalManifestJson,
            functionDescriptors,
            functionDescriptorsDigestSha256: integrity.functionDescriptorsDigestSha256,
            capabilityContractDigestSha256: build.capabilityContractDigestSha256,
            channelContractDigestSha256: build.channelContractDigestSha256,
            constructionContractDigestSha256: build.constructionContractDigestSha256,
            contractDigestSha256: integrity.contractDigestSha256,
            distributionProvenance: build.distributionProvenance,
            uiArtifact,
            uiRuntime: runtimeDescriptor,
            serverArtifact,
            serverRuntimeAbi: build.serverArtifact?.runtimeAbi ?? null,
            capsuleBuildIdentity: build.capsuleBuildIdentity,
            buildPolicyId: build.buildPolicyId,
            createdAtMs: request.nowMs,
          },
          source: {
            sourceSnapshotId: build.sourceSnapshotId,
            sourceDigestSha256: request.snapshot.digestSha256,
            sourceArtifact,
            builderIdentity: build.builderIdentity,
            createdAtMs: request.nowMs,
          },
          bindings: request.bindings,
          ...('publicationIdentity' in request
            ? { publicationIdentity: request.publicationIdentity }
            : {}),
          nowMs: request.nowMs,
        });
      })
    ));
  }

  getRevision(
    tenant: TTenantContext,
    revisionId: TWidgetRevisionId,
  ): Promise<TWidgetRevisionDescriptor | null> {
    return this.config.controlStore.getRevision(tenant, revisionId);
  }

  getActiveRevision(
    tenant: TTenantContext,
    definitionId: string,
  ): Promise<TWidgetRevisionDescriptor | null> {
    return this.config.controlStore.getActiveRevision(tenant, definitionId);
  }

  getRevisionSource(
    tenant: TTenantContext,
    revisionId: TWidgetRevisionId,
  ): Promise<TWidgetRevisionSourceDescriptor | null> {
    return this.config.controlStore.getRevisionSource(tenant, revisionId);
  }

  rollback(
    tenant: TTenantContext,
    request: TWidgetRollbackInput,
  ): Promise<TWidgetActiveRevisionCasResult> {
    return this.config.controlStore.rollbackPublication(tenant, request);
  }

  archive(
    tenant: TTenantContext,
    request: TWidgetDefinitionArchiveInput,
  ): Promise<TWidgetDefinitionArchiveResult> {
    return this.#operationLane.run(() => (
      this.config.controlStore.archiveDefinition(tenant, request)
    ));
  }
}
