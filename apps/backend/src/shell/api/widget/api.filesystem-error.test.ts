import { describe, expect, test } from 'bun:test';
import { throwWidgetFilesystemApiError } from './api.filesystem-error';

function mapped(code: string, message = 'safe domain message'):
Readonly<{ code: unknown; message: unknown }> {
  try {
    throwWidgetFilesystemApiError(Object.assign(new Error(message), { code }));
  } catch (error) {
    return error as Readonly<{ code: unknown; message: unknown }>;
  }
}

describe('widget filesystem API errors', () => {
  test('maps stale observations and an active writer to retryable conflicts', () => {
    for (const code of [
      'WIDGET_MANIFEST_CONFLICT',
      'WIDGET_WORKSPACE_MANIFEST_CONFLICT',
      'WIDGET_WORKSPACE_MANIFEST_CHANGED',
      'PUBLICATION_FENCE_CONFLICT',
      'WRITER_LOCK_HELD',
    ]) {
      expect(mapped(code)).toMatchObject({ code: 'CONFLICT', message: 'safe domain message' });
    }
  });

  test('does not expose unexpected filesystem errors', () => {
    expect(mapped('UNSAFE_PUBLICATION_PATH', '/private/secret/root escaped'))
      .toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Widget filesystem operation failed.',
      });
  });
});
