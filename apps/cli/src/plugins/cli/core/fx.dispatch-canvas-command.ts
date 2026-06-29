/* eslint-disable functional-core/fx-tx-params, functional-core/no-runtime-globals -- legacy fx command dispatcher reads Bun runtime directly */
import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { ICliConfig } from '@vibecanvas/cli/config';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import type { TSafeCanvasCmdClient } from './fn.build-rpc-link';
import { fnBuildRpcLink } from './fn.build-rpc-link';
import { fxDiscoverLocalCanvasServer } from './fx.canvas.server-discovery';

export type TCanvasCliServices = {
  db: IDbService;
  automerge: IAutomergeService;
};

export async function fxDispatchCanvasCommand<TResult>(
  services: TCanvasCliServices,
  config: ICliConfig,
  handlers: {
    client: (safeClient: TSafeCanvasCmdClient) => Promise<TResult>;
    local: () => Promise<TResult>;
  },
): Promise<TResult> {
  const shouldTryClientFirst = !config.rawArgv.includes('--db');

  if (shouldTryClientFirst) {
    const serverHealth = await fxDiscoverLocalCanvasServer({ bun: Bun }, { config });
    if (serverHealth) {
      return handlers.client(fnBuildRpcLink(serverHealth));
    }
  }

  return handlers.local();
}
