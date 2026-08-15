import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { Effect, Layer } from 'effect';
import {
  HttpRouter,
  HttpServerResponse,
} from 'effect/unstable/http';
import type { ICliConfig } from '../cli/config';
import { handleHttpRequest } from '../http/http';
import {
  BackendConfig,
  LiveDatabase,
  LiveWidgetScreenshotLease,
} from '../runtime/service.live-mechanics';
import { layerPrivateEffectRpc } from '../transport/layer.effect-rpc';
import { layerLiveRpcDispatcher } from '../transport/layer.rpc-dispatcher.live';

const layerBoundedHttp = HttpRouter.addAll([
  HttpRouter.route('*', '/*', (request) => Effect.gen(function*() {
    const config = yield* BackendConfig;
    const database = yield* LiveDatabase;
    const screenshotLeases = yield* LiveWidgetScreenshotLease;
    const source = request.source;
    if (!(source instanceof Request)) {
      return HttpServerResponse.text('Unsupported request source', { status: 500 });
    }
    const leasedScreenshot = screenshotLeases.consume(source);
    if (leasedScreenshot !== null) {
      const bytes = new Uint8Array(yield* Effect.promise(
        () => leasedScreenshot.arrayBuffer(),
      ));
      return HttpServerResponse.uint8Array(bytes, {
        status: leasedScreenshot.status,
        headers: {
          'Content-Type': leasedScreenshot.headers.get('content-type') ?? 'image/png',
          'Content-Length': String(bytes.byteLength),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    const reservedInternalPath = new URL(source.url).pathname.startsWith('/internal/');
    const response = reservedInternalPath
      ? new Response('Not Found', {
          status: 404,
          headers: {
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      : (yield* Effect.promise(
          () => handleHttpRequest(
            source,
            { version: config.version },
            database,
            import.meta.dir,
          ),
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
