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
  websocket?: PartySocketWebSocket;
};

function createOpenGatedClient(
  resolveClient: () => unknown,
  waitUntilOpen: () => Promise<void>,
  path: readonly PropertyKey[] = [],
): unknown {
  const callable = () => undefined;
  return new Proxy(callable, {
    get(_target, property) {
      return createOpenGatedClient(resolveClient, waitUntilOpen, [...path, property]);
    },
    async apply(_target, _thisArg, args) {
      await waitUntilOpen();
      let parent = resolveClient() as Record<PropertyKey, unknown>;
      for (const part of path.slice(0, -1)) {
        parent = parent[part] as Record<PropertyKey, unknown>;
      }
      const method = parent[path.at(-1)!];
      if (typeof method !== "function") {
        throw new Error("The active ORPC client method is unavailable.");
      }
      return Reflect.apply(method, parent, args);
    },
  });
}

function getRpcWebsocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api`;
}

class OrpcWebsocketService {
  readonly client: TOrpcClient;
  readonly apiService: TOrpcSafeClient;
  readonly websocket: PartySocketWebSocket;
  #disposed = false;

  get safeClient() {
    return this.apiService;
  }

  constructor(args: TCreateOrpcWebsocketServiceArgs = {}) {
    this.websocket = args.websocket
      ?? new PartySocketWebSocket(args.websocketUrl ?? getRpcWebsocketUrl());

    const link = new RPCLink({
      // @ts-ignore PartySocket exposes the WebSocket runtime contract; published readyState typings vary by resolver.
      websocket: this.websocket,
    });

    this.client = createORPCClient(link);
    const openGatedClient = createOpenGatedClient(
      () => this.client,
      () => this.waitUntilOpen(),
    ) as TOrpcClient;
    this.apiService = createSafeClient(openGatedClient);

  }

  waitUntilOpen(): Promise<void> {
    if (this.#disposed) {
      return Promise.reject(new Error("The WebSocket connection is closed."));
    }
    if (this.websocket.readyState === this.websocket.OPEN) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.websocket.removeEventListener("open", onOpen);
        this.websocket.removeEventListener("close", onClose);
        this.websocket.removeEventListener("error", onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new Error("The WebSocket connection closed before opening."));
      };
      const onError = () => {
        cleanup();
        reject(new Error("The WebSocket connection failed before opening."));
      };
      this.websocket.addEventListener("open", onOpen);
      this.websocket.addEventListener("close", onClose);
      this.websocket.addEventListener("error", onError);
      if (this.websocket.readyState === this.websocket.OPEN) onOpen();
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.websocket.close(1000, 'Tenant client disposed');
  }
}

export { apiContract, contract, getRpcWebsocketUrl, OrpcWebsocketService };
export type { TCreateOrpcWebsocketServiceArgs, TNotificationEvent, TOrpcClient, TOrpcSafeClient };
