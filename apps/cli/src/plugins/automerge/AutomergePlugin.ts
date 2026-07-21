import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { WebSocketWithIsAlive } from '@vibecanvas/service-automerge/adapters/websocket.adapter';
import type { IPlugin } from '@vibecanvas/runtime';
import { fnScopedKey, type TTenantContext } from '@vibecanvas/tenant-core';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';

type TAutomergeWebSocketData = {
  path: string;
  query: string;
  requestId: string;
  tenant: TTenantContext;
};

type TBunAutomergeSocket = WebSocket & {
  data?: TAutomergeWebSocketData;
  ping(): void;
  terminate(): void;
};

function createAutomergePlugin(): IPlugin<{ automerge: IAutomergeService }, ICliHooks, ICliConfig> {
  return {
    name: 'automerge',
    apply(ctx) {
      if (ctx.config.command !== 'serve' || ctx.config.helpRequested || ctx.config.versionRequested) {
        return;
      }

      const instance = ctx.services.require('automerge');
      const automergeConnections = new Map<string, WebSocketWithIsAlive>();

      const connectionKey = (socket: TBunAutomergeSocket): string | null => {
        const data = socket.data;
        if (!data) return null;
        return fnScopedKey('automerge-websocket', [data.tenant.orgId, data.tenant.accountId, data.requestId]);
      };

      ctx.hooks.wsUpgrade.tap((req) => {
        const url = new URL(req.url);
        return url.pathname === '/automerge';
      });

      ctx.hooks.wsOpen.tap((ws) => {
        const socket = ws as unknown as TBunAutomergeSocket;
        if (socket.data?.path !== '/automerge') return;
        if (!instance) return;

        const wrapper: WebSocketWithIsAlive = {
          data: { isAlive: true },
          get readyState() {
            return socket.readyState;
          },
          ping() {
            socket.ping();
          },
          close() {
            socket.close();
          },
          send(data: ArrayBuffer) {
            socket.send(data);
          },
          terminate() {
            socket.terminate();
          },
        };

        const key = connectionKey(socket);
        if (!key) {
          socket.close(1008, 'Missing tenant context');
          return;
        }
        automergeConnections.set(key, wrapper);
        instance.openConnection(socket.data!.tenant, wrapper);
      });

      ctx.hooks.wsMessage.tap((ws, message) => {
        const socket = ws as unknown as TBunAutomergeSocket;
        if (socket.data?.path !== '/automerge') return;
        if (!instance) return;

        let bufferMessage: Buffer;
        if (typeof message === 'string') {
          try {
            const textEncoder = new TextEncoder();
            bufferMessage = Buffer.from(textEncoder.encode(message));
          } catch (err) {
            console.error('[WS:automerge] Failed to convert string to Buffer:', err);
            return;
          }
        } else {
          bufferMessage = message as Buffer;
        }

        const key = connectionKey(socket);
        const wrapper = key ? automergeConnections.get(key) : undefined;
        if (!wrapper) return;
        wrapper.data.isAlive = true;

        try {
          void instance.receiveConnectionMessage(socket.data!.tenant, wrapper, bufferMessage)
            .catch((error) => console.error('[WS:automerge] adapter.message() error:', error));
        } catch (err) {
          console.error('[WS:automerge] adapter.message() error:', err);
        }
      });

      ctx.hooks.wsClose.tap((ws) => {
        const socket = ws as unknown as TBunAutomergeSocket;
        if (socket.data?.path !== '/automerge') return;
        if (!instance) return;

        const key = connectionKey(socket);
        const wrapper = key ? automergeConnections.get(key) : undefined;
        if (!wrapper) return;
        instance.closeConnection(socket.data!.tenant, wrapper, 1000, '');
        automergeConnections.delete(key!);
      });

      ctx.hooks.wsPong.tap((ws, data) => {
        const socket = ws as unknown as TBunAutomergeSocket;
        if (socket.data?.path !== '/automerge') return;
        if (!instance) return;

        const key = connectionKey(socket);
        const wrapper = key ? automergeConnections.get(key) : undefined;
        if (!wrapper) return;
        instance.pongConnection(socket.data!.tenant, wrapper, data);
      });

      ctx.hooks.shutdown.tapPromise(async () => {
        automergeConnections.clear();
      });
    },
  };
}

export { createAutomergePlugin };
