import { ORPCError } from '@orpc/contract';
import { withFunctionApiError } from '../function/api.function-error';
import { baseWidgetOs } from './orpc';
import type { TWidgetPreviewApiCapability } from './types';

function previewTargetNotFound(): ORPCError<'NOT_FOUND', unknown> {
  return new ORPCError('NOT_FOUND', {
    message: 'Preview stopped — build again.',
  });
}

function mountView(view: Awaited<ReturnType<TWidgetPreviewApiCapability['open']>>) {
  return {
    ...view,
    functionDescriptors: [...view.functionDescriptors],
    diagnostics: view.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  };
}

function previewError(error: unknown): never {
  const code = error !== null && typeof error === 'object' && 'code' in error
    ? error.code
    : null;
  if (code === 'BUILD_REQUIRED' || code === 'BUILD_PENDING' || code === 'BUILD_IMPORT_FAILED') {
    throw new ORPCError('CONFLICT', {
      message: error instanceof Error ? error.message : 'Widget build is not ready.',
    });
  }
  if (
    error instanceof ORPCError
    || (error !== null
      && typeof error === 'object'
      && (code === 'WIDGET_PREVIEW_NOT_FOUND'
        || code === 'WIDGET_DRAFT_MISSING'
        || code === 'WIDGET_MISSING'))
  ) throw previewTargetNotFound();
  throw error;
}

const apiWidgetPreviewOpen = baseWidgetOs.preview.open.handler(async ({ context, input }) => {
  try {
    return mountView(await context.widgetPreview.open(input));
  } catch (error) {
    previewError(error);
  }
});

const apiWidgetPreviewRebuild = baseWidgetOs.preview.rebuild.handler(async ({ context, input, signal }) => {
  try {
    return mountView(await context.widgetPreview.rebuild(input, signal));
  } catch (error) {
    previewError(error);
  }
});

const apiWidgetPreviewRebuildDraft = baseWidgetOs.preview.rebuildDraft.handler(async ({ context, input, signal }) => {
  try {
    return await context.widgetPreview.rebuildDraft(input, signal);
  } catch (error) {
    previewError(error);
  }
});

const apiWidgetPreviewLoad = baseWidgetOs.preview.load.handler(async ({ context, input }) => {
  try {
    return mountView(await context.widgetPreview.load(input));
  } catch (error) {
    previewError(error);
  }
});

const apiWidgetPreviewClose = baseWidgetOs.preview.close.handler(async ({ context, input }) => {
  return { closed: await context.widgetPreview.close(input) };
});

const apiWidgetPreviewInvoke = baseWidgetOs.preview.invoke.handler(({ context, input, signal }) => (
  withFunctionApiError(() => context.widgetPreview.invoke(input, signal))
));

export {
  apiWidgetPreviewClose,
  apiWidgetPreviewInvoke,
  apiWidgetPreviewLoad,
  apiWidgetPreviewOpen,
  apiWidgetPreviewRebuild,
  apiWidgetPreviewRebuildDraft,
};
