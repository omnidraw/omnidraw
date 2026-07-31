import { createHash } from 'node:crypto';
import { ORPCError } from '@orpc/contract';
import {
  fnReadCanvasWidgetExtension,
  type TCanvasItemSnapshot,
} from '@omnidraw/canvas-contract';
import {
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnProjectWidgetBrowserFunctionDescriptors,
  fnValidateWidgetServerFunctionDescriptors,
  fnWidgetServerFunctionCapabilityRequestMatches,
  type TWidgetBrowserFunctionDescriptor,
  type TWidgetRevisionDescriptor,
} from '@omnidraw/widget-contract';
import {
  WIDGET_RUNTIME_LOAD_CANCELLED_ERROR_CODE,
  WIDGET_RUNTIME_LOAD_CAPACITY_ERROR_CODE,
  WIDGET_RUNTIME_LOAD_TIMEOUT_ERROR_CODE,
} from './CONSTANTS';
import { baseWidgetOs } from './orpc';

const BROWSER_ARTIFACT_CAPABILITY_TTL_MS = 60_000;

function widgetItemMatchesTarget(
  item: TCanvasItemSnapshot | undefined,
  target: Readonly<{
    elementId: string;
    widgetInstanceId: string;
    definitionId: string;
    revisionId: string;
  }>,
): boolean {
  if (!item || item.id !== target.elementId) return false;
  const extension = fnReadCanvasWidgetExtension(item.item);
  return extension?.type === 'widget-instance'
    && extension.instanceId === target.widgetInstanceId
    && extension.definitionId === target.definitionId
    && extension.revisionId === target.revisionId;
}

function revisionMatchesTarget(
  revision: TWidgetRevisionDescriptor | null,
  target: Readonly<{
    orgId: string;
    definitionId: string;
    revisionId: string;
  }>,
): revision is TWidgetRevisionDescriptor {
  return revision !== null
    && revision.orgId === target.orgId
    && revision.id === target.revisionId
    && revision.definitionId === target.definitionId
    && revision.uiArtifact.orgId === target.orgId
    && revision.uiArtifact.kind === 'ui';
}

function revisionArtifactBindingMatches(
  left: TWidgetRevisionDescriptor,
  right: TWidgetRevisionDescriptor,
): boolean {
  return left.uiArtifact.id === right.uiArtifact.id
    && left.uiArtifact.digestSha256 === right.uiArtifact.digestSha256
    && left.uiArtifact.byteSize === right.uiArtifact.byteSize
    && left.contractDigestSha256 === right.contractDigestSha256
    && left.uiRuntime.capsuleArtifactHash === right.uiRuntime.capsuleArtifactHash
    && JSON.stringify(left.uiRuntime) === JSON.stringify(right.uiRuntime);
}

function runtimeBrowserFunctionContract(
  revision: TWidgetRevisionDescriptor,
): Readonly<{
  descriptors: readonly TWidgetBrowserFunctionDescriptor[];
  digestSha256: string;
}> {
  const serverDescriptors = ZWidgetServerFunctionDescriptors.parse(
    revision.functionDescriptors,
  );
  const validation = fnValidateWidgetServerFunctionDescriptors(
    revision.manifest,
    serverDescriptors,
  );
  if (!validation.valid) {
    throw new Error('Persisted widget server-function descriptors are invalid.');
  }

  const persistedDigestSha256 = createHash('sha256')
    .update(fnCanonicalizeWidgetServerFunctionDescriptors(serverDescriptors))
    .digest('hex');
  if (persistedDigestSha256 !== revision.functionDescriptorsDigestSha256) {
    throw new Error('Persisted widget server-function descriptor digest mismatch.');
  }

  const descriptors = fnProjectWidgetBrowserFunctionDescriptors(serverDescriptors);
  const digestSha256 = createHash('sha256')
    .update(fnCanonicalizeWidgetBrowserFunctionDescriptors(descriptors))
    .digest('hex');
  if (!fnWidgetServerFunctionCapabilityRequestMatches(
    digestSha256,
    descriptors,
    revision.uiRuntime.capabilityRequests,
  )) {
    throw new Error('Widget server-function descriptors do not match the signed runtime request.');
  }
  return Object.freeze({
    descriptors,
    digestSha256,
  });
}

function runtimeTargetNotFound(): ORPCError<'NOT_FOUND', unknown> {
  return new ORPCError('NOT_FOUND', { message: 'Widget runtime target not found.' });
}

function runtimeOperationFailed(): ORPCError<'INTERNAL_SERVER_ERROR', unknown> {
  return new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Widget runtime operation failed.' });
}

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

function assertRuntimeLoadActive(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (
    signal.reason instanceof Error
    && (
      errorCode(signal.reason) === WIDGET_RUNTIME_LOAD_CANCELLED_ERROR_CODE
      || errorCode(signal.reason) === WIDGET_RUNTIME_LOAD_TIMEOUT_ERROR_CODE
    )
  ) throw signal.reason;
  throw Object.assign(new Error('Widget runtime load was cancelled.'), {
    code: WIDGET_RUNTIME_LOAD_CANCELLED_ERROR_CODE,
  });
}

