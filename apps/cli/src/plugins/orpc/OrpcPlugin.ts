import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/bun-ws';
import type { IRuntimeServices } from '@vibecanvas/cli/setup-services';
import type { TActorApiCapability } from '@vibecanvas/api/actor/types';
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
  | 'actor'
  | 'agent'
  | 'automerge'
  | 'db'
  | 'eventPublisher'
  | 'filesystem'
  | 'functionInvocation'
  | 'humanResourceSecret'
  | 'pty'
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
    filesystem: services.filesystem,
    functionInvocation: services.functionInvocation,
    humanResourceSecret: services.humanResourceSecret,
    pty: services.pty,
    resource: services.resource,
    widget: services.widget,
    widgetRuntimeLoadAdmission: services.widgetRuntimeLoadAdmission,
    actor: createLazyTenantServiceCapability<TActorApiCapability>(
      () => services.actor.forTenant(tenant),
    ),
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
      const filesystem = ctx.services.require('filesystem');
      const functionInvocation = ctx.services.require('functionInvocation');
      const humanResourceSecret = ctx.services.require('humanResourceSecret');
      const pty = ctx.services.require('pty');
      const resource = ctx.services.require('resource');
      const widget = ctx.services.require('widget');
      const widgetRuntimeLoadAdmission = ctx.services.require('widgetRuntimeLoadAdmission');
      const actor = ctx.services.require('actor');
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
            filesystem,
            functionInvocation,
            humanResourceSecret,
            pty,
            resource,
            widget,
            widgetRuntimeLoadAdmission,
            actor,
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
