import { ProcedureError } from '../procedure';
import { baseWidgetOs } from './procedure-builder';

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
      throw new ProcedureError('NOT_FOUND', {
        message: 'Published widget is missing or unhealthy.',
      });
    }
    if (code === 'WIDGET_CATALOG_CHANGED') {
      throw new ProcedureError('CONFLICT', {
        message: 'Widget catalog changed before placement.',
      });
    }
    if (
      code === 'WIDGET_RESOURCE_BINDING_REQUIRED'
      || code === 'WIDGET_RESOURCE_BINDING_STALE'
      || code === 'WIDGET_RESOURCE_NOT_READY'
      || code === 'WIDGET_RESOURCE_KIND_MISMATCH'
    ) {
      throw new ProcedureError('BAD_REQUEST', {
        message: error instanceof Error
          ? error.message
          : 'Widget manifest resource binding is invalid.',
      });
    }
    throw new ProcedureError('INTERNAL_SERVER_ERROR', {
      message: 'Widget placement resolution failed.',
    });
  }
});

export { apiWidgetPlacementResolve };
