import { createORPCClient, createSafeClient, type SafeClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { ContractRouterClient } from "@orpc/contract";
import { apiContract, contract } from "@omnidraw/api/contract";
export type {
  TWidgetPublicCatalog,
  TWidgetPublicCatalogEntry,
  TWidgetPublicCatalogForm,
  TWidgetPublicCatalogDifferences,
  TWidgetPublicFileEntry,
  TWidgetPublicFileList,
  TWidgetPublicFilePreview,
  TWidgetPublicIssue,
  TWidgetPublicMutationResult,
  TWidgetPublicPlacement,
} from "@omnidraw/api/widget/public-types";
import type { TNotificationEvent } from "@omnidraw/api/notification/contract";
import { WebSocket as PartySocketWebSocket } from "partysocket";

type TOrpcClient = ContractRouterClient<typeof apiContract>;
type TOrpcSafeClient = SafeClient<TOrpcClient>;

type TCreateOrpcWebsocketServiceArgs = {
  websocketUrl?: string;
};

function getRpcWebsocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api`;
}

class OrpcWebsocketService {
  readonly client: TOrpcClient;
  readonly apiService: TOrpcSafeClient;
  readonly websocket: PartySocketWebSocket;

  get safeClient() {
    return this.apiService;
  }

  constructor(args: TCreateOrpcWebsocketServiceArgs = {}) {
    this.websocket = new PartySocketWebSocket(args.websocketUrl ?? getRpcWebsocketUrl());

    const link = new RPCLink({
      // @ts-ignore PartySocket exposes the WebSocket runtime contract; published readyState typings vary by resolver.
      websocket: this.websocket,
    });

    this.client = createORPCClient(link);
    this.apiService = createSafeClient(this.client);

  }

  dispose(): void {
    this.websocket.close(1000, 'Tenant client disposed');
  }
}

export { apiContract, contract, getRpcWebsocketUrl, OrpcWebsocketService };
export type { TCreateOrpcWebsocketServiceArgs, TNotificationEvent, TOrpcClient, TOrpcSafeClient };
