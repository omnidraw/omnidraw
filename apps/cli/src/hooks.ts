import { AsyncSeriesHook, AsyncWaterfallHook, SyncExitHook, SyncHook } from '@omnidraw/tapable';
import type { IPluginContext, IServiceMap } from '@omnidraw/runtime';
import type { ICliConfig } from './config';

export type THttpRequestHookPayload = {
  request: Request;
  response: Response | null;
};

export interface ICliHooks {
  boot: AsyncSeriesHook<[]>;
  ready: AsyncSeriesHook<[]>;
  shutdown: AsyncSeriesHook<[]>;

  httpRequest: AsyncWaterfallHook<THttpRequestHookPayload>;

  wsUpgrade: SyncExitHook<[Request]>;
  wsOpen: SyncHook<[WebSocket]>;
  wsMessage: SyncHook<[WebSocket, string | Buffer]>;
  wsClose: SyncHook<[WebSocket]>;
  wsPong: SyncHook<[WebSocket, Buffer]>;

  registerCommands: SyncHook<[]>;
}

export function createCliHooks(): ICliHooks {
  return {
    boot: new AsyncSeriesHook<[]>(),
    ready: new AsyncSeriesHook<[]>(),
    shutdown: new AsyncSeriesHook<[]>(),

    httpRequest: new AsyncWaterfallHook<THttpRequestHookPayload>(),

    wsUpgrade: new SyncExitHook<[Request]>(),
    wsOpen: new SyncHook<[WebSocket]>(),
    wsMessage: new SyncHook<[WebSocket, string | Buffer]>(),
    wsClose: new SyncHook<[WebSocket]>(),
    wsPong: new SyncHook<[WebSocket, Buffer]>(),

    registerCommands: new SyncHook<[]>(),
  };
}

export async function bootCliRuntime(ctx: IPluginContext<IServiceMap, ICliHooks, ICliConfig>) {
  await ctx.hooks.boot.promise();
  ctx.hooks.registerCommands.call();
  await ctx.hooks.ready.promise();
}

export async function shutdownCliRuntime(ctx: IPluginContext<IServiceMap, ICliHooks, ICliConfig>) {
  await ctx.hooks.shutdown.promise();
}
