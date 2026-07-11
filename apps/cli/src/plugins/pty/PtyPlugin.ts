import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';
import type { IPlugin } from '@vibecanvas/runtime';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';

type TPtyWebSocketData = {
  path: string;
  query: string;
  requestId: string;
};

type TBunPtySocket = WebSocket & {
  data?: TPtyWebSocketData;
};

type TPtySocketConnection = {
  send(payload: string | Buffer | ArrayBuffer | Uint8Array): void;
  detach(): void;
};

function isNativePtyConnectPath(pathname: string): boolean {
  return /^\/api\/pty\/[^/]+\/connect$/.test(pathname);
}

function extractNativePtyIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/pty\/([^/]+)\/connect$/);
  if (!match) return null;
  return decodeURIComponent(match[1]);
}

function createPtyPlugin(): IPlugin<{ pty: IPtyService }, ICliHooks, ICliConfig> {
  return {
    name: 'pty',
    apply(ctx) {
      if (ctx.config.command !== 'serve' || ctx.config.helpRequested || ctx.config.versionRequested) {
        return;
      }

      const pty = ctx.services.require('pty');
      const nativePtyConnections = new Map<unknown, TPtySocketConnection>();

      ctx.hooks.wsUpgrade.tap((req) => {
        const url = new URL(req.url);
        return isNativePtyConnectPath(url.pathname);
      });

      ctx.hooks.wsOpen.tap((ws) => {
        const socket = ws as TBunPtySocket;
        const path = socket.data?.path;
        if (!path || !isNativePtyConnectPath(path)) return;

        const ptyID = extractNativePtyIdFromPath(path);
        if (!ptyID) {
          socket.close(1008, 'Invalid PTY path');
          return;
        }

        const query = new URLSearchParams(socket.data?.query ?? '');
        const workingDirectory = query.get('workingDirectory');
        if (!workingDirectory) {
          socket.close(1008, 'Missing workingDirectory');
          return;
        }

        const filesystemId = query.get('filesystemId') ?? undefined;
        const rawCursor = query.get('cursor');
        const cursor = rawCursor === null ? undefined : Number.parseInt(rawCursor, 10);
        const attachment = pty.attach({
          filesystemId,
          workingDirectory,
          ptyID,
          cursor: Number.isFinite(cursor) ? cursor : undefined,
          send: (data) => {
            if (socket.readyState !== WebSocket.OPEN) return;
            socket.send(new Uint8Array(data));
          },
          close: (code, reason) => {
            if (socket.readyState !== WebSocket.OPEN) return;
            socket.close(code ?? 1000, reason ?? 'PTY closed');
          },
        });

        if (!attachment) {
          socket.close(1008, 'PTY not found');
          return;
        }

        nativePtyConnections.set(ws, attachment);
      });

      ctx.hooks.wsMessage.tap((ws, message) => {
        const socket = ws as TBunPtySocket;
        const path = socket.data?.path;
        if (!path || !isNativePtyConnectPath(path)) return;

        const connection = nativePtyConnections.get(ws);
        if (!connection) return;
        connection.send(message as string | Buffer | ArrayBuffer | Uint8Array);
      });

      ctx.hooks.wsClose.tap((ws) => {
        const socket = ws as TBunPtySocket;
        const path = socket.data?.path;
        if (!path || !isNativePtyConnectPath(path)) return;

        const connection = nativePtyConnections.get(ws);
        if (!connection) return;
        nativePtyConnections.delete(ws);
        connection.detach();
      });

      ctx.hooks.shutdown.tapPromise(async () => {
        for (const connection of nativePtyConnections.values()) {
          connection.detach();
        }
        nativePtyConnections.clear();
      });
    },
  };
}

export { createPtyPlugin };
