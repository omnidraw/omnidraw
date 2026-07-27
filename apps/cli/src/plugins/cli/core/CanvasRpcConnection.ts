import { createORPCClient, createSafeClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/websocket';
import type { ContractRouterClient } from '@orpc/contract';
import type { apiContract } from '@vibecanvas/api/contract';
import type {
  ICanvasCliApi,
  ICanvasRpcConnection,
} from '../cmds/interface';

type TApiClient = ContractRouterClient<typeof apiContract>;

export function createCanvasRpcConnection(
  websocketUrl: string,
): ICanvasRpcConnection {
  const websocket = new WebSocket(websocketUrl);
  const link = new RPCLink({ websocket });
  const client = createORPCClient<TApiClient>(link);
  const safeClient = createSafeClient(client);

  return {
    api: safeClient.api.canvas as unknown as ICanvasCliApi,
    close(): void {
      websocket.close(1000, 'Canvas CLI command complete');
    },
  };
}
