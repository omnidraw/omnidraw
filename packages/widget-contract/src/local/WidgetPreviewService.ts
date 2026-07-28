import { createHash, randomUUID } from 'node:crypto';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetCapsuleRuntimeDescriptor,
  ZWidgetManifestV3,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetManifest,
  fnNormalizeWidgetBuildDiagnostics,
  fnValidateWidgetBuildIntegrity,
  fnWidgetPreviewBindingPlanDigest,
} from '..';
import type {
  IWidgetArtifactBuilder,
  IWidgetArtifactConstructionBuilder,
  IWidgetArtifactMutationCoordinator,
  IWidgetArtifactStore,
  IWidgetDurablePreviewService,
  IWidgetPreviewConstructionReader,
  IWidgetPreviewStore,
  IWidgetPreviewWorkspaceService,
  TWidgetArtifactConstructionResult,
  TWidgetArtifactDescriptor,
  TWidgetBuildDiagnostic,
  TWidgetBuildResult,
  TWidgetDiagnostic,
  TWidgetPreviewBuildRequest,
  TWidgetPreviewBuildResult,
  TWidgetPreviewGetRequest,
  TWidgetPreviewRevisionDescriptor,
  TWidgetPreviewRevisionGetRequest,
  TWidgetPreviewWorkspaceCloseRequest,
} from '..';
import { fnValidateArtifactDigest } from './fn.artifact-path';
import { WidgetArtifactOperationLane } from './WidgetArtifactOperationLane';

export type TWidgetPreviewServiceConfig = Readonly<{
  builder: IWidgetArtifactBuilder;
  constructionBuilder?: IWidgetArtifactConstructionBuilder;
  artifacts?: IWidgetArtifactStore;
  previewStore?: IWidgetPreviewStore;
  mutationCoordinator?: IWidgetArtifactMutationCoordinator;
  readArtifactBytes?: (
    tenant: TTenantContext,
    artifact: TWidgetArtifactDescriptor,
  ) => Promise<Uint8Array | null>;
  createId?: () => string;
  operationLane?: WidgetArtifactOperationLane;
}>;

type TValidatedBuild = Readonly<{
  build: TWidgetBuildResult;
  manifest: ReturnType<typeof ZWidgetManifestV3.parse>;
  construction: TWidgetArtifactConstructionResult | null;
}>;

