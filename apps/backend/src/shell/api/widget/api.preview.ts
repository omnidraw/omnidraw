import { ProcedureError } from '../procedure';
import { withFunctionApiError } from '../function/api.function-error';
import { baseWidgetOs } from './procedure-builder';
import type { TWidgetPreviewApiCapability } from './types';

function previewTargetNotFound(): ProcedureError<'NOT_FOUND', unknown> {
  return new ProcedureError('NOT_FOUND', {
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

type TPreviewBuildState = Awaited<ReturnType<TWidgetPreviewApiCapability['buildState']>>;

function previewError(error: unknown, buildState?: TPreviewBuildState): never {
  const code = error !== null && typeof error === 'object' && 'code' in error
    ? error.code
    : null;
  if (
    error instanceof ProcedureError
    || (error !== null
      && typeof error === 'object'
      && (code === 'WIDGET_PREVIEW_NOT_FOUND'
        || code === 'WIDGET_DRAFT_MISSING'
        || code === 'WIDGET_MISSING'))
  ) throw previewTargetNotFound();
  if (
    code === 'BUILD_REQUIRED'
    || code === 'BUILD_PENDING'
    || code === 'BUILD_IMPORT_FAILED'
    || (buildState !== undefined && buildState.phase !== 'ready')
  ) {
    throw new ProcedureError('CONFLICT', {
      message: error instanceof Error ? error.message : 'Widget build is not ready.',
      data: buildState === undefined ? null : {
        kind: 'widget-preview-build-state',
        phase: buildState.phase,
        acceptedGeneration: buildState.acceptedGeneration,
        current: buildState.current,
        diagnostics: buildState.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      },
    });
  }
  throw error;
}

const apiWidgetPreviewOpen = baseWidgetOs.preview.open.handler(async ({ context, input }) => {
  try {
    return mountView(await context.widgetPreview.open(input));
  } catch (error) {
    previewError(error, await context.widgetPreview.buildState(input.widgetKey).catch(() => undefined));
  }
});

const apiWidgetPreviewBuildState = baseWidgetOs.preview.buildState.handler(({ context, input }) => (
  context.widgetPreview.buildState(input.widgetKey)
));

const apiWidgetPreviewRebuild = baseWidgetOs.preview.rebuild.handler(async ({ context, input, signal }) => {
  try {
    return mountView(await context.widgetPreview.rebuild(input, signal));
  } catch (error) {
    previewError(error, await context.widgetPreview.buildState(input.widgetKey).catch(() => undefined));
  }
});

const apiWidgetPreviewRebuildDraft = baseWidgetOs.preview.rebuildDraft.handler(async ({ context, input, signal }) => {
  try {
    return await context.widgetPreview.rebuildDraft(input, signal);
  } catch (error) {
    previewError(error, await context.widgetPreview.buildState(input.widgetKey).catch(() => undefined));
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
  apiWidgetPreviewBuildState,
  apiWidgetPreviewClose,
  apiWidgetPreviewInvoke,
  apiWidgetPreviewLoad,
  apiWidgetPreviewOpen,
  apiWidgetPreviewRebuild,
  apiWidgetPreviewRebuildDraft,
};
