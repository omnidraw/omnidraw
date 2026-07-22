import { createORPCClient, createSafeClient, type SafeClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { ContractRouterClient } from "@orpc/contract";
import { apiContract, contract } from "@vibecanvas/api/contract";
export type {
  TWidgetCatalog,
  TWidgetCatalogEntry,
  TWidgetCatalogGroup,
  TWidgetCatalogProblem,
  TWidgetDeleteResult,
  TWidgetDetail,
  TWidgetDraftMetadataPatch,
  TWidgetDraftMetadataPatchResult,
  TWidgetDraftToolPatch,
  TWidgetFileEntry,
  TWidgetFilePreview,
  TWidgetRelation,
  TWidgetSource,
  TWidgetVariantSummary,
  TWidgetPlacementResolveResult,
  TWidgetFrameBounds,
  TWidgetPlacementRef,
  TWidgetPlacementSummary,
  TWidgetCatalogPreviewSummary,
  TWidgetDraftSummary,
  TWidgetPreviewCloseResult,
  TWidgetPreviewFunctionInvocationView,
  TWidgetPreviewResult,
} from "@vibecanvas/api/agent/contract";
import type { TNotificationEvent } from "@vibecanvas/api/notification/contract";
import type { TPtyImageFormat } from "@vibecanvas/api/pty/contract";
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

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Failed to read clipboard image"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read clipboard image"));
    };
    reader.readAsDataURL(file);
  });
}

function toPtyImageFormat(type: string): TPtyImageFormat | null {
  if (type === "image/jpeg") return type;
  if (type === "image/png") return type;
  if (type === "image/gif") return type;
  if (type === "image/webp") return type;
  return null;
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

  async uploadClipboardImageToPtyTemp(args: { workingDirectory: string; file: File | Blob }) {
    const format = toPtyImageFormat(args.file.type);
    if (!format) {
      return [new Error(`Unsupported clipboard image type: ${args.file.type || "unknown"}`), null] as const;
    }

    try {
      const base64 = await fileToDataUrl(args.file);
      return this.apiService.api.pty.uploadImage({
        workingDirectory: args.workingDirectory,
        body: {
          base64,
          format,
        },
      });
    } catch (error) {
      return [error, null] as const;
    }
  }

  dispose(): void {
    this.websocket.close(1000, 'Tenant client disposed');
  }
}

export { apiContract, contract, getRpcWebsocketUrl, OrpcWebsocketService };
export type { TCreateOrpcWebsocketServiceArgs, TNotificationEvent, TOrpcClient, TOrpcSafeClient, TPtyImageFormat };
