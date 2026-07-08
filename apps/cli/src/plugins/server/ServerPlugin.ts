import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type { IPlugin } from '@vibecanvas/runtime';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';
import { checkForUpdateOnBoot } from './check-update';
import { handleHttpRequest } from './http';
import type { TOrpcWebSocketData } from '../orpc/OrpcPlugin';

function serveWithPortFallback<TSocketData>(serve: (port: number) => ReturnType<typeof Bun.serve<TSocketData>>, startPort: number): ReturnType<typeof Bun.serve<TSocketData>> {
  const maxAttempts = 100;
  for (let i = 0; i < maxAttempts; i += 1) {
    const port = startPort + i;
    try {
      const server = serve(port);
      if (port !== startPort) {
        console.warn(`[Server] Port ${startPort} is busy, using ${port}`);
      }
      return server;
    } catch {
      // Port busy, try next.
    }
  }

  throw new Error(`[Server] No available port found starting from ${startPort}`);
}

function createServerPlugin(): IPlugin<{ eventPublisher: IEventPublisherService }, ICliHooks, ICliConfig> {
  return {
    name: 'server',
    apply(ctx) {
      let bunServer: ReturnType<typeof Bun.serve<TOrpcWebSocketData>> | null = null;

      ctx.hooks.boot.tapPromise(async () => {
        if (ctx.config.command !== 'serve' || ctx.config.helpRequested || ctx.config.versionRequested) return;

        bunServer = serveWithPortFallback<TOrpcWebSocketData>((port) => Bun.serve<TOrpcWebSocketData>({
          port,
          async fetch(req, server) {
            const url = new URL(req.url);
            const upgraded = ctx.hooks.wsUpgrade.call(req);

            if (upgraded) {
              if (server.upgrade(req, {
                data: {
                  path: url.pathname,
                  query: url.search,
                  requestId: crypto.randomUUID(),
                },
              })) {
                return;
              }

              return new Response('Upgrade failed', { status: 500 });
            }

            const httpHookResult = await ctx.hooks.httpRequest.promise({ request: req, response: null });
            if (httpHookResult.response) {
              return httpHookResult.response;
            }

            const db = ctx.services.get('db');
            if (!db) {
              return new Response('Database service not available', { status: 500 });
            }

            return handleHttpRequest(req, { compiled: ctx.config.compiled, version: ctx.config.version }, db, import.meta.dir);
          },
          websocket: {
            data: {} as TOrpcWebSocketData,
            open(ws) {
              ctx.hooks.wsOpen.call(ws as unknown as WebSocket);
            },
            message(ws, message) {
              const normalizedMessage = message instanceof ArrayBuffer
                ? Buffer.from(message)
                : Buffer.isBuffer(message) || typeof message === 'string'
                  ? message
                  : Buffer.from(message);
              ctx.hooks.wsMessage.call(ws as unknown as WebSocket, normalizedMessage);
            },
            close(ws) {
              ctx.hooks.wsClose.call(ws as unknown as WebSocket);
            },
            pong(ws, data) {
              const pongData = data
                ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
                : Buffer.alloc(0);
              ctx.hooks.wsPong.call(ws as unknown as WebSocket, pongData);
            },
          },
        }), ctx.config.port);
      });

      ctx.hooks.ready.tapPromise(async () => {
        if (ctx.config.command !== 'serve' || ctx.config.helpRequested || ctx.config.versionRequested) return;
        if (!bunServer) return;

        console.log(`Server listening on http://localhost:${bunServer.port}`);

        const eventPublisher = ctx.services.require('eventPublisher');
        checkForUpdateOnBoot(ctx.config, eventPublisher);
      });

      ctx.hooks.shutdown.tapPromise(async () => {
        if (!bunServer) return;
        bunServer.stop();
        bunServer = null;
      });
    },
  };
}

export { createServerPlugin };
export { serveWithPortFallback };
