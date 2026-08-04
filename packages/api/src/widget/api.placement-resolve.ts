import { ORPCError } from '@orpc/contract';
import { baseWidgetOs } from './orpc';

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

const apiWidgetPlacementResolve = baseWidgetOs.placement.resolve.handler(({
  input,
  context,
}) => {
  try {
    return context.widgetCatalog.resolvePlacement(input);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'WIDGET_MISSING' || code === 'WIDGET_CATALOG_NOT_READY') {
      throw new ORPCError('NOT_FOUND', {
        message: 'Published widget is missing or unhealthy.',
      });
    }
    if (code === 'WIDGET_CATALOG_CHANGED') {
      throw new ORPCError('CONFLICT', {
        message: 'Widget catalog changed before placement.',
      });
    }
    if (
      code === 'WIDGET_RESOURCE_SELECTION_INVALID'
      || code === 'WIDGET_RESOURCE_SELECTION_REQUIRED'
    ) {
      throw new ORPCError('BAD_REQUEST', {
        message: error instanceof Error
          ? error.message
          : 'Widget resource selection is invalid.',
      });
    }
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: 'Widget placement resolution failed.',
    });
  }
});

export { apiWidgetPlacementResolve };
