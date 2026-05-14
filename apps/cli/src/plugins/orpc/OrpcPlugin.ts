import { onError } from '@orpc/server';
import { RPCHandler as FetchRPCHandler } from '@orpc/server/fetch';
import { RPCHandler } from '@orpc/server/bun-ws';
import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type { IFilesystemService } from '@vibecanvas/service-filesystem/IFilesystemService';
import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';
import type { IPlugin } from '@vibecanvas/runtime';
import { baseCanvasCmdOs, canvasCmdHandlers } from '@vibecanvas/api-canvas-cmd/handlers';
import { OSS_FAKE_SESSION } from '../auth/AuthPlugin';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';
import { baseOs } from './orpc.base';
import { router } from './router';

type TOrpcWebSocketData = {
  path: string;
  query: string;
  requestId: string;
};

function createOrpcPlugin(): IPlugin<{ automerge: IAutomergeService; db: IDbService; eventPublisher: IEventPublisherService; filesystem: IFilesystemService; pty: IPtyService }, ICliHooks, ICliConfig> {
  return {
    name: 'orpc',
    apply(ctx) {
      if (ctx.config.command !== 'serve' || ctx.config.helpRequested || ctx.config.versionRequested) {
        return;
      }

      const automerge = ctx.services.require('automerge');
      const db = ctx.services.require('db');
      const eventPublisher = ctx.services.require('eventPublisher');
      const filesystem = ctx.services.require('filesystem');
      const pty = ctx.services.require('pty');
      const handler = new RPCHandler(baseOs.router(router), {
        interceptors: [
          onError((error) => {
            console.error(error);
          }),
        ],
      });
      const httpHandler = new FetchRPCHandler(baseCanvasCmdOs.router(canvasCmdHandlers), {
        interceptors: [
          onError((error) => {
            console.error(error);
          }),
        ],
      });

      ctx.hooks.wsUpgrade.tap((req) => {
        const url = new URL(req.url);
        const wantsWebSocket = req.headers.get('upgrade')?.toLowerCase() === 'websocket';
        return wantsWebSocket && url.pathname === '/api';
      });

      ctx.hooks.httpRequest.tapPromise(async (payload) => {
        if (payload.response) return payload;

        const url = new URL(payload.request.url);
        if (!url.pathname.startsWith('/rpc/')) return payload;

        const result = await httpHandler.handle(payload.request, {
          prefix: '/rpc',
          context: {
            automerge,
            accountId: OSS_FAKE_SESSION.accountId,
            db,
            requestId: crypto.randomUUID(),
          },
        });

        if (!result.matched) return payload;
        return { request: payload.request, response: result.response };
      });

      ctx.hooks.wsMessage.tap((ws, message) => {
        const socket = ws as WebSocket & { data?: TOrpcWebSocketData };
        if (socket.data?.path !== '/api') return;

        void handler.message(ws as never, message, {
          context: {
            accountId: OSS_FAKE_SESSION.accountId,
            automerge,
            db,
            eventPublisher,
            filesystem,
            pty,
            requestId: socket.data.requestId,
          },
        }).catch((error) => {
          console.error(error);
        });
      });

      ctx.hooks.wsClose.tap((ws) => {
        const socket = ws as WebSocket & { data?: TOrpcWebSocketData };
        if (socket.data?.path !== '/api') return;

        handler.close(ws as never);
      });
    },
  };
}

export { createOrpcPlugin };
export type { TOrpcWebSocketData };
