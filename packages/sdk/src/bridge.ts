type TVibecanvasActorSnapshot = {
  id: string;
  state: string;
  context: Record<string, unknown>;
};

type TVibecanvasWidgetBridge = {
  getActorSnapshot(): TVibecanvasActorSnapshot | null | Promise<TVibecanvasActorSnapshot | null>;
  sendActorMessage(eventName: string, params?: Record<string, unknown>, correlationId?: string): void | Promise<void>;
  onActorSnapshot(callback: (snapshot: TVibecanvasActorSnapshot) => void): () => void;
  requestHostUpdate?(patch: { width?: number; height?: number; window?: "contained" | "minimized" | "fullscreen" }): void | Promise<void>;
};

let bridge: TVibecanvasWidgetBridge | null = null;

function installVibecanvasBridge(nextBridge: TVibecanvasWidgetBridge) {
  bridge = nextBridge;
  return () => {
    if (bridge === nextBridge) bridge = null;
  };
}

function getVibecanvasBridge() {
  if (!bridge) {
    throw new Error("Vibecanvas widget bridge is not installed");
  }
  return bridge;
}

export { getVibecanvasBridge, installVibecanvasBridge };
export type { TVibecanvasActorSnapshot, TVibecanvasWidgetBridge };
