import { Context, Effect, Layer, ManagedRuntime } from 'effect';
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc';
import { Socket } from 'effect/unstable/socket';
import type { Json } from 'effect/Schema';
import { PrivateTransportRpcs } from '../../transport/rpc-contract';
import type { TPrivateRequestPath } from '../../transport/operation-contract';

type TRequestClient = Readonly<{
  request(args: Readonly<{
    path: TPrivateRequestPath;
    input: Json;
    idempotencyKey?: string;
  }>): Effect.Effect<unknown, unknown>;
}>;

class PrivateCliRpcClient extends Context.Service<PrivateCliRpcClient, TRequestClient>()(
  'omnidraw/backend/PrivateCliRpcClient',
) {}

function layerPrivateCliRpc(websocketUrl: string, retryTransientErrors: boolean) {
  return Layer.effect(
    PrivateCliRpcClient,
    Effect.map(RpcClient.make(PrivateTransportRpcs), (client) => PrivateCliRpcClient.of({
      request: (args) => client['omnidraw.request.v1'](args),
    })),
  ).pipe(
    Layer.provide(RpcClient.layerProtocolSocket({ retryTransientErrors })),
    Layer.provide(Socket.layerWebSocket(websocketUrl)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerNdjson),
  );
}

export type TPrivateRpcConnection = Readonly<{
  request<Result>(args: Readonly<{
    path: TPrivateRequestPath;
    input: Json;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }>): Promise<Result>;
  close(): Promise<void>;
}>;

/** One short-lived CLI client runtime over the running backend's only RPC. */
export function createPrivateRpcConnection(args: Readonly<{
  websocketUrl: string;
  retryTransientErrors: boolean;
}>): TPrivateRpcConnection {
  const runtime = ManagedRuntime.make(layerPrivateCliRpc(
    args.websocketUrl,
    args.retryTransientErrors,
  ));
  return Object.freeze({
    async request<Result>(request: Readonly<{
      path: TPrivateRequestPath;
      input: Json;
      idempotencyKey?: string;
      signal?: AbortSignal;
    }>): Promise<Result> {
      return await runtime.runPromise(
        Effect.flatMap(PrivateCliRpcClient, (client) => client.request({
          path: request.path,
          input: request.input,
          ...(request.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: request.idempotencyKey }),
        })),
        request.signal === undefined ? undefined : { signal: request.signal },
      ) as Result;
    },
    close: () => runtime.dispose(),
  });
}
