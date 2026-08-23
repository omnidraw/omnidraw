import { ProcedureError } from '../procedure';
import { baseWidgetOs } from './procedure-builder';

const NOT_FOUND_CODES = new Set([
  'WIDGET_NOT_FOUND',
  'DRAFT_REQUIRED',
]);
const CONFLICT_CODES = new Set([
  'DRAFT_UNHEALTHY',
  'WIDGET_NAME_AMBIGUOUS',
  'WIDGET_NAME_CASE_COLLISION',
  'WIDGET_DRAFT_DIGEST_STALE',
  'WIDGET_CATALOG_CHANGED',
  'WIDGET_BUILD_SUPERSEDED',
  'PREVIEW_GENERATION_CHANGED',
]);

function authoringFailure(error: unknown): never {
  if (error instanceof ProcedureError) throw error;
  const code = error !== null && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : 'INTERNAL_SERVER_ERROR';
  if (NOT_FOUND_CODES.has(code)) {
    throw new ProcedureError(code, {
      status: 404,
      message: error instanceof Error ? error.message : 'Widget draft was not found.',
    });
  }
  if (CONFLICT_CODES.has(code)) {
    throw new ProcedureError(code, {
      status: 409,
      message: error instanceof Error ? error.message : 'Widget authoring state changed.',
    });
  }
  if (code === 'WIDGET_PREVIEW_INSPECT_INPUT_INVALID') {
    throw new ProcedureError(code, {
      status: 400,
      message: error instanceof Error ? error.message : 'Inspection input is invalid.',
    });
  }
  throw error;
}

const apiWidgetAuthoringResolve = baseWidgetOs.authoring.resolve.handler(
  async ({ context, input, signal }) => {
    try {
      return await context.widgetAuthoring.resolve(input, signal);
    } catch (error) {
      authoringFailure(error);
    }
  },
);

const apiWidgetAuthoringValidate = baseWidgetOs.authoring.validate.handler(
  async ({ context, input, signal }) => {
    try {
      const result = await context.widgetAuthoring.validate({ ...input, signal });
      return {
        ...result,
        sourceValidation: {
          ...result.sourceValidation,
          diagnostics: result.sourceValidation.diagnostics.map((diagnostic) => ({ ...diagnostic })),
          files: [...result.sourceValidation.files],
        },
        acceptedArtifactBuild: {
          ...result.acceptedArtifactBuild,
          diagnostics: result.acceptedArtifactBuild.diagnostics.map((diagnostic) => ({ ...diagnostic })),
        },
      };
    } catch (error) {
      authoringFailure(error);
    }
  },
);

const apiWidgetAuthoringInspect = baseWidgetOs.authoring.inspect.handler(
  async ({ context, input, signal }) => {
    try {
      const result = await context.widgetAuthoring.inspect({ ...input, signal });
      return {
        ok: result.ok,
        widgetKey: result.widgetKey,
        draftDigestSha256: result.draftDigestSha256,
        acceptedGeneration: result.acceptedGeneration,
        buildIdentity: result.buildIdentity,
        canvasCorrelation: { ...result.canvasCorrelation },
        ...(result.result === undefined ? {} : { result: result.result }),
        ...(result.error === undefined
          ? {}
          : {
              error: {
                code: result.error.code,
                message: result.error.message,
                retryable: result.error.retryable,
                ...(result.error.observedDraftDigestSha256 === undefined
                  ? {}
                  : { observedDraftDigestSha256: result.error.observedDraftDigestSha256 }),
                ...(result.error.previewState === undefined
                  ? {}
                  : { previewState: result.error.previewState }),
                ...(result.error.nextAction === undefined
                  ? {}
                  : { nextAction: result.error.nextAction }),
                ...(result.error.diagnostics === undefined
                  ? {}
                  : { diagnostics: [...result.error.diagnostics] }),
              },
            }),
        ...(result.screenshotLease === undefined
          ? {}
          : { screenshotLease: { ...result.screenshotLease } }),
      };
    } catch (error) {
      authoringFailure(error);
    }
  },
);

export {
  apiWidgetAuthoringInspect,
  apiWidgetAuthoringResolve,
  apiWidgetAuthoringValidate,
};
