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

type TVibecanvasMachineEnterReason = "initial" | "restore" | "set" | "transition";

type TVibecanvasMachineEnterArgs<TState extends string = string> = {
  state: TVibecanvasMachineState<TState>;
  reason: TVibecanvasMachineEnterReason;
  event: TVibecanvasMachineEvent | null;
  send: (event: TVibecanvasMachineEvent) => Promise<boolean>;
  set: (value: TState, meta?: Record<string, unknown>) => void;
};

type TVibecanvasMachineSnapshot<TState extends string = string> = {
  value: TState;
  official?: TVibecanvasOfficialMachineState;
  previous?: TState | null;
  event?: string | null;
  changedAt?: number;
  meta?: Record<string, unknown>;
};

type TVibecanvasMachinePersistencePortal<TState extends string = string> = {
  loadMachineState: (id: string) => TVibecanvasMachineSnapshot<TState> | null | undefined | Promise<TVibecanvasMachineSnapshot<TState> | null | undefined>;
  saveMachineState: (id: string, snapshot: TVibecanvasMachineSnapshot<TState>) => void | Promise<void>;
};

type TVibecanvasMachinePersistenceConfig<TState extends string = string> = {
  /** Stable id scoped by the host to this widget instance. Defaults to machine config id. */
  id?: string;
  /** Persistence adapter. Host/runtime should provide one to make persistence durable. */
  portal?: TVibecanvasMachinePersistencePortal<TState>;
};

type TVibecanvasMachinePersistence<TState extends string = string> = boolean | TVibecanvasMachinePersistenceConfig<TState>;

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
  /** Runs whenever this state becomes active, including restored persisted state. */
  onEnter?: (args: TVibecanvasMachineEnterArgs<TState>) => void | Promise<void>;
  /** Runs only when this state was restored from persisted machine state. */
  onRestore?: (args: TVibecanvasMachineEnterArgs<TState>) => void | Promise<void>;
  /** Event transitions out of this state. Guest authors define their own transitions. */
  on?: Record<string, TVibecanvasMachineTransition<TState>>;
};

/** Machine configuration. The machine starts in `initial`, defaulting to `booting`. */
type TVibecanvasMachineConfig<TState extends string = string> = {
  /** Stable machine id. Required when persist is enabled without an explicit persist.id. */
  id?: string;
  /** Initial state used before restore and as fallback for structurally invalid snapshots. */
  initial?: TState;
  /** Persist and restore the machine snapshot per widget instance when a portal is supplied. */
  persist?: TVibecanvasMachinePersistence<TState>;
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

function hasConfiguredState<TState extends string>(config: TVibecanvasMachineConfig<TState>, value: TState) {
  if (!config.states) return true;
  return value in config.states;
}

function resolveTransitionTarget<TState extends string>(transition: TVibecanvasMachineTransition<TState>) {
  return typeof transition === "string" ? transition : transition.target;
}

function resolvePersistence<TState extends string>(config: TVibecanvasMachineConfig<TState>) {
  if (!config.persist) return null;
  const persistConfig = config.persist === true ? {} : config.persist;
  const id = persistConfig.id ?? config.id;
  if (!id || !persistConfig.portal) return null;
  return { id, portal: persistConfig.portal };
}

function toSnapshot<TState extends string>(state: TVibecanvasMachineState<TState>): TVibecanvasMachineSnapshot<TState> {
  return {
    value: state.value,
    official: state.official,
    previous: state.previous,
    event: state.event,
    changedAt: state.changedAt,
    meta: state.meta,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSnapshot<TState extends string>(config: TVibecanvasMachineConfig<TState>, snapshot: TVibecanvasMachineSnapshot<TState> | null | undefined) {
  if (!snapshot || !isRecord(snapshot) || typeof snapshot.value !== "string") return null;
  const value = snapshot.value as TState;
  if (!hasConfiguredState(config, value)) return null;

  return {
    value,
    official: getOfficialState(config, value),
    previous: typeof snapshot.previous === "string" ? snapshot.previous as TState : null,
    event: typeof snapshot.event === "string" ? snapshot.event : null,
    changedAt: typeof snapshot.changedAt === "number" ? snapshot.changedAt : Date.now(),
    meta: isRecord(snapshot.meta) ? snapshot.meta : {},
  } satisfies TVibecanvasMachineState<TState>;
}

/**
 * Creates a reactive widget state machine.
 *
 * The machine starts in `initial`, defaulting to `booting`. If `persist` is
 * configured with a host portal, the latest serializable machine snapshot is
 * restored per widget instance. Restored states run `onRestore` and `onEnter`,
 * so resumability should be encoded in the state definition.
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
  const initial = config.initial ?? "booting" as TState;
  const persistence = resolvePersistence(config);
  const state = reactive<TVibecanvasMachineState<TState>>({
    value: initial,
    official: getOfficialState(config, initial),
    previous: null,
    event: null,
    changedAt: Date.now(),
    meta: {},
  });

  let restored = false;

  const persist = () => {
    if (!persistence) return;
    void persistence.portal.saveMachineState(persistence.id, toSnapshot(state));
  };

  const runEnterHooks = async (reason: TVibecanvasMachineEnterReason, event: TVibecanvasMachineEvent | null) => {
    const definition = config.states?.[state.value];
    if (!definition) return;
    const args = { state, reason, event, send, set };
    if (reason === "restore") {
      await definition.onRestore?.(args);
    }
    await definition.onEnter?.(args);
  };

  const applyState = (value: TState, meta: Record<string, unknown>, reason: TVibecanvasMachineEnterReason, event: TVibecanvasMachineEvent | null) => {
    state.previous = state.value;
    state.value = value;
    state.official = getOfficialState(config, value);
    state.changedAt = Date.now();
    state.meta = meta;
    persist();
    void runEnterHooks(reason, event);
  };

  const set = (value: TState, meta: Record<string, unknown> = {}) => {
    applyState(value, meta, "set", null);
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
    applyState(resolveTransitionTarget(transition), typeof transition === "string" ? {} : transition.meta ?? {}, "transition", event);
    return true;
  };

  const restore = async () => {
    if (!persistence || restored) return;
    restored = true;
    const snapshot = normalizeSnapshot(config, await persistence.portal.loadMachineState(persistence.id));
    if (!snapshot) {
      persist();
      await runEnterHooks("initial", null);
      return;
    }

    state.previous = snapshot.previous;
    state.value = snapshot.value;
    state.official = snapshot.official;
    state.event = snapshot.event;
    state.changedAt = snapshot.changedAt;
    state.meta = snapshot.meta;
    persist();
    await runEnterHooks("restore", null);
  };

  if (persistence) {
    void restore();
  } else {
    void runEnterHooks("initial", null);
  }

  return { state, send, set, can };
}

export { getVibecanvasOfficialMachineStates, machine };
export type {
  TVibecanvasMachine,
  TVibecanvasMachineConfig,
  TVibecanvasMachineEnterArgs,
  TVibecanvasMachineEnterReason,
  TVibecanvasMachineEvent,
  TVibecanvasMachinePersistence,
  TVibecanvasMachinePersistenceConfig,
  TVibecanvasMachinePersistencePortal,
  TVibecanvasMachineSnapshot,
  TVibecanvasMachineState,
  TVibecanvasMachineStateDefinition,
  TVibecanvasMachineStateId,
  TVibecanvasMachineTransition,
  TVibecanvasOfficialMachineState,
};
