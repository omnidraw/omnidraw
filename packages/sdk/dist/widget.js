// src/bridge.ts
var bridge = null;
var snapshotListeners = new Set;
function getWidgetGlobal() {
  return globalThis;
}
function emitToHost(message) {
  const output = getWidgetGlobal().output;
  if (typeof output !== "function")
    return;
  output(message);
}
function receiveFromHost(message) {
  if (message.type !== "vibecanvas.actor.snapshot")
    return;
  getWidgetGlobal().__vibecanvasSnapshot = message.snapshot;
  if (!message.snapshot)
    return;
  for (const listener of snapshotListeners)
    listener(message.snapshot);
}
function createSandboxBridge() {
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
      if (snapshot)
        callback(snapshot);
      return () => snapshotListeners.delete(callback);
    },
    requestHostUpdate(patch) {
      emitToHost({ type: "vibecanvas.host.update", patch });
    }
  };
}
function installVibecanvasBridge(nextBridge) {
  bridge = nextBridge;
  getWidgetGlobal().__vibecanvasBridge = nextBridge;
  return () => {
    if (bridge === nextBridge)
      bridge = null;
    if (getWidgetGlobal().__vibecanvasBridge === nextBridge)
      delete getWidgetGlobal().__vibecanvasBridge;
  };
}
function getVibecanvasBridge() {
  return bridge ?? getWidgetGlobal().__vibecanvasBridge ?? createSandboxBridge();
}
// src/widget.ts
function defineWidget(widget) {
  return widget;
}
function useActor() {
  const bridge2 = getVibecanvasBridge();
  return {
    async snapshot() {
      return bridge2.getActorSnapshot();
    },
    state() {
      const snapshot = bridge2.getActorSnapshot();
      return snapshot instanceof Promise ? null : snapshot;
    },
    send(eventName, params = {}, correlationId) {
      return bridge2.sendActorMessage(eventName, params, correlationId);
    },
    onState(callback) {
      return bridge2.onActorSnapshot(callback);
    },
    requestHostUpdate(patch) {
      return bridge2.requestHostUpdate?.(patch);
    }
  };
}
export {
  useActor,
  defineWidget
};
