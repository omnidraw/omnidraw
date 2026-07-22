import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/bun-ws';
import type { IRuntimeServices } from '@vibecanvas/cli/setup-services';
import type { TAgentApiCapability } from '@vibecanvas/api/agent/types';
import type { TApiContext } from '@vibecanvas/api/context';
import type { IPlugin } from '@vibecanvas/runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';
import { createLazyTenantServiceCapability } from '../../services/LazyTenantServiceCapability';
import { baseOs } from './orpc.base';
import { router } from './router';

type TOrpcWebSocketData = {
  path: string;
  query: string;
  requestId: string;
  tenant: TTenantContext;
};

type TOrpcTenantContextServices = Pick<IRuntimeServices,
  | 'agent'
  | 'automerge'
  | 'db'
  | 'eventPublisher'
  | 'functionInvocation'
  | 'humanResourceSecret'
  | 'resource'
  | 'widget'
  | 'widgetRuntimeLoadAdmission'
>;

function createOrpcTenantContext(
  tenant: TTenantContext,
  services: TOrpcTenantContextServices,
): TApiContext {
  return {
    tenant,
    automerge: services.automerge,
    db: services.db,
    eventPublisher: services.eventPublisher,
    functionInvocation: services.functionInvocation,
    humanResourceSecret: services.humanResourceSecret,
    resource: services.resource,
    widget: services.widget,
    widgetRuntimeLoadAdmission: services.widgetRuntimeLoadAdmission,
    agent: createLazyTenantServiceCapability<TAgentApiCapability>(
      () => services.agent.forTenant(tenant),
    ),
  };
}

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
      const functionInvocation = ctx.services.require('functionInvocation');
      const humanResourceSecret = ctx.services.require('humanResourceSecret');
      const resource = ctx.services.require('resource');
      const widget = ctx.services.require('widget');
      const widgetRuntimeLoadAdmission = ctx.services.require('widgetRuntimeLoadAdmission');
      const agent = ctx.services.require('agent');
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

        const tenant = socket.data.tenant;
        void handler.message(ws as never, message, {
          context: createOrpcTenantContext(tenant, {
            automerge,
            db,
            eventPublisher,
            functionInvocation,
            humanResourceSecret,
            resource,
            widget,
            widgetRuntimeLoadAdmission,
            agent,
          }),
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

export { createOrpcPlugin, createOrpcTenantContext };
export type { TOrpcTenantContextServices, TOrpcWebSocketData };
