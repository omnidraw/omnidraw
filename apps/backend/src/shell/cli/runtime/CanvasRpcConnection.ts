import type {
  TCanvasCommand,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasItemsChangedEvent,
  TCanvasSnapshot,
} from '@omnidraw/canvas-contract';
import type { TPrivateRequestPath } from '../../../shell/transport/operation-contract';
import type { Json } from 'effect/Schema';
import type {
  ICanvasCliApi,
  ICanvasRpcConnection,
  TCanvasApiResult,
  TCanvasListEntry,
} from '../cmds/interface';
import { createPrivateRpcConnection } from './PrivateRpcConnection';

export function createCanvasRpcConnection(
  websocketUrl: string,
): ICanvasRpcConnection {
  const connection = createPrivateRpcConnection({
    websocketUrl,
    retryTransientErrors: true,
  });

  const invoke = async <Result>(args: Readonly<{
    path: TPrivateRequestPath;
    input: Json;
    idempotencyKey?: string;
  }>): TCanvasApiResult<Result> => {
    try {
      const result = await connection.request(args);
      return [null, result as Result] as const;
    } catch (error) {
      return [error, undefined] as const;
    }
  };

  const api: ICanvasCliApi = Object.freeze({
    list: () => invoke<readonly TCanvasListEntry[]>({
      path: 'canvas.list',
      input: null,
    }),
    snapshot: (input: Readonly<{ canvasId: string }>) => invoke<TCanvasSnapshot>({
      path: 'canvas.snapshot',
      input: input as Json,
    }),
    query: (input: TCanvasItemQuery) => invoke<TCanvasItemPage>({
      path: 'canvas.query',
      input: input as Json,
    }),
    execute: (input: TCanvasCommand) => invoke<TCanvasItemsChangedEvent>({
      path: 'canvas.execute',
      input: input as Json,
      idempotencyKey: input.commandId,
    }),
  });

  return Object.freeze({
    api,
    close: () => connection.close(),
  });
}
