// src/actor.ts
function defineActorJson(definition) {
  return definition;
}
function defineActorFunctions(functions) {
  return functions;
}
var defineActor = defineActorJson;
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
// src/machine.ts
import { reactive } from "@arrow-js/core";
var VIBECANVAS_OFFICIAL_MACHINE_STATES = [
  "booting",
  "ready",
  "busy",
  "waiting",
  "dirty",
  "error",
  "disabled",
  "disposed"
];
function getEventType(event) {
  return typeof event === "string" ? event : event.type;
}
function isOfficialMachineState(value) {
  return VIBECANVAS_OFFICIAL_MACHINE_STATES.includes(value);
}
function getVibecanvasMachineStatus(value) {
  const status = value.split(".", 1)[0] ?? "ready";
  return isOfficialMachineState(status) ? status : "ready";
}
function hasConfiguredState(config, value) {
  if (!config.states)
    return true;
  return value in config.states;
}
function resolveTransitionTarget(transition) {
  return typeof transition === "string" ? transition : transition.target;
}
function resolvePersistence(config) {
  if (!config.persist)
    return null;
  const persistConfig = config.persist === true ? {} : config.persist;
  const id = persistConfig.id ?? config.id;
  if (!id || !persistConfig.portal)
    return null;
  return { id, portal: persistConfig.portal };
}
function toSnapshot(state) {
  return {
    value: state.value,
    previous: state.previous,
    event: state.event,
    changedAt: state.changedAt,
    meta: state.meta
  };
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function normalizeSnapshot(config, snapshot) {
  if (!snapshot || !isRecord(snapshot) || typeof snapshot.value !== "string")
    return null;
  const value = snapshot.value;
  if (!hasConfiguredState(config, value))
    return null;
  return {
    value,
    previous: typeof snapshot.previous === "string" ? snapshot.previous : null,
    event: typeof snapshot.event === "string" ? snapshot.event : null,
    changedAt: typeof snapshot.changedAt === "number" ? snapshot.changedAt : Date.now(),
    meta: isRecord(snapshot.meta) ? snapshot.meta : {}
  };
}
function getVibecanvasOfficialMachineStates() {
  return [...VIBECANVAS_OFFICIAL_MACHINE_STATES];
}
function machine(config = {}) {
  const initial = config.initial ?? "booting";
  const persistence = resolvePersistence(config);
  const state = reactive({
    value: initial,
    previous: null,
    event: null,
    changedAt: Date.now(),
    meta: {}
  });
  let restored = false;
  const persist = () => {
    if (!persistence)
      return;
    persistence.portal.saveMachineState(persistence.id, toSnapshot(state));
  };
  const runEnterHooks = async (reason, event) => {
    const definition = config.states?.[state.value];
    if (!definition)
      return;
    const args = { state, reason, event, send, set };
    if (reason === "restore") {
      await definition.onRestore?.(args);
    }
    await definition.onEnter?.(args);
  };
  const applyState = (value, meta, reason, event) => {
    state.previous = state.value;
    state.value = value;
    state.changedAt = Date.now();
    state.meta = meta;
    persist();
    runEnterHooks(reason, event);
  };
  const set = (value, meta = {}) => {
    applyState(value, meta, "set", null);
  };
  const can = (event) => {
    const eventType = getEventType(event);
    return Boolean(config.states?.[state.value]?.on?.[eventType]);
  };
  const send = async (event) => {
    const eventType = getEventType(event);
    const transition = config.states?.[state.value]?.on?.[eventType];
    if (!transition)
      return false;
    if (typeof transition !== "string") {
      const args = { state, event };
      if (transition.guard && !transition.guard(args))
        return false;
      await transition.action?.(args);
    }
    state.event = eventType;
    applyState(resolveTransitionTarget(transition), typeof transition === "string" ? {} : transition.meta ?? {}, "transition", event);
    return true;
  };
  const status = () => getVibecanvasMachineStatus(state.value);
  const restore = async () => {
    if (!persistence || restored)
      return;
    restored = true;
    const snapshot = normalizeSnapshot(config, await persistence.portal.loadMachineState(persistence.id));
    if (!snapshot) {
      persist();
      await runEnterHooks("initial", null);
      return;
    }
    state.previous = snapshot.previous;
    state.value = snapshot.value;
    state.event = snapshot.event;
    state.changedAt = snapshot.changedAt;
    state.meta = snapshot.meta;
    persist();
    await runEnterHooks("restore", null);
  };
  if (persistence) {
    restore();
  } else {
    runEnterHooks("initial", null);
  }
  return { state, status, send, set, can };
}
// src/config.ts
function defineVibecanvasConfig(config) {
  return config;
}
function defineWidgetAddon(config) {
  return config;
}
export {
  useActor,
  machine,
  installVibecanvasBridge,
  getVibecanvasOfficialMachineStates,
  getVibecanvasMachineStatus,
  getVibecanvasBridge,
  defineWidgetAddon,
  defineWidget,
  defineVibecanvasConfig,
  defineActorJson,
  defineActorFunctions,
  defineActor
};