function previewError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function digest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildDiagnostics(
  diagnostics: TWidgetPreviewRevisionDescriptor['diagnostics'],
): readonly TWidgetBuildDiagnostic[] {
  return Object.freeze(diagnostics.map((item) => Object.freeze({
    severity: item.severity,
    code: item.code,
    message: item.message,
    ...(item.file === undefined ? {} : { path: item.file.replace(/^widget:\/\//, '') }),
    ...(item.line === undefined ? {} : { line: item.line }),
    ...(item.column === undefined ? {} : { column: item.column }),
  })));
}

/**
 * Constructs Preview bytes once, signs them with Preview authority, and
 * optionally commits an immutable frame-owned revision. The stateless path is
 * retained only for compatibility with internal callers that have not supplied
 * an owner identity.
 */
export class WidgetPreviewService
implements
  IWidgetDurablePreviewService,
  IWidgetPreviewConstructionReader,
  IWidgetPreviewWorkspaceService {
  readonly #constructionBuilder: IWidgetArtifactConstructionBuilder | null;
  readonly #createId: () => string;
  readonly #operationLane: WidgetArtifactOperationLane;

  constructor(readonly config: TWidgetPreviewServiceConfig) {
    this.#constructionBuilder = config.constructionBuilder
      ?? (
        'construct' in config.builder && 'signConstruction' in config.builder
          ? config.builder as IWidgetArtifactConstructionBuilder
          : null
      );
    this.#createId = config.createId ?? randomUUID;
    this.#operationLane = config.operationLane ?? new WidgetArtifactOperationLane();
    const durableParts = [
      config.artifacts,
      config.previewStore,
      config.mutationCoordinator,
      config.readArtifactBytes,
    ].filter((value) => value !== undefined).length;
    if (durableParts !== 0 && durableParts !== 4) {
      throw new TypeError(
        'Durable Preview storage must configure metadata, artifacts, mutation coordination, and byte reads.',
      );
    }
  }

  async buildPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewBuildRequest,
  ): Promise<TWidgetPreviewBuildResult> {
    fnValidateArtifactDigest(request.draftRevisionSha256);
    if (
      request.committedMutationId.trim().length < 1
      || request.committedMutationId.length > 1_024
    ) {
      throw previewError(
        'WIDGET_PREVIEW_MUTATION_INVALID',
        'Widget preview committed mutation identity is invalid.',
      );
    }
    if (request.draftRevisionSha256 !== request.snapshot.digestSha256) {
      throw previewError(
        'WIDGET_PREVIEW_DRAFT_STALE',
        'Widget preview snapshot does not match the current draft revision.',
      );
    }
    const manifest = ZWidgetManifestV3.parse(request.manifest);
    const canonicalManifestJson = fnCanonicalizeWidgetManifest(manifest);
    const validated = await this.#constructAndValidate(
      tenant,
      request,
      manifest,
      canonicalManifestJson,
    );

    const durableRequested = request.previewId !== undefined
      || request.previewRevisionId !== undefined
      || request.buildSequence !== undefined
      || request.bindingRevision !== undefined
      || request.nowMs !== undefined
      || request.expectedActiveRevisionId !== undefined;
    if (!durableRequested) {
      return this.#result(request, validated.build, manifest, null);
    }
    const durable = this.#durableRequest(request);
    if (
      this.config.artifacts === undefined
      || this.config.previewStore === undefined
      || this.config.mutationCoordinator === undefined
      || this.config.readArtifactBytes === undefined
      || validated.construction === null
    ) {
      throw previewError(
        'WIDGET_PREVIEW_DURABILITY_UNAVAILABLE',
        'Durable Preview storage is not configured.',
      );
    }

    const construction = validated.construction;
    const bindings = request.bindings ?? [];
    const bindingPlanDigestSha256 = fnWidgetPreviewBindingPlanDigest({
      bindings,
      digestSha256: digest,
    });
    const normalizedDiagnostics = fnNormalizeWidgetBuildDiagnostics({
      diagnostics: validated.build.diagnostics,
      draftRevision: request.draftRevisionSha256,
      previewRevisionId: durable.previewRevisionId,
      buildId: durable.previewRevisionId,
      buildSequence: durable.buildSequence,
      timestampMs: durable.nowMs,
      digestSha256: digest,
    });
    const committed = await this.#operationLane.run(() =>
      this.config.mutationCoordinator!.runArtifactMutation(tenant, async () => {
        const sourceArtifact = await this.config.artifacts!.putArtifact(tenant, {
          id: this.#createId(),
          kind: 'source',
          digestSha256: construction.sourceArtifact.digestSha256,
          bytes: construction.sourceArtifact.bytes,
          retentionState: 'pinned',
          retainUntilMs: null,
          createdAtMs: durable.nowMs,
        });
        const unsignedUiArtifact = await this.config.artifacts!.putArtifact(tenant, {
          id: this.#createId(),
          kind: 'unsigned_ui',
          digestSha256: construction.uiArtifact.digestSha256,
          bytes: construction.uiArtifact.unsignedBytes,
          retentionState: 'pinned',
          retainUntilMs: null,
          createdAtMs: durable.nowMs,
        });
        const uiArtifact = await this.config.artifacts!.putArtifact(tenant, {
          id: this.#createId(),
          kind: 'ui',
          digestSha256: validated.build.uiArtifact.digestSha256,
          bytes: validated.build.uiArtifact.bytes,
          retentionState: 'pinned',
          retainUntilMs: null,
          createdAtMs: durable.nowMs,
        });
        const serverArtifact = construction.serverArtifact === null
          ? null
          : await this.config.artifacts!.putArtifact(tenant, {
              id: this.#createId(),
              kind: 'server',
              digestSha256: construction.serverArtifact.digestSha256,
              bytes: construction.serverArtifact.bytes,
              retentionState: 'pinned',
              retainUntilMs: null,
              createdAtMs: durable.nowMs,
            });
        const commit = await this.config.previewStore!.commitPreview(tenant, {
          expectedActiveRevisionId: durable.expectedActiveRevisionId,
          expectedBuildSequence: durable.buildSequence,
          revision: {
            id: durable.previewRevisionId,
            previewId: durable.previewId,
            draftId: request.draftId,
            definitionId: request.definitionId,
            draftRevisionSha256: request.draftRevisionSha256,
            committedMutationId: request.committedMutationId,
            sourceSnapshotId: request.snapshot.id,
            sourceDigestSha256: request.snapshot.digestSha256,
            sourceArtifact,
            manifest,
            canonicalManifestJson,
            functionDescriptors: validated.build.functionDescriptors,
            functionDescriptorsDigestSha256:
              validated.build.functionDescriptorsDigestSha256,
            capabilityContractDigestSha256:
              validated.build.capabilityContractDigestSha256,
            channelContractDigestSha256:
              validated.build.channelContractDigestSha256,
            constructionContractDigestSha256:
              construction.constructionContractDigestSha256,
            previewContractDigestSha256: validated.build.contractDigestSha256,
            builderIdentity: construction.builderIdentity,
            capsuleBuildIdentity: construction.capsuleBuildIdentity,
            buildPolicyId: construction.buildPolicyId,
            distributionProvenance: construction.distributionProvenance,
            unsignedUiArtifact,
            uiArtifact,
            uiRuntime: validated.build.uiArtifact.runtimeDescriptor,
            serverArtifact,
            serverRuntimeAbi: construction.serverArtifact?.runtimeAbi ?? null,
            bindingRevision: durable.bindingRevision,
            bindingPlanDigestSha256,
            buildSequence: durable.buildSequence,
            diagnostics: normalizedDiagnostics,
            createdAtMs: durable.nowMs,
          },
          bindings,
          nowMs: durable.nowMs,
        });
        if (commit.status === 'conflict') {
          throw previewError(
            'WIDGET_PREVIEW_CONFLICT',
            'Preview changed before the built revision could become active.',
          );
        }
        return commit;
      }));
    return this.#result(request, validated.build, manifest, committed.revision);
  }

  async loadPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewGetRequest,
  ): Promise<TWidgetPreviewBuildResult | null> {
    const revision = await this.config.previewStore?.getPreview(tenant, request) ?? null;
    return revision === null ? null : this.#rehydrateResult(tenant, revision);
  }

  async loadPreviewRevision(
    tenant: TTenantContext,
    request: TWidgetPreviewRevisionGetRequest,
  ): Promise<TWidgetPreviewBuildResult | null> {
    const revision = await this.config.previewStore?.getPreviewRevision(tenant, request) ?? null;
    return revision === null ? null : this.#rehydrateResult(tenant, revision);
  }

  async readPreviewConstruction(
    tenant: TTenantContext,
    request: TWidgetPreviewRevisionGetRequest,
  ): Promise<TWidgetArtifactConstructionResult | null> {
    const revision = await this.config.previewStore?.getPreviewRevision(tenant, request) ?? null;
    if (revision === null || this.config.readArtifactBytes === undefined) return null;
    const [sourceBytes, unsignedBytes, serverBytes] = await Promise.all([
      this.config.readArtifactBytes(tenant, revision.sourceArtifact),
      this.config.readArtifactBytes(tenant, revision.unsignedUiArtifact),
      revision.serverArtifact === null
        ? Promise.resolve(null)
        : this.config.readArtifactBytes(tenant, revision.serverArtifact),
    ]);
    if (
      sourceBytes === null
      || unsignedBytes === null
      || (revision.serverArtifact !== null && serverBytes === null)
      || digest(sourceBytes) !== revision.sourceArtifact.digestSha256
      || digest(unsignedBytes) !== revision.unsignedUiArtifact.digestSha256
      || (
        revision.serverArtifact !== null
        && serverBytes !== null
        && digest(serverBytes) !== revision.serverArtifact.digestSha256
      )
    ) {
      throw previewError(
        'WIDGET_PREVIEW_ARTIFACT_INVALID',
        'A retained Preview construction artifact failed integrity verification.',
      );
    }
    const { signatureKeyIds: _signatureKeyIds, ...unsignedRuntime } = revision.uiRuntime;
    return Object.freeze({
      sourceSnapshotId: revision.sourceSnapshotId,
      sourceDigestSha256: revision.sourceDigestSha256,
      sourceArtifact: Object.freeze({
        kind: 'source' as const,
        digestSha256: revision.sourceArtifact.digestSha256,
        bytes: sourceBytes,
      }),
      builderIdentity: revision.builderIdentity,
      capsuleBuildIdentity: revision.capsuleBuildIdentity,
      buildPolicyId: revision.buildPolicyId,
      canonicalManifestJson: revision.canonicalManifestJson,
      distributionProvenance: revision.distributionProvenance,
      functionDescriptors: revision.functionDescriptors,
      functionDescriptorsDigestSha256: revision.functionDescriptorsDigestSha256,
      capabilityContractDigestSha256: revision.capabilityContractDigestSha256,
      channelContractDigestSha256: revision.channelContractDigestSha256,
      constructionContractDigestSha256: revision.constructionContractDigestSha256,
      uiArtifact: Object.freeze({
        kind: 'unsigned-ui' as const,
        digestSha256: revision.unsignedUiArtifact.digestSha256,
        unsignedBytes,
        capsuleArtifactHash: revision.uiRuntime.capsuleArtifactHash,
        runtimeDescriptor: Object.freeze(unsignedRuntime),
        requestedBudgets: revision.manifest.ui.budgets ?? {},
        effectiveBudgets: revision.uiRuntime.budgets,
        builderIdentity: revision.builderIdentity,
        capsuleBuildIdentity: revision.capsuleBuildIdentity,
      }),
      serverArtifact: revision.serverArtifact === null || serverBytes === null
        ? null
        : Object.freeze({
            kind: 'server' as const,
            digestSha256: revision.serverArtifact.digestSha256,
            bytes: serverBytes,
            runtimeAbi: revision.serverRuntimeAbi!,
          }),
      diagnostics: buildDiagnostics(revision.diagnostics),
    });
  }

  async closePreviewWorkspace(
    tenant: TTenantContext,
    request: TWidgetPreviewWorkspaceCloseRequest,
  ): Promise<void> {
    await this.#constructionBuilder?.closeWorkspace?.(tenant, {
      workspaceKey: this.#workspaceKey(tenant, request.draftId),
    });
  }

  async #constructAndValidate(
    tenant: TTenantContext,
    request: TWidgetPreviewBuildRequest,
    manifest: ReturnType<typeof ZWidgetManifestV3.parse>,
    canonicalManifestJson: string,
  ): Promise<TValidatedBuild> {
    const construction = this.#constructionBuilder === null
      ? null
      : await this.#constructionBuilder.construct(tenant, {
          snapshot: request.snapshot,
          manifest,
          canonicalManifestJson,
          builderIdentity: request.builderIdentity,
          capsuleBuildIdentity: request.capsuleBuildIdentity,
          buildPolicyId: request.buildPolicyId,
          ...(request.previewId === undefined
            ? {}
            : { workspaceKey: this.#workspaceKey(tenant, request.draftId) }),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          ...(request.reportProgress === undefined
            ? {}
            : { reportProgress: request.reportProgress }),
        });
    const build = construction === null
      ? await this.config.builder.build(tenant, {
          snapshot: request.snapshot,
          manifest,
          canonicalManifestJson,
          builderIdentity: request.builderIdentity,
          capsuleBuildIdentity: request.capsuleBuildIdentity,
          buildPolicyId: request.buildPolicyId,
          signingPurpose: 'preview',
        })
      : await this.#constructionBuilder!.signConstruction(tenant, {
          construction,
          signingPurpose: 'preview',
        });
    const parsedDescriptors = ZWidgetServerFunctionDescriptors.safeParse(
      build.functionDescriptors,
    );
    if (!parsedDescriptors.success) {
      throw previewError(
        'WIDGET_BUILD_INTEGRITY_FAILED',
        'Widget builder returned malformed server-function descriptors.',
      );
    }
    const runtimeDescriptor = ZWidgetCapsuleRuntimeDescriptor.parse(
      build.uiArtifact.runtimeDescriptor,
    );
    const normalizedBuild = Object.freeze({
      ...build,
      functionDescriptors: parsedDescriptors.data,
      uiArtifact: Object.freeze({ ...build.uiArtifact, runtimeDescriptor }),
    });
    const integrity = fnValidateWidgetBuildIntegrity({
      snapshot: request.snapshot,
      manifest,
      canonicalManifestJson,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      buildPolicyId: request.buildPolicyId,
      build: normalizedBuild,
      digestSha256: digest,
    });
    if (!integrity.valid) {
      throw previewError(
        'WIDGET_BUILD_INTEGRITY_FAILED',
        `Widget builder integrity check failed: ${integrity.reason}.`,
      );
    }
    return Object.freeze({ build: normalizedBuild, manifest, construction });
  }

  #workspaceKey(tenant: TTenantContext, draftId: string): string {
    return `preview-${digest(JSON.stringify({
      orgId: tenant.orgId,
      accountId: tenant.accountId,
      cellId: tenant.cellId,
      placementEpoch: tenant.placementEpoch,
      draftId,
    }))}`;
  }

  #durableRequest(request: TWidgetPreviewBuildRequest): Readonly<{
    previewId: string;
    previewRevisionId: string;
    expectedActiveRevisionId: string | null;
    buildSequence: number;
    bindingRevision: number;
    nowMs: number;
  }> {
    if (
      request.previewId === undefined
      || request.previewId.trim().length < 1
      || request.previewRevisionId === undefined
      || request.previewRevisionId.trim().length < 1
      || request.expectedActiveRevisionId === undefined
      || request.buildSequence === undefined
      || !Number.isSafeInteger(request.buildSequence)
      || request.buildSequence < 1
      || request.bindingRevision === undefined
      || !Number.isSafeInteger(request.bindingRevision)
      || request.bindingRevision < 0
      || request.nowMs === undefined
      || !Number.isSafeInteger(request.nowMs)
      || request.nowMs < 0
    ) {
      throw previewError(
        'WIDGET_PREVIEW_OWNER_INVALID',
        'Durable Preview build identity is incomplete.',
      );
    }
    return Object.freeze({
      previewId: request.previewId,
      previewRevisionId: request.previewRevisionId,
      expectedActiveRevisionId: request.expectedActiveRevisionId,
      buildSequence: request.buildSequence,
      bindingRevision: request.bindingRevision,
      nowMs: request.nowMs,
    });
  }

  #result(
    request: TWidgetPreviewBuildRequest,
    build: TWidgetBuildResult,
    manifest: ReturnType<typeof ZWidgetManifestV3.parse>,
    revision: TWidgetPreviewRevisionDescriptor | null,
  ): TWidgetPreviewBuildResult {
    const normalizedDiagnostics: readonly TWidgetDiagnostic[] = revision?.diagnostics
      ?? fnNormalizeWidgetBuildDiagnostics({
        diagnostics: build.diagnostics,
        draftRevision: request.draftRevisionSha256,
        previewRevisionId: null,
        buildId: request.snapshot.id,
        buildSequence: 1,
        timestampMs: request.snapshot.createdAtMs,
        digestSha256: digest,
      });
    return Object.freeze({
      draftId: request.draftId,
      definitionId: request.definitionId,
      draftRevisionSha256: request.draftRevisionSha256,
      committedMutationId: request.committedMutationId,
      manifest,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      buildPolicyId: request.buildPolicyId,
      uiArtifact: Object.freeze(build.uiArtifact),
      functionDescriptors: build.functionDescriptors,
      functionDescriptorsDigestSha256: build.functionDescriptorsDigestSha256,
      capabilityContractDigestSha256: build.capabilityContractDigestSha256,
      channelContractDigestSha256: build.channelContractDigestSha256,
      contractDigestSha256: build.contractDigestSha256,
      diagnostics: build.diagnostics,
      normalizedDiagnostics,
      previewId: revision?.previewId ?? null,
      previewRevisionId: revision?.id ?? null,
      buildSequence: revision?.buildSequence ?? null,
      bindingRevision: revision?.bindingRevision ?? null,
      bindingPlanDigestSha256: revision?.bindingPlanDigestSha256 ?? null,
    });
  }

  async #rehydrateResult(
    tenant: TTenantContext,
    revision: TWidgetPreviewRevisionDescriptor,
  ): Promise<TWidgetPreviewBuildResult> {
    if (this.config.readArtifactBytes === undefined) {
      throw previewError(
        'WIDGET_PREVIEW_DURABILITY_UNAVAILABLE',
        'Durable Preview byte storage is not configured.',
      );
    }
    const bytes = await this.config.readArtifactBytes(tenant, revision.uiArtifact);
    if (
      bytes === null
      || bytes.byteLength !== revision.uiArtifact.byteSize
      || digest(bytes) !== revision.uiArtifact.digestSha256
    ) {
      throw previewError(
        'WIDGET_PREVIEW_ARTIFACT_INVALID',
        'The retained Preview UI artifact failed integrity verification.',
      );
    }
    return Object.freeze({
      draftId: revision.draftId,
      definitionId: revision.definitionId,
      draftRevisionSha256: revision.draftRevisionSha256,
      committedMutationId: revision.committedMutationId,
      manifest: revision.manifest,
      builderIdentity: revision.builderIdentity,
      capsuleBuildIdentity: revision.capsuleBuildIdentity,
      buildPolicyId: revision.buildPolicyId,
      uiArtifact: Object.freeze({
        kind: 'ui' as const,
        digestSha256: revision.uiArtifact.digestSha256,
        bytes,
        capsuleArtifactHash: revision.uiRuntime.capsuleArtifactHash,
        runtimeDescriptor: revision.uiRuntime,
        requestedBudgets: revision.manifest.ui.budgets ?? {},
        effectiveBudgets: revision.uiRuntime.budgets,
        builderIdentity: revision.builderIdentity,
        capsuleBuildIdentity: revision.capsuleBuildIdentity,
      }),
      functionDescriptors: revision.functionDescriptors,
      functionDescriptorsDigestSha256: revision.functionDescriptorsDigestSha256,
      capabilityContractDigestSha256: revision.capabilityContractDigestSha256,
      channelContractDigestSha256: revision.channelContractDigestSha256,
      contractDigestSha256: revision.previewContractDigestSha256,
      diagnostics: buildDiagnostics(revision.diagnostics),
      normalizedDiagnostics: revision.diagnostics,
      previewId: revision.previewId,
      previewRevisionId: revision.id,
      buildSequence: revision.buildSequence,
      bindingRevision: revision.bindingRevision,
      bindingPlanDigestSha256: revision.bindingPlanDigestSha256,
    });
  }
}
