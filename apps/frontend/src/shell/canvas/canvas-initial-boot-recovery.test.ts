import { describe, expect, test } from 'bun:test';
import type { TFrontendRuntime } from '../runtime/frontend-runtime';
import { FrontendRpcConnectionGenerations } from '../transport/rpc';
import {
  createFrontendCanvasDocumentTransport,
  createFrontendCanvasInitialBootRecovery,
} from './canvas-document-transport';

function runtimeWithSnapshot(
  generations: FrontendRpcConnectionGenerations,
  snapshot: TFrontendRuntime['api']['safeRequest'],
): TFrontendRuntime {
  return {
    rpc: { generations },
    api: { safeRequest: snapshot },
  } as unknown as TFrontendRuntime;
}

describe('frontend Canvas initial boot recovery', () => {
  test('waits for a strictly newer accepted connection generation after a transport failure', async () => {
    const generations = new FrontendRpcConnectionGenerations();
    generations.connected();
    const runtime = runtimeWithSnapshot(generations, (async () => [{
      _tag: 'FrontendTransportError',
      code: 'TRANSPORT_FAILURE',
      status: 0,
      message: 'SocketCloseError: 1006',
      details: null,
    }, undefined]) as unknown as TFrontendRuntime['api']['safeRequest']);
    const transport = createFrontendCanvasDocumentTransport(runtime);
    const error = await transport.getSnapshot({ canvasId: 'canvas-a' }).catch((cause) => cause);
    const wait = createFrontendCanvasInitialBootRecovery(runtime).waitForRecovery(error);
    expect(wait).not.toBeNull();
    let settled = false;
    void wait!.promise.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    generations.disconnected();
    generations.connected();
    await wait!.promise;
    expect(generations.snapshot()).toEqual({ connected: true, generation: 2 });
  });

  test('accepts a reconnect that completed before the failed snapshot settled', async () => {
    const generations = new FrontendRpcConnectionGenerations();
    generations.connected();
    let finish!: (value: readonly [Readonly<Record<string, unknown>>, undefined]) => void;
    const response = new Promise<readonly [Readonly<Record<string, unknown>>, undefined]>((resolve) => {
      finish = resolve;
    });
    const runtime = runtimeWithSnapshot(
      generations,
      (() => response) as unknown as TFrontendRuntime['api']['safeRequest'],
    );
    const pending = createFrontendCanvasDocumentTransport(runtime)
      .getSnapshot({ canvasId: 'canvas-a' })
      .catch((cause) => cause);
    generations.disconnected();
    generations.connected();
    finish([{
      _tag: 'FrontendTransportError',
      code: 'TRANSPORT_FAILURE',
      status: 0,
      message: 'retired request',
      details: null,
    }, undefined]);

    const wait = createFrontendCanvasInitialBootRecovery(runtime).waitForRecovery(await pending);
    await expect(wait?.promise).resolves.toBeUndefined();
  });

  test.each([
    ['NOT_FOUND', 404, 'Canvas does not exist.'],
    ['UNAUTHORIZED', 401, 'Authentication is required.'],
    ['BAD_REQUEST', 400, 'Canvas snapshot is invalid.'],
  ])('keeps semantic Canvas failure %s terminal', async (code, status, message) => {
    const generations = new FrontendRpcConnectionGenerations();
    generations.connected();
    const semantic = Object.assign(new Error(message), {
      _tag: 'PrivateRpcError',
      code,
      status,
      details: null,
    });
    const runtime = runtimeWithSnapshot(
      generations,
      (async () => [semantic, undefined]) as unknown as TFrontendRuntime['api']['safeRequest'],
    );
    const error = await createFrontendCanvasDocumentTransport(runtime)
      .getSnapshot({ canvasId: 'missing' })
      .catch((cause) => cause);

    expect(createFrontendCanvasInitialBootRecovery(runtime).waitForRecovery(error)).toBeNull();
  });
});
