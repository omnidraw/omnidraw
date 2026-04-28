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

/** Machine states are official states or dot-qualified substates, e.g. `busy.saving`. */
type TVibecanvasMachineStateId = TVibecanvasOfficialMachineState | `${TVibecanvasOfficialMachineState}.${string}`;

/** Event sent to a widget machine. */
type TVibecanvasMachineEvent = string | {
  type: string;
  [key: string]: unknown;
};

/** Reactive machine state exposed to guest widget code. */
type TVibecanvasMachineState<TState extends TVibecanvasMachineStateId = TVibecanvasMachineStateId> = {
  /** Current machine state. Host-known status is derived from the prefix before `.`. */
  value: TState;
  /** Previous machine state, if any. */
  previous: TState | null;
  /** Last event type that changed the state, if any. */
  event: string | null;
  /** Last transition timestamp. */
  changedAt: number;
  /** Optional metadata for host/debug UI. */
  meta: Record<string, unknown>;
};

type TVibecanvasMachineTransitionArgs<TState extends TVibecanvasMachineStateId = TVibecanvasMachineStateId> = {
  state: TVibecanvasMachineState<TState>;
  event: TVibecanvasMachineEvent;
};

type TVibecanvasMachineEnterReason = "initial" | "restore" | "set" | "transition";

type TVibecanvasMachineEnterArgs<TState extends TVibecanvasMachineStateId = TVibecanvasMachineStateId> = {
  state: TVibecanvasMachineState<TState>;
  reason: TVibecanvasMachineEnterReason;
  event: TVibecanvasMachineEvent | null;
  send: (event: TVibecanvasMachineEvent) => Promise<boolean>;
  set: (value: TState, meta?: Record<string, unknown>) => void;
};

type TVibecanvasMachineSnapshot<TState extends TVibecanvasMachineStateId = TVibecanvasMachineStateId> = {
  value: TState;
  previous?: TState | null;
  event?: string | null;
  changedAt?: number;
  meta?: Record<string, unknown>;
};

type TVibecanvasMachinePersistencePortal<TState extends TVibecanvasMachineStateId = TVibecanvasMachineStateId> = {
  loadMachineState: (id: string) => TVibecanvasMachineSnapshot<TState> | null | undefined | Promise<TVibecanvasMachineSnapshot<TState> | null | undefined>;
  saveMachineState: (id: string, snapshot: TVibecanvasMachineSnapshot<TState>) => void | Promise<void>;
};

type TVibecanvasMachinePersistenceConfig<TState extends TVibecanvasMachineStateId = TVibecanvasMachineStateId> = {
  /** Stable id scoped by the host to this widget instance. Defaults to machine config id. */
  id?: string;
  /** Persistence adapter. Host/runtime should provide one to make persistence durable. */
  portal?: TVibecanvasMachinePersistencePortal<TState>;
};

type TVibecanvasMachinePersistence<TState extends TVibecanvasMachineStateId = TVibecanvasMachineStateId> = boolean | TVibecanvasMachinePersistenceConfig<TState>;

type TVibecanvasMachineTransition<TState extends TVibecanvasMachineStateId = TVibecanvasMachineStateId> =
  | TState
  | {
    target: TState;
    meta?: Record<string, unknown>;
    guard?: (args: TVibecanvasMachineTransitionArgs<TState>) => boolean;
    action?: (args: TVibecanvasMachineTransitionArgs<TState>) => void | Promise<void>;
  };

/** Defines one machine state. */
type TVibecanvasMachineStateDefinition<TState extends TVibecanvasMachineStateId = TVibecanvasMachineStateId> = {
  /** Human-readable state label for debug UI. */
  label?: string;
  /** Runs whenever this state becomes active, including restored persisted state. */
  onEnter?: (args: TVibecanvasMachineEnterArgs<TState>) => void | Promise<void>;
  /** Runs only when this state was restored from persisted machine state. */
  onRestore?: (args: TVibecanvasMachineEnterArgs<TState>) => void | Promise<void>;
  /** Event transitions out of this state. Guest authors define their own transitions. */
  on?: Record<string, TVibecanvasMachineTransition<TState>>;
};

