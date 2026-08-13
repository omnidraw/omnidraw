import {
  createCanvasDocumentTransport,
  type TCanvasDocumentApi,
} from './canvas-document-transport-adapter';
import type { TCanvasEvent } from '@omnidraw/canvas-contract';
import type { TFrontendRuntime } from '../runtime/frontend-runtime';

export function createFrontendCanvasDocumentTransport(runtime: TFrontendRuntime) {
  return createCanvasDocumentTransport(
  Object.freeze({
    snapshot: (input) => runtime.api.safeRequest('canvas.snapshot', input),
    query: (input) => runtime.api.safeRequest('canvas.query', input),
    execute: (command) => runtime.api.safeRequest('canvas.execute', command, {
      idempotencyKey: command.commandId,
    }),
    async events(input) {
      const events = runtime.rpc.resumableStream<'canvas.events', number>({
        path: 'canvas.events',
        initialCursor: input.afterRevision,
        input: (afterRevision) => ({ canvasId: input.canvasId, afterRevision }),
        advance: (revision, event) => Math.max(revision, event.revision),
        isDuplicate: (revision, event) => event.revision <= revision,
      });
      return [null, events] as const;
    },
  }) satisfies TCanvasDocumentApi,
  );
}
