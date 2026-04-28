// src/actor.ts
function createActorRuntime(portal = {}) {
  let definition = null;
  const handlers = new Map;
  function defineActor(nextDefinition) {
    definition = nextDefinition;
    portal.onDefinition?.(nextDefinition);
    Object.entries(nextDefinition.inputs ?? {}).forEach(([input, inputDefinition]) => {
      if (!inputDefinition.handle)
        return;
      const inputHandlers = handlers.get(input) ?? new Set;
      inputHandlers.add(inputDefinition.handle);
      handlers.set(input, inputHandlers);
    });
  }
  function onActor(input, handler) {
    const inputHandlers = handlers.get(input) ?? new Set;
    inputHandlers.add(handler);
    handlers.set(input, inputHandlers);
    return () => {
      inputHandlers.delete(handler);
      if (inputHandlers.size === 0) {
        handlers.delete(input);
      }
    };
  }
  function emitActor(output, payload) {
    portal.onEmit?.({ output, payload });
  }
  async function deliverActor(input, payload) {
    const inputHandlers = [...handlers.get(input) ?? []];
    await Promise.all(inputHandlers.map((handler) => handler(payload)));
    return inputHandlers.length;
  }
  function getActorDefinition() {
    return definition;
  }
  return {
    defineActor,
    onActor,
    emitActor,
    deliverActor,
    getActorDefinition
  };
}
var actorRuntime = createActorRuntime();
function defineActor(definition) {
  actorRuntime.defineActor(definition);
}
function onActor(input, handler) {
  return actorRuntime.onActor(input, handler);
}
function emitActor(output, payload) {
  actorRuntime.emitActor(output, payload);
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
function getOfficialState(config, value) {
  return config.states?.[value]?.official ?? (isOfficialMachineState(value) ? value : "ready");
}
function resolveTransitionTarget(transition) {
  return typeof transition === "string" ? transition : transition.target;
}
function getVibecanvasOfficialMachineStates() {
  return [...VIBECANVAS_OFFICIAL_MACHINE_STATES];
}
function machine(config = {}) {
  const booting = "booting";
  const state = reactive({
    value: booting,
    official: "booting",
    previous: null,
    event: null,
    changedAt: Date.now(),
    meta: {}
  });
  const set = (value, meta = {}) => {
    state.previous = state.value;
    state.value = value;
    state.official = getOfficialState(config, value);
    state.changedAt = Date.now();
    state.meta = meta;
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
    set(resolveTransitionTarget(transition), typeof transition === "string" ? {} : transition.meta ?? {});
    return true;
  };
  return { state, send, set, can };
}
export {
  onActor,
  machine,
  getVibecanvasOfficialMachineStates,
  emitActor,
  defineActor,
  createActorRuntime
};
