import { Effect, Layer, Stream } from 'effect';
import { RpcServer, RpcSerialization } from 'effect/unstable/rpc';
import { PrivateTransportRpcs } from './rpc-contract';
import { RpcDispatcher } from './service.rpc-dispatcher';

const handlers = PrivateTransportRpcs.toLayer(Effect.gen(function*() {
  const dispatcher = yield* RpcDispatcher;
  return PrivateTransportRpcs.of({
    'omnidraw.request.v1': (request) => dispatcher.request(request),
    'omnidraw.stream.v1': (request) => dispatcher.stream(request).pipe(
      Stream.toQueue({ capacity: 256, strategy: 'suspend' }),
    ),
  });
}));

/** Dedicated native-WebSocket Effect RPC route. */
export const layerPrivateEffectRpc = RpcServer.layerHttp({
  group: PrivateTransportRpcs,
  path: '/rpc',
  protocol: 'websocket',
  disableFatalDefects: true,
}).pipe(
  Layer.provide(handlers),
  Layer.provide(RpcSerialization.layerNdjson),
);
