import { Context, Effect, Layer, ManagedRuntime } from 'effect';
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc';
import { Socket } from 'effect/unstable/socket';
import type {
  TCanvasCommand,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasItemsChangedEvent,
  TCanvasSnapshot,
} from '@omnidraw/canvas-contract';
import { PrivateTransportRpcs } from '../../../shell/transport/rpc-contract';
import type { TPrivateRequestPath } from '../../../shell/transport/operation-contract';
import type { Json } from 'effect/Schema';
import type {
  ICanvasCliApi,
  ICanvasRpcConnection,
  TCanvasApiResult,
  TCanvasListEntry,
} from '../cmds/interface';

type TRequestClient = Readonly<{
  request(args: Readonly<{
    path: TPrivateRequestPath;
    input: Json;
    idempotencyKey?: string;
  }>): Effect.Effect<unknown, unknown>;
}>;

class CanvasCliRpcClient extends Context.Service<CanvasCliRpcClient, TRequestClient>()(
  'omnidraw/backend/CanvasCliRpcClient',
) {}

function layerCanvasCliRpc(websocketUrl: string) {
  return Layer.effect(
    CanvasCliRpcClient,
    Effect.map(RpcClient.make(PrivateTransportRpcs), (client) => CanvasCliRpcClient.of({
      request: (args) => client['omnidraw.request.v1'](args),
    })),
  ).pipe(
    Layer.provide(RpcClient.layerProtocolSocket({ retryTransientErrors: true })),
    Layer.provide(Socket.layerWebSocket(websocketUrl)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerNdjson),
  );
}

export function createCanvasRpcConnection(
  websocketUrl: string,
): ICanvasRpcConnection {
  const runtime = ManagedRuntime.make(layerCanvasCliRpc(websocketUrl));

  const invoke = async <Result>(args: Readonly<{
    path: TPrivateRequestPath;
    input: Json;
    idempotencyKey?: string;
  }>): TCanvasApiResult<Result> => {
    try {
      const result = await runtime.runPromise(Effect.flatMap(
        CanvasCliRpcClient,
        (client) => client.request(args),
      ));
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
    close: () => runtime.dispose(),
  });
}
