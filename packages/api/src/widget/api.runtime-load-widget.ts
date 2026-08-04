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
} from '@omnidraw/widget-contract';
import {
  WIDGET_RUNTIME_LOAD_CANCELLED_ERROR_CODE,
  WIDGET_RUNTIME_LOAD_CAPACITY_ERROR_CODE,
  WIDGET_RUNTIME_LOAD_TIMEOUT_ERROR_CODE,
} from './CONSTANTS';
import { baseWidgetOs } from './orpc';
import type { TWidgetRuntimeResolution } from './types';

function widgetItemMatchesTarget(
  item: TCanvasItemSnapshot | undefined,
  target: Readonly<{
    elementId: string;
    widgetInstanceId: string;
    widgetKey: string;
  }>,
): boolean {
  if (!item || item.id !== target.elementId) return false;
  const extension = fnReadCanvasWidgetExtension(item.item);
  return extension?.type === 'widget-instance'
    && extension.instanceId === target.widgetInstanceId
    && extension.widgetKey === target.widgetKey;
}

function runtimeBrowserFunctionContract(
  resolution: TWidgetRuntimeResolution,
): Readonly<{
  descriptors: readonly TWidgetBrowserFunctionDescriptor[];
  digestSha256: string;
}> {
  const serverDescriptors = ZWidgetServerFunctionDescriptors.parse(
    resolution.functionDescriptors,
  );
  const validation = fnValidateWidgetServerFunctionDescriptors(
    resolution.manifest,
    serverDescriptors,
  );
  if (!validation.valid) {
    throw new Error('Published widget server-function descriptors are invalid.');
  }

  if (resolution.release.server === null) {
    if (serverDescriptors.length !== 0) {
      throw new Error('Browser-only widget includes server-function descriptors.');
    }
  } else {
    const persistedDigestSha256 = createHash('sha256')
      .update(fnCanonicalizeWidgetServerFunctionDescriptors(serverDescriptors))
      .digest('hex');
    if (persistedDigestSha256 !== resolution.release.server.functionsDigestSha256) {
      throw new Error('Published widget server-function descriptor digest mismatch.');
    }
  }

  const descriptors = fnProjectWidgetBrowserFunctionDescriptors(serverDescriptors);
  const digestSha256 = createHash('sha256')
    .update(fnCanonicalizeWidgetBrowserFunctionDescriptors(descriptors))
    .digest('hex');
  const capabilityDigest = resolution.release.server?.functionsDigestSha256
    ?? '0'.repeat(64);
  if (!fnWidgetServerFunctionCapabilityRequestMatches(
    capabilityDigest,
    descriptors,
    resolution.release.capsule.runtime.capabilityRequests,
  )) {
    throw new Error('Widget functions do not match the signed Capsule capability request.');
  }
  return Object.freeze({ descriptors, digestSha256 });
}

function runtimeTargetNotFound(): ORPCError<'NOT_FOUND', unknown> {
  return new ORPCError('NOT_FOUND', {
    message: 'Published widget is missing or unhealthy.',
  });
}

function runtimeOperationFailed(): ORPCError<'INTERNAL_SERVER_ERROR', unknown> {
  return new ORPCError('INTERNAL_SERVER_ERROR', {
    message: 'Widget runtime operation failed.',
  });
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
    || code === 'WIDGET_MISSING'
    || code === 'WIDGET_CATALOG_CHANGED'
    || code === 'WIDGET_CATALOG_NOT_READY'
  ) throw runtimeTargetNotFound();
  throw runtimeOperationFailed();
}

const apiWidgetRuntimeLoad = baseWidgetOs.runtime.load.handler(async ({
  input,
  context,
  signal,
}) => {
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
        const resolution = await runtimeLoadStep(lifetimeSignal, () => (
          context.widgetCatalog.resolveRuntime(input.widgetKey)
        ));
        if (resolution.widgetKey !== input.widgetKey) throw runtimeTargetNotFound();
        await readWidgetItem();
        if (!context.widgetCatalog.isRuntimeResolutionCurrent(resolution)) {
          throw Object.assign(new Error('Widget catalog changed during runtime load.'), {
            code: 'WIDGET_CATALOG_CHANGED',
          });
        }
        assertRuntimeLoadActive(lifetimeSignal);

        const capsuleFile = resolution.release.files.find(
          (file) => file.path === resolution.release.capsule.path,
        );
        if (capsuleFile === undefined || capsuleFile.byteSize !== resolution.capsuleBytes.byteLength) {
          throw runtimeTargetNotFound();
        }
        const exactByteDigest = createHash('sha256')
          .update(resolution.capsuleBytes)
          .digest('hex');
        if (exactByteDigest !== capsuleFile.sha256) throw runtimeTargetNotFound();

        const browserFunctionContract = runtimeBrowserFunctionContract(resolution);
        const { server: _server, ...browserManifest } = resolution.manifest;
        return {
          identity: {
            canvasId: input.canvasId,
            elementId: input.elementId,
            widgetInstanceId: input.widgetInstanceId,
            widgetKey: input.widgetKey,
            catalogGeneration: resolution.catalogGeneration,
          },
          manifest: browserManifest,
          artifact: {
            digestSha256: capsuleFile.sha256,
            byteSize: capsuleFile.byteSize,
            bytesBase64: Buffer.from(resolution.capsuleBytes).toString('base64'),
          },
          runtimeDescriptor: resolution.release.capsule.runtime,
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
