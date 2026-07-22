import type { TOrpcSafeClient } from "@vibecanvas/orpc-client";

type TApi = TOrpcSafeClient["api"];

export type TAiChatApiPort = {
  api: {
    agent: Pick<TApi["agent"], "settings" | "auth" | "chat" | "approval" | "events" | "widgets" | "widgetPublish"> & {
      widgetDraft: Pick<TApi["agent"]["widgetDraft"], "list" | "get" | "validate">;
      widgetPreview: Pick<TApi["agent"]["widgetPreview"], "get" | "build" | "close" | "invoke"> & {
        invocation: Pick<TApi["agent"]["widgetPreview"]["invocation"], "get" | "cancel">;
      };
    };
    resource: Pick<TApi["resource"], "resources">;
  };
};

export type TWidgetTransportPort = {
  api: {
    actors: Pick<TApi["actors"], "definitions" | "instances" | "events">;
    agent?: Pick<TApi["agent"], "events" | "widgets">;
    widget: Pick<TApi['widget'], 'runtime'>;
    function: Pick<TApi['function'], 'invoke' | 'get'>;
  };
};

export type TAiChatBrowserPort = {
  document: Document;
  createResizeObserver(callback: ResizeObserverCallback): Pick<ResizeObserver, "observe" | "disconnect">;
  createId(): string;
  createObjectUrl(file: File): string;
  revokeObjectUrl(url: string): void;
  readFileAsDataUrl(file: File): Promise<string>;
  writeClipboardText(text: string): Promise<void>;
  formatTime(value: string | number | Date): string;
  setInterval(callback: () => void, timeout: number): unknown;
  clearInterval(timer: unknown): void;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
};

export type TWidgetBrowserPort = {
  document: Document;
  createId(): string;
  organizationId(): string;
  tenantAuthorityKey(): string;
  now(): number;
  nowDate(): Date;
  setTimeout(callback: () => void, timeout: number): unknown;
  clearTimeout(timer: unknown): void;
  setInterval(callback: () => void, timeout: number): unknown;
  clearInterval(timer: unknown): void;
  decodeBase64(value: string): Uint8Array;
  decodeUtf8(value: Uint8Array): string;
  digestSha256(value: Uint8Array): Promise<string>;
};

export type TAiChatApplicationPort = {
  openResource?(resourceId: string): void;
  invalidateResourceCatalog(): void;
  invalidateWidgetCatalog?(): void;
  subscribeCatalogInvalidation?(kind: "resources" | "widgets", listener: () => void): () => void;
  logError(error: unknown): void;
};
