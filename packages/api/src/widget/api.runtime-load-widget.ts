import { ORPCError } from '@orpc/contract';
import type { TCanvasDoc } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import { zWidgetInstanceData } from '@vibecanvas/service-automerge/types/canvas-doc.zod';
import type { TWidgetRevisionDescriptor } from '@vibecanvas/widget-contract';
import {
  WIDGET_RUNTIME_LOAD_CANCELLED_ERROR_CODE,
  WIDGET_RUNTIME_LOAD_CAPACITY_ERROR_CODE,
  WIDGET_RUNTIME_LOAD_TIMEOUT_ERROR_CODE,
} from './CONSTANTS';
import { baseWidgetOs } from './orpc';

const BROWSER_ARTIFACT_CAPABILITY_TTL_MS = 60_000;

type TNeutralWidgetIdentity = Readonly<{
  type: 'widget-instance';
  definitionId: string;
  revisionId: string;
  instanceId: string;
}>;

function neutralWidgetIdentity(value: unknown): TNeutralWidgetIdentity | null {
  const parsed = zWidgetInstanceData.safeParse(value);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    type: data.type,
    definitionId: data.definitionId,
    revisionId: data.revisionId,
    instanceId: data.instanceId,
  };
}

function widgetElementMatchesTarget(
  element: TCanvasDoc['elements'][string] | undefined,
  target: Readonly<{
    elementId: string;
    widgetInstanceId: string;
    definitionId: string;
    revisionId: string;
  }>,
): boolean {
  const data = neutralWidgetIdentity(element?.data);
  return data !== null
    && element?.id === target.elementId
    && data.instanceId === target.widgetInstanceId
    && data.definitionId === target.definitionId
    && data.revisionId === target.revisionId;
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
    && left.uiArtifact.byteSize === right.uiArtifact.byteSize;
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
      async (lifetimeSignal, deferCleanup) => {
        let canvasUrl: string | null = null;
        let handle: Readonly<{
          whenReady(): Promise<void>;
          doc(): TCanvasDoc;
        }> | null = null;
        try {
          if (context.tenant.canvasId !== undefined && context.tenant.canvasId !== input.canvasId) {
            throw runtimeTargetNotFound();
          }
          const canvas = await runtimeLoadStep(lifetimeSignal, () => (
            context.db.canvas.findById(context.tenant, { id: input.canvasId })
          ));
          if (!canvas || canvas.id !== input.canvasId) throw runtimeTargetNotFound();
          canvasUrl = canvas.automerge_url;
          try {
            handle = await runtimeLoadStep(lifetimeSignal, () => (
              context.automerge.findDocument<TCanvasDoc>(context.tenant, canvasUrl!)
            ));
            await runtimeLoadStep(lifetimeSignal, () => handle!.whenReady());
          } catch {
            assertRuntimeLoadActive(lifetimeSignal);
            throw runtimeTargetNotFound();
          }
          assertRuntimeLoadActive(lifetimeSignal);
          const element = handle.doc().elements[input.elementId];
          if (!widgetElementMatchesTarget(element, input)) throw runtimeTargetNotFound();

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

          try {
            await runtimeLoadStep(lifetimeSignal, () => handle!.whenReady());
          } catch {
            assertRuntimeLoadActive(lifetimeSignal);
            throw runtimeTargetNotFound();
          }
          const finalCanvas = await runtimeLoadStep(lifetimeSignal, () => (
            context.db.canvas.findById(context.tenant, { id: input.canvasId })
          ));
          if (
            !finalCanvas
            || finalCanvas.id !== input.canvasId
            || finalCanvas.automerge_url !== canvasUrl
          ) throw runtimeTargetNotFound();
          assertRuntimeLoadActive(lifetimeSignal);
          let finalElement: TCanvasDoc['elements'][string] | undefined;
          try {
            finalElement = handle.doc().elements[input.elementId];
          } catch {
            throw runtimeTargetNotFound();
          }
          if (!widgetElementMatchesTarget(finalElement, input)) throw runtimeTargetNotFound();
          assertRuntimeLoadActive(lifetimeSignal);

          return {
            identity: {
              canvasId: input.canvasId,
              elementId: input.elementId,
              widgetInstanceId: input.widgetInstanceId,
              definitionId: input.definitionId,
              revisionId: input.revisionId,
            },
            manifest: {
              schemaVersion: 2 as const,
              name: finalRevision.manifest.name,
              slug: finalRevision.manifest.slug,
              ...(finalRevision.manifest.description === undefined
                ? {}
                : { description: finalRevision.manifest.description }),
              ui: { entry: finalRevision.manifest.ui.entry },
            },
            artifact: {
              digestSha256: finalRevision.uiArtifact.digestSha256,
              bytesBase64: Buffer.from(bytes).toString('base64'),
            },
            functionDescriptors: finalRevision.functionDescriptors.map((descriptor) => {
              const { modulePath: _serverModulePath, ...browserDescriptor } = descriptor;
              return browserDescriptor;
            }),
          };
        } finally {
          if (canvasUrl !== null) {
            const releaseUrl = canvasUrl;
            deferCleanup(() => context.automerge.releaseDocument(context.tenant, releaseUrl));
          }
        }
      },
    );
  } catch (error) {
    return throwRuntimeLoadError(error);
  }
});

export { apiWidgetRuntimeLoad };
