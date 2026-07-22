import { createHash, randomUUID } from 'node:crypto';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetManifestV2,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetManifest,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnValidateWidgetServerFunctionDescriptors,
  fnValidateWidgetResourceBindings,
  type IWidgetArtifactBuilder,
  type IWidgetArtifactMutationCoordinator,
  type IWidgetArtifactStore,
  type IWidgetControlStore,
  type IWidgetPublicationService,
  type TWidgetActiveRevisionCasResult,
  type TWidgetPublishRequest,
  type TWidgetPublishResult,
  type TWidgetRevisionDescriptor,
  type TWidgetRevisionId,
  type TWidgetRollbackInput,
} from '..';
import { WidgetArtifactOperationLane } from './WidgetArtifactOperationLane';

export type TWidgetPublicationServiceConfig = Readonly<{
  builder: IWidgetArtifactBuilder;
  artifacts: IWidgetArtifactStore;
  controlStore: IWidgetControlStore;
  mutationCoordinator: IWidgetArtifactMutationCoordinator;
  createId?: () => string;
  operationLane?: WidgetArtifactOperationLane;
}>;

function invalidBindings(reason: string, slot?: string): Error {
  return Object.assign(new Error(
    slot === undefined
      ? `Widget resource bindings are invalid: ${reason}.`
      : `Widget resource binding '${slot}' is invalid: ${reason}.`,
  ), { code: 'WIDGET_RESOURCE_BINDINGS_INVALID' });
}

/** Actor-free build-and-commit orchestration for immutable v2 widget revisions. */
export class WidgetPublicationService implements IWidgetPublicationService {
  readonly #createId: () => string;
  readonly #operationLane: WidgetArtifactOperationLane;

  constructor(readonly config: TWidgetPublicationServiceConfig) {
    this.#createId = config.createId ?? randomUUID;
    this.#operationLane = config.operationLane ?? new WidgetArtifactOperationLane();
  }

  async publish(
    tenant: TTenantContext,
    request: TWidgetPublishRequest,
  ): Promise<TWidgetPublishResult> {
    const manifest = ZWidgetManifestV2.parse(request.manifest);
    const bindingValidation = fnValidateWidgetResourceBindings(manifest, request.bindings);
    if (!bindingValidation.valid) {
      throw invalidBindings(bindingValidation.reason, bindingValidation.slot);
    }
    const canonicalManifestJson = fnCanonicalizeWidgetManifest(manifest);

    // All build targets finish before any durable metadata is mutated.
    const build = await this.config.builder.build(tenant, {
      snapshot: request.snapshot,
      manifest,
      canonicalManifestJson,
      builderIdentity: request.builderIdentity,
    });
    if (
      build.sourceSnapshotId !== request.snapshot.id
      || build.sourceDigestSha256 !== request.snapshot.digestSha256
      || build.canonicalManifestJson !== canonicalManifestJson
      || build.builderIdentity !== request.builderIdentity
    ) {
      throw Object.assign(new Error('Widget builder returned a result for different immutable inputs.'), {
        code: 'WIDGET_BUILD_INTEGRITY_FAILED',
      });
    }
    if (
      build.uiArtifact.kind !== 'ui'
      || (manifest.server === undefined) !== (build.serverArtifact === null)
      || (build.serverArtifact !== null && build.serverArtifact.kind !== 'server')
    ) {
      throw Object.assign(new Error('Widget builder returned an artifact set inconsistent with the manifest.'), {
        code: 'WIDGET_BUILD_INTEGRITY_FAILED',
      });
    }
    const parsedFunctionDescriptors = ZWidgetServerFunctionDescriptors.safeParse(
      build.functionDescriptors,
    );
    if (!parsedFunctionDescriptors.success) {
      throw Object.assign(new Error('Widget builder returned malformed server-function descriptors.'), {
        code: 'WIDGET_BUILD_INTEGRITY_FAILED',
      });
    }
    const functionDescriptors = parsedFunctionDescriptors.data;
    const functionValidation = fnValidateWidgetServerFunctionDescriptors(manifest, functionDescriptors);
    if (!functionValidation.valid) {
      throw Object.assign(new Error('Widget builder returned invalid server-function descriptors.'), {
        code: 'WIDGET_BUILD_INTEGRITY_FAILED',
      });
    }
    const expectedFunctionDescriptorsDigestSha256 = createHash('sha256')
      .update(fnCanonicalizeWidgetServerFunctionDescriptors(functionDescriptors))
      .digest('hex');
    if (build.functionDescriptorsDigestSha256 !== expectedFunctionDescriptorsDigestSha256) {
      throw Object.assign(new Error('Widget builder returned an invalid function descriptor digest.'), {
        code: 'WIDGET_BUILD_INTEGRITY_FAILED',
      });
    }
    const expectedContractDigestSha256 = createHash('sha256')
      .update(fnCanonicalizeWidgetContractPayload({
        canonicalManifestJson,
        uiDigestSha256: build.uiArtifact.digestSha256,
        serverDigestSha256: build.serverArtifact?.digestSha256 ?? null,
        runtimeAbi: manifest.server?.runtimeAbi ?? null,
        functionDescriptorsDigestSha256: expectedFunctionDescriptorsDigestSha256,
      }))
      .digest('hex');
    if (build.contractDigestSha256 !== expectedContractDigestSha256) {
      throw Object.assign(new Error('Widget builder returned an invalid contract digest.'), {
        code: 'WIDGET_BUILD_INTEGRITY_FAILED',
      });
    }

    return this.#operationLane.run(() => (
      this.config.mutationCoordinator.runArtifactMutation(tenant, async () => {
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
            functionDescriptorsDigestSha256: expectedFunctionDescriptorsDigestSha256,
            contractDigestSha256: expectedContractDigestSha256,
            uiArtifact,
            serverArtifact,
            createdAtMs: request.nowMs,
          },
          bindings: request.bindings,
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

  rollback(
    tenant: TTenantContext,
    request: TWidgetRollbackInput,
  ): Promise<TWidgetActiveRevisionCasResult> {
    return this.config.controlStore.rollbackPublication(tenant, request);
  }
}
