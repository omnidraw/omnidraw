import type { TCanvasImagePort } from '@omnidraw/canvas';
import type { TFrontendRuntime } from '../runtime/frontend-runtime';

async function fileJson<T>(
  runtime: TFrontendRuntime,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await runtime.ownerWindow.fetch(path, init);
  if (!response.ok) throw new Error(`File request failed (${response.status}).`);
  return await response.json() as T;
}

export function createCanvasImagePort(
  runtime: TFrontendRuntime,
): TCanvasImagePort {
  const ownerWindow = runtime.ownerWindow as Window & typeof globalThis;
  return Object.freeze({
    async uploadImage(body) {
      const form = new ownerWindow.FormData();
      form.set(
        'file',
        new ownerWindow.Blob(
          [new Uint8Array(body.data)],
          { type: body.mime_type },
        ),
      );
      form.set('mimeType', body.mime_type);
      return fileJson(runtime, '/files', { method: 'POST', body: form });
    },
    cloneImage: (body) => fileJson(runtime, '/files/clone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    deleteImage: (body) => fileJson(runtime, '/files', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
}
