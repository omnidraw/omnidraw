import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { Effect, Layer } from 'effect';
import {
  HttpRouter,
  HttpServerResponse,
} from 'effect/unstable/http';
import type { ICliConfig } from '../cli/config';
import { handleHttpRequest } from '../http/http';
import { BackendConfig, LiveDatabase } from '../runtime/service.live-mechanics';
import { layerPrivateEffectRpc } from '../transport/layer.effect-rpc';
import { layerLiveRpcDispatcher } from '../transport/layer.rpc-dispatcher.live';

const layerBoundedHttp = HttpRouter.addAll([
  HttpRouter.route('*', '/*', (request) => Effect.gen(function*() {
    const config = yield* BackendConfig;
    const database = yield* LiveDatabase;
    const source = request.source;
    if (!(source instanceof Request)) {
      return HttpServerResponse.text('Unsupported request source', { status: 500 });
    }
    const response = yield* Effect.promise(() => handleHttpRequest(
      source,
      { version: config.version },
      database,
      import.meta.dir,
    ));
    return HttpServerResponse.fromWeb(response);
  })),
]);

/** The backend's only physical server: Effect HTTP plus dedicated Effect RPC WebSocket. */
export function layerBackendServer(config: Pick<ICliConfig, 'port'>) {
  const rpc = layerPrivateEffectRpc.pipe(Layer.provide(layerLiveRpcDispatcher));
  const routes = Layer.merge(rpc, layerBoundedHttp);
  return HttpRouter.serve(routes).pipe(
    Layer.provide(BunHttpServer.layer({
      hostname: '127.0.0.1',
      port: config.port,
      websocket: {
        closeOnBackpressureLimit: true,
      },
    })),
  );
}
