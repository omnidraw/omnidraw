import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/bun-ws';
import type { IRuntimeServices } from '@vibecanvas/cli/setup-services';
import type { IPlugin } from '@vibecanvas/runtime';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';
import { OSS_FAKE_SESSION } from '../auth/AuthPlugin';
import { baseOs } from './orpc.base';
import { router } from './router';

type TOrpcWebSocketData = {
  path: string;
  query: string;
  requestId: string;
};

function createOrpcPlugin(): IPlugin<IRuntimeServices, ICliHooks, ICliConfig> {
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
      const actor = ctx.services.get('actor');
      const handler = new RPCHandler(baseOs.router(router), {
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
            actor,
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
