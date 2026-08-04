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
  if (
    error instanceof ORPCError
    || (error !== null
      && typeof error === 'object'
      && 'code' in error
      && (error.code === 'WIDGET_PREVIEW_NOT_FOUND'
        || error.code === 'WIDGET_DRAFT_MISSING'
        || error.code === 'WIDGET_MISSING'))
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
};
