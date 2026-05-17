type TVibecanvasActorSnapshot = {
  id: string;
  state: string;
  context: Record<string, unknown>;
};

type TVibecanvasWidgetToHostMessage =
  | { type: "vibecanvas.actor.send"; eventName: string; params: Record<string, unknown>; correlationId?: string }
  | { type: "vibecanvas.actor.subscribe" }
  | { type: "vibecanvas.host.update"; patch: { width?: number; height?: number; window?: "contained" | "minimized" | "fullscreen" } };

type TVibecanvasHostToWidgetMessage =
  | { type: "vibecanvas.actor.snapshot"; snapshot: TVibecanvasActorSnapshot | null }
  | { type: "vibecanvas.actor.error"; message: string };

type TVibecanvasWidgetBridge = {
  getActorSnapshot(): TVibecanvasActorSnapshot | null | Promise<TVibecanvasActorSnapshot | null>;
  sendActorMessage(eventName: string, params?: Record<string, unknown>, correlationId?: string): void | Promise<void>;
  onActorSnapshot(callback: (snapshot: TVibecanvasActorSnapshot) => void): () => void;
  requestHostUpdate?(patch: { width?: number; height?: number; window?: "contained" | "minimized" | "fullscreen" }): void | Promise<void>;
};

type TWidgetGlobal = typeof globalThis & {
  output?: (payload: unknown) => void;
  __vibecanvasBridge?: TVibecanvasWidgetBridge;
  __vibecanvasReceive?: (message: TVibecanvasHostToWidgetMessage) => void;
  __vibecanvasSnapshot?: TVibecanvasActorSnapshot | null;
};

let bridge: TVibecanvasWidgetBridge | null = null;
const snapshotListeners = new Set<(snapshot: TVibecanvasActorSnapshot) => void>();

function getWidgetGlobal(): TWidgetGlobal {
  return globalThis as TWidgetGlobal;
}

function emitToHost(message: TVibecanvasWidgetToHostMessage): void {
  const output = getWidgetGlobal().output;
  if (typeof output !== "function") return;
  output(message);
}

function receiveFromHost(message: TVibecanvasHostToWidgetMessage): void {
  if (message.type !== "vibecanvas.actor.snapshot") return;
  getWidgetGlobal().__vibecanvasSnapshot = message.snapshot;
  if (!message.snapshot) return;
  for (const listener of snapshotListeners) listener(message.snapshot);
}

function createSandboxBridge(): TVibecanvasWidgetBridge {
  getWidgetGlobal().__vibecanvasReceive = receiveFromHost;

  return {
    getActorSnapshot() {
      emitToHost({ type: "vibecanvas.actor.subscribe" });
      return getWidgetGlobal().__vibecanvasSnapshot ?? null;
    },
    sendActorMessage(eventName, params = {}, correlationId) {
      emitToHost({ type: "vibecanvas.actor.send", eventName, params, correlationId });
    },
    onActorSnapshot(callback) {
      snapshotListeners.add(callback);
      emitToHost({ type: "vibecanvas.actor.subscribe" });
      const snapshot = getWidgetGlobal().__vibecanvasSnapshot;
      if (snapshot) callback(snapshot);
      return () => snapshotListeners.delete(callback);
    },
    requestHostUpdate(patch) {
      emitToHost({ type: "vibecanvas.host.update", patch });
    },
  };
}

function installVibecanvasBridge(nextBridge: TVibecanvasWidgetBridge) {
  bridge = nextBridge;
  getWidgetGlobal().__vibecanvasBridge = nextBridge;
  return () => {
    if (bridge === nextBridge) bridge = null;
    if (getWidgetGlobal().__vibecanvasBridge === nextBridge) delete getWidgetGlobal().__vibecanvasBridge;
  };
}

function getVibecanvasBridge() {
  return bridge ?? getWidgetGlobal().__vibecanvasBridge ?? createSandboxBridge();
}

export { getVibecanvasBridge, installVibecanvasBridge };
export type { TVibecanvasActorSnapshot, TVibecanvasHostToWidgetMessage, TVibecanvasWidgetBridge, TVibecanvasWidgetToHostMessage };
