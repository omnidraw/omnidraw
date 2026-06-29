/* eslint-disable functional-core/import-boundary -- legacy fn file builds runtime ORPC clients */
import { createORPCClient, createSafeClient, type SafeClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { canvasCmdApiContract } from '@vibecanvas/api-canvas-cmd/contract';
import type { TCanvasServerHealth } from './fx.canvas.server-discovery';
export type TCanvasCmdClient = ContractRouterClient<typeof canvasCmdApiContract>;
export type TSafeCanvasCmdClient = SafeClient<TCanvasCmdClient>;

export function fnBuildRpcLink(serverHealth: TCanvasServerHealth) {
  const link = new RPCLink({
    url: `http://localhost:${serverHealth?.port}/rpc`,
  })

  const client: TCanvasCmdClient = createORPCClient(link);
  const safeClient: TSafeCanvasCmdClient = createSafeClient(client);

  return safeClient
}