/** Machine configuration. The machine starts in `initial`, defaulting to `booting`. */
type TVibecanvasMachineConfig<TState extends TVibecanvasMachineStateId = TVibecanvasMachineStateId> = {
  /** Stable machine id. Required when persist is enabled without an explicit persist.id. */
  id?: string;
  /** Initial state used before restore and as fallback for structurally invalid snapshots. */
  initial?: TState;
  /** Persist and restore the machine snapshot per widget instance when a portal is supplied. */
  persist?: TVibecanvasMachinePersistence<TState>;
  /** State definitions. Add as many dot-qualified substates as needed. */
  states?: Record<TState, TVibecanvasMachineStateDefinition<TState>>;
};

/** Widget machine instance. */
type TVibecanvasMachine<TState extends TVibecanvasMachineStateId = TVibecanvasMachineStateId> = {
  /** Reactive state object for Arrow templates, watch(), and local widget logic. */
  state: TVibecanvasMachineState<TState>;
  /** Host-known status derived from `state.value`. */
  status(): TVibecanvasOfficialMachineState;
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

function getVibecanvasMachineStatus(value: string): TVibecanvasOfficialMachineState {
  const status = value.split(".", 1)[0] ?? "ready";
  return isOfficialMachineState(status) ? status : "ready";
}

function hasConfiguredState<TState extends TVibecanvasMachineStateId>(config: TVibecanvasMachineConfig<TState>, value: TState) {
  if (!config.states) return true;
  return value in config.states;
}

function resolveTransitionTarget<TState extends TVibecanvasMachineStateId>(transition: TVibecanvasMachineTransition<TState>) {
  return typeof transition === "string" ? transition : transition.target;
}

function resolvePersistence<TState extends TVibecanvasMachineStateId>(config: TVibecanvasMachineConfig<TState>) {
  if (!config.persist) return null;
  const persistConfig = config.persist === true ? {} : config.persist;
  const id = persistConfig.id ?? config.id;
  if (!id || !persistConfig.portal) return null;
  return { id, portal: persistConfig.portal };
}

function toSnapshot<TState extends TVibecanvasMachineStateId>(state: TVibecanvasMachineState<TState>): TVibecanvasMachineSnapshot<TState> {
  return {
    value: state.value,
    previous: state.previous,
    event: state.event,
    changedAt: state.changedAt,
    meta: state.meta,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSnapshot<TState extends TVibecanvasMachineStateId>(config: TVibecanvasMachineConfig<TState>, snapshot: TVibecanvasMachineSnapshot<TState> | null | undefined) {
  if (!snapshot || !isRecord(snapshot) || typeof snapshot.value !== "string") return null;
  const value = snapshot.value as TState;
  if (!hasConfiguredState(config, value)) return null;

  return {
    value,
    previous: typeof snapshot.previous === "string" ? snapshot.previous as TState : null,
    event: typeof snapshot.event === "string" ? snapshot.event : null,
    changedAt: typeof snapshot.changedAt === "number" ? snapshot.changedAt : Date.now(),
    meta: isRecord(snapshot.meta) ? snapshot.meta : {},
  } satisfies TVibecanvasMachineState<TState>;
}

/**
 * Creates a reactive widget state machine.
 *
 * The machine starts in `initial`, defaulting to `booting`. Host-known status is
 * derived from the current state prefix: `busy.saving` is a `busy` state.
 */
function getVibecanvasOfficialMachineStates() {
  return [...VIBECANVAS_OFFICIAL_MACHINE_STATES];
}

function machine<TState extends TVibecanvasMachineStateId = TVibecanvasMachineStateId>(config: TVibecanvasMachineConfig<TState> = {}): TVibecanvasMachine<TState> {
  const initial = config.initial ?? "booting" as TState;
  const persistence = resolvePersistence(config);
  const state = reactive<TVibecanvasMachineState<TState>>({
    value: initial,
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

  const status = () => getVibecanvasMachineStatus(state.value);

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

  return { state, status, send, set, can };
}

export { getVibecanvasMachineStatus, getVibecanvasOfficialMachineStates, machine };
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
