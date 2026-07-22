import { createHash, randomUUID } from 'node:crypto';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetManifestV2,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetManifest,
  fnValidateWidgetBuildIntegrity,
  fnValidateWidgetResourceBindings,
} from '..';
import type {
  IWidgetArtifactBuilder,
  IWidgetArtifactMutationCoordinator,
  IWidgetArtifactStore,
  IWidgetPreviewService,
  IWidgetPreviewStore,
  TWidgetPreviewBuildRequest,
  TWidgetPreviewBuildResult,
  TWidgetPreviewGetRequest,
  TWidgetPreviewRevisionDescriptor,
  TWidgetPreviewRevisionGetRequest,
  TWidgetPreviewStopRequest,
} from '..';
import { fnValidateArtifactDigest } from './fn.artifact-path';
import { WidgetArtifactOperationLane } from './WidgetArtifactOperationLane';
import { WidgetSourceSnapshot } from './WidgetSourceSnapshot';

export type TWidgetPreviewServiceConfig = Readonly<{
  builder: IWidgetArtifactBuilder;
  artifacts: IWidgetArtifactStore;
  previewStore: IWidgetPreviewStore;
  mutationCoordinator: IWidgetArtifactMutationCoordinator;
  createId?: () => string;
  operationLane?: WidgetArtifactOperationLane;
  sourceSnapshots?: WidgetSourceSnapshot;
}>;

function previewError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function validatePreviewWindow(request: TWidgetPreviewBuildRequest): void {
  fnValidateArtifactDigest(request.draftRevisionSha256);
  if (request.draftRevisionSha256 !== request.snapshot.digestSha256) {
    throw previewError(
      'WIDGET_PREVIEW_DRAFT_STALE',
      'Widget preview snapshot does not match the selected immutable draft revision.',
    );
  }
  if (
    !Number.isSafeInteger(request.nowMs)
    || request.nowMs < 0
    || !Number.isSafeInteger(request.retainUntilMs)
    || request.retainUntilMs <= request.nowMs
    || !Number.isSafeInteger(request.expiresAtMs)
    || request.expiresAtMs <= request.nowMs
    || request.retainUntilMs < request.expiresAtMs
  ) throw previewError('WIDGET_PREVIEW_WINDOW_INVALID', 'Widget preview retention window is invalid.');
}

/** Actor-free immutable draft preview build and CAS activation orchestration. */
export class WidgetPreviewService implements IWidgetPreviewService {
  readonly #createId: () => string;
  readonly #operationLane: WidgetArtifactOperationLane;
  readonly #sourceSnapshots: WidgetSourceSnapshot;

  constructor(readonly config: TWidgetPreviewServiceConfig) {
    this.#createId = config.createId ?? randomUUID;
    this.#operationLane = config.operationLane ?? new WidgetArtifactOperationLane();
    this.#sourceSnapshots = config.sourceSnapshots ?? new WidgetSourceSnapshot();
  }

  async buildPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewBuildRequest,
  ): Promise<TWidgetPreviewBuildResult> {
    validatePreviewWindow(request);
    const manifest = ZWidgetManifestV2.parse(request.manifest);
    const bindingValidation = fnValidateWidgetResourceBindings(manifest, request.bindings);
    if (!bindingValidation.valid) {
      throw previewError(
        'WIDGET_RESOURCE_BINDINGS_INVALID',
        bindingValidation.slot === undefined
          ? `Widget resource bindings are invalid: ${bindingValidation.reason}.`
          : `Widget resource binding '${bindingValidation.slot}' is invalid: ${bindingValidation.reason}.`,
      );
    }
    const canonicalManifestJson = fnCanonicalizeWidgetManifest(manifest);
    const build = await this.config.builder.build(tenant, {
      snapshot: request.snapshot,
      manifest,
      canonicalManifestJson,
      builderIdentity: request.builderIdentity,
    });
    const parsedDescriptors = ZWidgetServerFunctionDescriptors.safeParse(build.functionDescriptors);
    if (!parsedDescriptors.success) {
      throw previewError(
        'WIDGET_BUILD_INTEGRITY_FAILED',
        'Widget builder returned malformed server-function descriptors.',
      );
    }
    const integrity = fnValidateWidgetBuildIntegrity({
      snapshot: request.snapshot,
      manifest,
      canonicalManifestJson,
      builderIdentity: request.builderIdentity,
      build: { ...build, functionDescriptors: parsedDescriptors.data },
      digestSha256: (value) => createHash('sha256').update(value).digest('hex'),
    });
    if (!integrity.valid) {
      throw previewError(
        'WIDGET_BUILD_INTEGRITY_FAILED',
        `Widget builder integrity check failed: ${integrity.reason}.`,
      );
    }
    const sourceArtifactBytes = this.#sourceSnapshots.encodeArtifact(request.snapshot, {
      builderIdentity: request.builderIdentity,
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

        return this.config.previewStore.commitPreview(tenant, {
          expectedActiveRevisionId: request.expectedActiveRevisionId,
          revision: {
            id: request.revisionId,
            previewId: request.previewId,
            draftId: request.draftId,
            definitionId: request.definitionId,
            draftRevisionSha256: request.draftRevisionSha256,
            sourceSnapshotId: request.snapshot.id,
            sourceDigestSha256: request.snapshot.digestSha256,
            sourceArtifact,
            manifest,
            canonicalManifestJson,
            functionDescriptors: parsedDescriptors.data,
            functionDescriptorsDigestSha256: integrity.functionDescriptorsDigestSha256,
            contractDigestSha256: integrity.contractDigestSha256,
            builderIdentity: request.builderIdentity,
            uiArtifact,
            serverArtifact,
            createdAtMs: request.nowMs,
            retainUntilMs: request.retainUntilMs,
            expiresAtMs: request.expiresAtMs,
          },
          bindings: request.bindings,
          nowMs: request.nowMs,
        });
      })
    ));
  }

  getPreview(
    tenant: TTenantContext,
    request: TWidgetPreviewGetRequest,
  ): Promise<TWidgetPreviewRevisionDescriptor | null> {
    return this.config.previewStore.getPreview(tenant, request);
  }

  getPreviewRevision(
    tenant: TTenantContext,
    request: TWidgetPreviewRevisionGetRequest,
  ): Promise<TWidgetPreviewRevisionDescriptor | null> {
    return this.config.previewStore.getPreviewRevision(tenant, request);
  }

  stopPreview(tenant: TTenantContext, request: TWidgetPreviewStopRequest): Promise<boolean> {
    return this.config.previewStore.stopPreview(tenant, request);
  }
}
