import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/bun-ws';
import type { IRuntimeServices } from '@omnidraw/cli/setup-services';
import type { TApiContext } from '@omnidraw/api/context';
import type { IPlugin } from '@omnidraw/runtime';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';
import { baseOs } from './orpc.base';
import { router } from './router';

type TOrpcWebSocketData = {
  path: string;
  query: string;
  requestId: string;
};

type TOrpcContextServices = Pick<IRuntimeServices,
  | 'agent'
  | 'canvas'
  | 'db'
  | 'eventPublisher'
  | 'functionInvocation'
  | 'humanResourceSecret'
  | 'resource'
  | 'widgetCatalog'
  | 'widgetPreview'
  | 'widgetCapsuleHostConfiguration'
  | 'widgetRuntimeLoadAdmission'
  | 'widgetState'
>;

function createOrpcContext(
  services: TOrpcContextServices,
): TApiContext {
  return {
    agent: services.agent,
    canvas: services.canvas,
    db: services.db,
    eventPublisher: services.eventPublisher,
    functionInvocation: services.functionInvocation,
    humanResourceSecret: services.humanResourceSecret,
    resource: services.resource,
    widgetCatalog: services.widgetCatalog,
    widgetPreview: services.widgetPreview,
    widgetState: services.widgetState,
    widgetCapsuleHostConfiguration: services.widgetCapsuleHostConfiguration,
    widgetRuntimeLoadAdmission: services.widgetRuntimeLoadAdmission,
  };
}

function createOrpcPlugin(): IPlugin<IRuntimeServices, ICliHooks, ICliConfig> {
  return {
    name: 'orpc',
    apply(ctx) {
      if (ctx.config.command !== 'serve' || ctx.config.helpRequested || ctx.config.versionRequested) {
        return;
      }

      const canvas = ctx.services.require('canvas');
      const db = ctx.services.require('db');
      const eventPublisher = ctx.services.require('eventPublisher');
      const functionInvocation = ctx.services.require('functionInvocation');
      const humanResourceSecret = ctx.services.require('humanResourceSecret');
      const resource = ctx.services.require('resource');
      const widgetCatalog = ctx.services.require('widgetCatalog');
      const widgetPreview = ctx.services.require('widgetPreview');
      const widgetCapsuleHostConfiguration = ctx.services.require(
        'widgetCapsuleHostConfiguration',
      );
      const widgetRuntimeLoadAdmission = ctx.services.require('widgetRuntimeLoadAdmission');
      const widgetState = ctx.services.require('widgetState');
      const agent = ctx.services.require('agent');
      ctx.hooks.boot.tapPromise(async () => {
        await widgetCatalog.start();
      });
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

      const context = createOrpcContext({
        agent,
        canvas,
        db,
        eventPublisher,
        functionInvocation,
        humanResourceSecret,
        resource,
        widgetCatalog,
        widgetPreview,
        widgetState,
        widgetCapsuleHostConfiguration,
        widgetRuntimeLoadAdmission,
      });
      ctx.hooks.wsMessage.tap((ws, message) => {
        const socket = ws as WebSocket & { data?: TOrpcWebSocketData };
        if (socket.data?.path !== '/api') return;

        void handler.message(ws as never, message, { context }).catch((error) => {
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

export { createOrpcPlugin, createOrpcContext };
export type { TOrpcContextServices, TOrpcWebSocketData };