async function runtimeLoadStep<TResult>(
  signal: AbortSignal,
  operation: () => Promise<TResult>,
): Promise<TResult> {
  assertRuntimeLoadActive(signal);
  const result = await operation();
  assertRuntimeLoadActive(signal);
  return result;
}

function throwRuntimeLoadError(error: unknown): never {
  const code = errorCode(error);
  if (code === WIDGET_RUNTIME_LOAD_CAPACITY_ERROR_CODE) {
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: 'Widget runtime load capacity is exhausted.',
    });
  }
  if (code === WIDGET_RUNTIME_LOAD_CANCELLED_ERROR_CODE) {
    throw new ORPCError('CLIENT_CLOSED_REQUEST', {
      message: 'Widget runtime load was cancelled.',
    });
  }
  if (code === WIDGET_RUNTIME_LOAD_TIMEOUT_ERROR_CODE) {
    throw new ORPCError('TIMEOUT', {
      message: 'Widget runtime load exceeded its host deadline.',
    });
  }
  if (
    (error instanceof ORPCError && error.code === 'NOT_FOUND')
    || code === 'WIDGET_ARTIFACT_NOT_FOUND'
  ) {
    throw runtimeTargetNotFound();
  }
  throw runtimeOperationFailed();
}

const apiWidgetRuntimeLoad = baseWidgetOs.runtime.load.handler(async ({ input, context, signal }) => {
  try {
    return await context.widgetRuntimeLoadAdmission.run(
      context.tenant,
      signal,
      async (lifetimeSignal) => {
        if (context.tenant.canvasId !== undefined && context.tenant.canvasId !== input.canvasId) {
          throw runtimeTargetNotFound();
        }
        const readWidgetItem = async (): Promise<TCanvasItemSnapshot> => {
          const page = await runtimeLoadStep(lifetimeSignal, () => (
            context.canvas.queryItems(context.tenant, {
              canvasId: input.canvasId,
              filter: {
                type: 'widget-instance',
                instanceId: input.widgetInstanceId,
              },
              limit: 2,
            })
          ));
          const item = page.items.find((candidate) => candidate.id === input.elementId);
          if (!widgetItemMatchesTarget(item, input)) throw runtimeTargetNotFound();
          return item!;
        };

        await readWidgetItem();
        const revision = await runtimeLoadStep(lifetimeSignal, () => (
          context.widget.getRevision(context.tenant, input.revisionId)
        ));
        if (!revisionMatchesTarget(revision, {
          orgId: context.tenant.orgId,
          definitionId: input.definitionId,
          revisionId: input.revisionId,
        })) {
          throw runtimeTargetNotFound();
        }

        const readCapability = await runtimeLoadStep(lifetimeSignal, () => (
          context.widget.issueBrowserUiArtifactReadCapability(context.tenant, {
            definitionId: input.definitionId,
            revisionId: input.revisionId,
            artifactId: revision.uiArtifact.id,
            artifactKind: 'ui',
            digestSha256: revision.uiArtifact.digestSha256,
            expiresAtMs: Date.now() + BROWSER_ARTIFACT_CAPABILITY_TTL_MS,
          })
        ));
        const bytes = await runtimeLoadStep(lifetimeSignal, () => (
          context.widget.readArtifact(context.tenant, {
            artifactId: revision.uiArtifact.id,
            readCapability,
            purpose: 'browser_ui',
          })
        ));
        if (!bytes || bytes.byteLength !== revision.uiArtifact.byteSize) {
          throw runtimeTargetNotFound();
        }
        const exactByteDigest = createHash('sha256').update(bytes).digest('hex');
        if (exactByteDigest !== revision.uiArtifact.digestSha256) {
          throw runtimeTargetNotFound();
        }

        const finalRevision = await runtimeLoadStep(lifetimeSignal, () => (
          context.widget.getRevision(context.tenant, input.revisionId)
        ));
        if (
          !revisionMatchesTarget(finalRevision, {
            orgId: context.tenant.orgId,
            definitionId: input.definitionId,
            revisionId: input.revisionId,
          })
          || !revisionArtifactBindingMatches(revision, finalRevision)
        ) throw runtimeTargetNotFound();
        await readWidgetItem();
        assertRuntimeLoadActive(lifetimeSignal);

        const browserFunctionContract = runtimeBrowserFunctionContract(finalRevision);
        const { server: _server, ...browserManifest } = finalRevision.manifest;
        return {
          identity: {
            canvasId: input.canvasId,
            elementId: input.elementId,
            widgetInstanceId: input.widgetInstanceId,
            definitionId: input.definitionId,
            revisionId: input.revisionId,
          },
          manifest: browserManifest,
          artifact: {
            digestSha256: finalRevision.uiArtifact.digestSha256,
            byteSize: finalRevision.uiArtifact.byteSize,
            bytesBase64: Buffer.from(bytes).toString('base64'),
          },
          runtimeDescriptor: finalRevision.uiRuntime,
          functionDescriptors: [...browserFunctionContract.descriptors],
          browserFunctionDescriptorsDigestSha256: browserFunctionContract.digestSha256,
        };
      },
    );
  } catch (error) {
    return throwRuntimeLoadError(error);
  }
});

export { apiWidgetRuntimeLoad };
