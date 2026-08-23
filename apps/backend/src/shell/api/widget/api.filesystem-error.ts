import { ProcedureError } from '../procedure';

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

export function throwWidgetFilesystemApiError(error: unknown): never {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : 'Widget filesystem operation failed.';
  if (code === 'WIDGET_DELETION_STALE_PLAN') {
    throw new ProcedureError('WIDGET_DELETION_STALE_PLAN', { status: 409, message });
  }
  if (code === 'WIDGET_DELETION_UNSAFE_PATH') {
    throw new ProcedureError('WIDGET_DELETION_UNSAFE_PATH', { status: 400, message });
  }
  if (code === 'WIDGET_DELETION_BUSY') {
    throw new ProcedureError('WIDGET_DELETION_BUSY', { status: 409, message });
  }
  if (code === 'WIDGET_DELETION_RECOVERY_PENDING') {
    throw new ProcedureError('WIDGET_DELETION_RECOVERY_PENDING', { status: 503, message });
  }
  if (code === 'WIDGET_DELETION_TOO_LARGE') {
    throw new ProcedureError('WIDGET_DELETION_TOO_LARGE', { status: 413, message });
  }
  if (code === 'WIDGET_DELETION_NOT_FOUND') {
    throw new ProcedureError('WIDGET_DELETION_NOT_FOUND', { status: 404, message });
  }
  if (
    code === 'WIDGET_MANIFEST_CONFLICT'
    || code === 'WIDGET_CATALOG_CHANGED'
    || code === 'WIDGET_WORKSPACE_MANIFEST_CONFLICT'
    || code === 'WIDGET_WORKSPACE_MANIFEST_CHANGED'
    || code === 'WIDGET_WORKSPACE_DIRECTORY_CHANGED'
    || code === 'WIDGET_WORKSPACE_FILE_CHANGED'
    || code === 'PUBLICATION_FENCE_CONFLICT'
    || code === 'WRITER_LOCK_HELD'
  ) {
    throw new ProcedureError('CONFLICT', { message });
  }
  if (
    code === 'WIDGET_DRAFT_MISSING'
    || code === 'WIDGET_MISSING'
    || code === 'WIDGET_FILE_MISSING'
  ) throw new ProcedureError('NOT_FOUND', { message });
  if (
    code === 'WIDGET_BUILD_REQUIRED'
    || code === 'WIDGET_METADATA_UNAVAILABLE'
    || code === 'WIDGET_FILE_PATH_INVALID'
  ) throw new ProcedureError('BAD_REQUEST', { message });
  if (
    code === 'WIDGET_MANAGEMENT_UNAVAILABLE'
    || code === 'WIDGET_CATALOG_NOT_READY'
  ) {
    throw new ProcedureError('SERVICE_UNAVAILABLE', { message });
  }
  if (code === 'ABORT_ERR' || code === 'WIDGET_BUILD_SUPERSEDED') {
    throw new ProcedureError('TIMEOUT', { message: 'Widget filesystem operation was cancelled.' });
  }
  throw new ProcedureError('INTERNAL_SERVER_ERROR', {
    message: 'Widget filesystem operation failed.',
  });
}

export function throwWidgetDeletionApiError(error: unknown): never {
  if (errorCode(error) === 'WRITER_LOCK_HELD') {
    const message = error instanceof Error ? error.message : 'Widget deletion is busy.';
    throw new ProcedureError('WIDGET_DELETION_BUSY', { status: 409, message });
  }
  throwWidgetFilesystemApiError(error);
}
