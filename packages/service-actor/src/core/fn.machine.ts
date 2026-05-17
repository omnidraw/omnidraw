import { ACTOR_BOOT_MESSAGE_NAME } from './CONSTANTS';
import type { TActorJson, TActorMessage, TActorOutput, TActorRows, TActorTransitionPlan, TActorMachineConfig, TActorInstanceRow } from './types';

export type TArgsCreateBootMessage = {
  readonly correlationId: string;
};

export function fnCreateBootMessage(args: TArgsCreateBootMessage): TActorMessage {
  void args;
  return { name: ACTOR_BOOT_MESSAGE_NAME, payload: { type: 'boot' } };
}

export type TArgsCanProcessMessage = {
  readonly instance: TActorInstanceRow;
  readonly message: TActorMessage;
};

export function fnCanProcessMessage(args: TArgsCanProcessMessage): boolean {
  if (args.message.name === ACTOR_BOOT_MESSAGE_NAME) {
    return args.instance.status === 'created' || args.instance.status === 'starting' || args.instance.status === 'running';
  }
  return args.instance.status === 'running';
}

export type TArgsMachineConfig = {
  readonly value: unknown;
};

export function fnActorMachineConfig(args: TArgsMachineConfig): TActorMachineConfig {
  const value = args.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { states: {} };
  }
  const maybe = value as Partial<TActorMachineConfig>;
  return {
    initialState: maybe.initialState,
    initialContext: maybe.initialContext,
    states: maybe.states ?? {},
  };
}

export type TArgsCreateTransitionPlan = {
  readonly rows: TActorRows;
  readonly message: TActorMessage;
};

export function fnCreateTransitionPlan(args: TArgsCreateTransitionPlan): TActorTransitionPlan {
  const state = args.rows.instance.machine_state;
  const machineConfig = fnActorMachineConfig({ value: args.rows.definition.machine_config });
  const stateConfig = machineConfig.states[state];
  const transition = stateConfig?.on?.[args.message.name];
  const effectArgs = {
    state,
    context: args.rows.instance.machine_context as TActorJson,
    message: args.message,
  };

  if (!stateConfig || !transition) {
    return { changed: false, targetState: state, effectArgs, effects: [] };
  }

  return {
    changed: true,
    targetState: transition.target,
    effectArgs,
    guard: transition.guard,
    effects: [
      ...(stateConfig.exit ?? []),
      ...(transition.actions ?? []),
      ...(machineConfig.states[transition.target]?.entry ?? []),
    ],
  };
}

export type TArgsMergeEffectResults = {
  readonly initialContext: TActorJson;
  readonly results: readonly unknown[];
};

export function fnMergeEffectResults(args: TArgsMergeEffectResults): {
  readonly context: TActorJson;
  readonly outputs: readonly TActorOutput[];
} {
  let context = args.initialContext;
  const outputs: TActorOutput[] = [];

  for (const result of args.results) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) continue;
    const record = result as { readonly context?: TActorJson; readonly outputs?: readonly TActorOutput[] };
    if (record.context !== undefined) context = record.context;
    outputs.push(...(record.outputs ?? []));
  }

  return { context, outputs };
}
