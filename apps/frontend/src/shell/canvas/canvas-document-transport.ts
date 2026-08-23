import {
  createCanvasDocumentTransport,
  type TCanvasDocumentApi,
} from './canvas-document-transport-adapter';
import type { TCanvasEvent } from '@omnidraw/canvas-contract';
import type { TCanvasInitialBootRecoveryPort } from '@omnidraw/canvas';
import type { TFrontendRuntime } from '../runtime/frontend-runtime';

class FrontendCanvasInitialTransportError extends Error {
  readonly reconnectAfterGeneration: number;

  constructor(cause: Readonly<{ message: string }>, reconnectAfterGeneration: number) {
    super(cause.message, { cause });
    this.name = 'FrontendCanvasInitialTransportError';
    this.reconnectAfterGeneration = reconnectAfterGeneration;
  }
}

function initialSnapshot(
  runtime: TFrontendRuntime,
  input: Readonly<{ canvasId: string }>,
) {
  const generation = runtime.rpc.generations.snapshot().generation;
  return runtime.api.safeRequest('canvas.snapshot', input).then(([error, snapshot]) => [
    error?.code === 'TRANSPORT_FAILURE'
      ? new FrontendCanvasInitialTransportError(error, generation)
      : error,
    snapshot,
  ] as const);
}

export function createFrontendCanvasDocumentTransport(runtime: TFrontendRuntime) {
  return createCanvasDocumentTransport(
  Object.freeze({
    snapshot: (input) => initialSnapshot(runtime, input),
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

export function createFrontendCanvasInitialBootRecovery(
  runtime: TFrontendRuntime,
): TCanvasInitialBootRecoveryPort {
  return Object.freeze({
    waitForRecovery(error) {
      if (!(error instanceof FrontendCanvasInitialTransportError)) return null;
      const controller = new AbortController();
      const promise = runtime.rpc.generations.waitForConnectionAfter(
        error.reconnectAfterGeneration,
        controller.signal,
      ).then(() => undefined);
      return Object.freeze({
        promise,
        cancel: () => controller.abort(),
      });
    },
  });
}
