/// <reference path="./arrow-core.d.ts" />
import { reactive } from "@arrow-js/core";

/** Official actor states known by the Vibecanvas host. */
const VIBECANVAS_OFFICIAL_MACHINE_STATES = [
  "booting",
  "ready",
  "busy",
  "waiting",
  "dirty",
  "error",
  "disabled",
  "disposed",
] as const;

/** Official actor state names that Vibecanvas can inspect across widget types. */
type TVibecanvasOfficialMachineState = typeof VIBECANVAS_OFFICIAL_MACHINE_STATES[number];

/** Custom machine state name. Official states are also valid custom state names. */
type TVibecanvasMachineStateId = TVibecanvasOfficialMachineState | (string & {});

/** Event sent to a widget machine. */
type TVibecanvasMachineEvent = string | {
  type: string;
  [key: string]: unknown;
};

/** Reactive machine state exposed to guest widget code. */
type TVibecanvasMachineState<TState extends string = string> = {
  /** Current widget-specific state. */
  value: TState;
  /** Host-known official state for cross-widget debugging and inspection. */
  official: TVibecanvasOfficialMachineState;
  /** Previous widget-specific state, if any. */
  previous: TState | null;
  /** Last event type that changed the state, if any. */
  event: string | null;
  /** Last transition timestamp. */
  changedAt: number;
  /** Optional metadata for host/debug UI. */
  meta: Record<string, unknown>;
};

type TVibecanvasMachineTransitionArgs<TState extends string = string> = {
  state: TVibecanvasMachineState<TState>;
  event: TVibecanvasMachineEvent;
};

type TVibecanvasMachineTransition<TState extends string = string> =
  | TState
  | {
    target: TState;
    meta?: Record<string, unknown>;
    guard?: (args: TVibecanvasMachineTransitionArgs<TState>) => boolean;
    action?: (args: TVibecanvasMachineTransitionArgs<TState>) => void | Promise<void>;
  };

/** Defines one widget-specific state. */
type TVibecanvasMachineStateDefinition<TState extends string = string> = {
  /** Human-readable state label for debug UI. */
  label?: string;
  /** Host-known official state represented by this widget-specific state. */
  official?: TVibecanvasOfficialMachineState;
  /** Event transitions out of this state. Guest authors define their own transitions. */
  on?: Record<string, TVibecanvasMachineTransition<TState>>;
};

/** Machine configuration. The machine always starts in `booting`. */
type TVibecanvasMachineConfig<TState extends string = string> = {
  /** Widget-specific state definitions. Add as many custom states as needed. */
  states?: Record<TState, TVibecanvasMachineStateDefinition<TState>>;
};

/** Widget machine instance. */
type TVibecanvasMachine<TState extends string = string> = {
  /** Reactive state object for Arrow templates, watch(), and local widget logic. */
  state: TVibecanvasMachineState<TState>;
  /** Sends an event through the configured transition table. */
  send(event: TVibecanvasMachineEvent): Promise<boolean>;
  /** Directly sets the current state. Useful for simple widgets and async lifecycle updates. */
  set(value: TState, meta?: Record<string, unknown>): void;
  /** Returns true when the current state has a transition for the event. */
  can(event: TVibecanvasMachineEvent): boolean;
};

function getEventType(event: TVibecanvasMachineEvent) {
  return typeof event === "string" ? event : event.type;
}

function isOfficialMachineState(value: string): value is TVibecanvasOfficialMachineState {
  return VIBECANVAS_OFFICIAL_MACHINE_STATES.includes(value as TVibecanvasOfficialMachineState);
}

function getOfficialState<TState extends string>(config: TVibecanvasMachineConfig<TState>, value: TState) {
  return config.states?.[value]?.official ?? (isOfficialMachineState(value) ? value : "ready");
}

function resolveTransitionTarget<TState extends string>(transition: TVibecanvasMachineTransition<TState>) {
  return typeof transition === "string" ? transition : transition.target;
}

/**
 * Creates a reactive widget state machine.
 *
 * The machine always starts in `booting`. Guest authors define all transitions
 * themselves and may add any custom states they need.
 *
 * @example
 * const flow = machine({
 *   states: {
 *     booting: { official: "booting", on: { READY: "idle" } },
 *     idle: { official: "ready", on: { SAVE: "saving" } },
 *     saving: { official: "busy", on: { DONE: "idle", FAIL: "failed" } },
 *     failed: { official: "error", on: { RETRY: "saving" } },
 *   },
 * });
 *
 * flow.send("READY");
 * flow.state.value;
 * flow.state.official;
 */
function getVibecanvasOfficialMachineStates() {
  return [...VIBECANVAS_OFFICIAL_MACHINE_STATES];
}

function machine<TState extends string = TVibecanvasMachineStateId>(config: TVibecanvasMachineConfig<TState> = {}): TVibecanvasMachine<TState> {
  const booting = "booting" as TState;
  const state = reactive<TVibecanvasMachineState<TState>>({
    value: booting,
    official: "booting",
    previous: null,
    event: null,
    changedAt: Date.now(),
    meta: {},
  });

  const set = (value: TState, meta: Record<string, unknown> = {}) => {
    state.previous = state.value;
    state.value = value;
    state.official = getOfficialState(config, value);
    state.changedAt = Date.now();
    state.meta = meta;
  };

  const can = (event: TVibecanvasMachineEvent) => {
    const eventType = getEventType(event);
    return Boolean(config.states?.[state.value]?.on?.[eventType]);
  };

  const send = async (event: TVibecanvasMachineEvent) => {
    const eventType = getEventType(event);
    const transition = config.states?.[state.value]?.on?.[eventType];
    if (!transition) return false;

    if (typeof transition !== "string") {
      const args = { state, event };
      if (transition.guard && !transition.guard(args)) return false;
      await transition.action?.(args);
    }

    state.event = eventType;
    set(resolveTransitionTarget(transition), typeof transition === "string" ? {} : transition.meta ?? {});
    return true;
  };

  return { state, send, set, can };
}

export { getVibecanvasOfficialMachineStates, machine };
export type {
  TVibecanvasMachine,
  TVibecanvasMachineConfig,
  TVibecanvasMachineEvent,
  TVibecanvasMachineState,
  TVibecanvasMachineStateDefinition,
  TVibecanvasMachineStateId,
  TVibecanvasMachineTransition,
  TVibecanvasOfficialMachineState,
};
