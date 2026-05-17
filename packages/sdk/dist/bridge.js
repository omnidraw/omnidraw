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
export {
  installVibecanvasBridge,
  getVibecanvasBridge
};
