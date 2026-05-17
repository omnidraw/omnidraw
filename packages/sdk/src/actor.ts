import type { TJsonSchema } from "./schema";

type TActorJson = null | boolean | number | string | TActorJson[] | { [key: string]: TActorJson };

type TVibecanvasActorTransition = {
  target: string;
  guard?: string;
  actions?: string[];
};

type TVibecanvasActorStateConfig = {
  entry?: string[];
  exit?: string[];
  on?: Record<string, TVibecanvasActorTransition>;
};

type TVibecanvasActorJson = {
  slug: string;
  name: string;
  version?: string;
  description?: string;
  initialState: string;
  initialContext?: TActorJson;
  states: Record<string, TVibecanvasActorStateConfig>;
  inputSchema?: Record<string, TJsonSchema>;
  outputSchema?: Record<string, TJsonSchema>;
};

type TVibecanvasActorMessage = {
  name: string;
  payload: TActorJson;
};

type TVibecanvasActorEffectArgs<TContext extends TActorJson = TActorJson> = {
  state: string;
  context: TContext;
  message: TVibecanvasActorMessage;
};

type TVibecanvasActorOutput = {
  name: string;
  payload?: TActorJson;
};

type TVibecanvasActorEffectResult<TContext extends TActorJson = TActorJson> = {
  context?: TContext;
  outputs?: TVibecanvasActorOutput[];
};

type TVibecanvasActorEffectPortal = {
  env: Record<string, string | undefined>;
  now: () => string;
  idempotencyKey?: string;
  workflowRunId: string;
  workflowStepId: string;
  previousResults: readonly unknown[];
};

type TVibecanvasActorEffect<TContext extends TActorJson = TActorJson> = (
  portal: TVibecanvasActorEffectPortal,
  args: TVibecanvasActorEffectArgs<TContext>,
) => TVibecanvasActorEffectResult<TContext> | Promise<TVibecanvasActorEffectResult<TContext>>;

type TVibecanvasActorFunctions = {
  fns?: Record<string, TVibecanvasActorEffect>;
  fxs?: Record<string, TVibecanvasActorEffect>;
  txs?: Record<string, TVibecanvasActorEffect>;
};

function defineActorJson<TDefinition extends TVibecanvasActorJson>(definition: TDefinition): TDefinition {
  return definition;
}

function defineActorFunctions<TFunctions extends TVibecanvasActorFunctions>(functions: TFunctions): TFunctions {
  return functions;
}

const defineActor = defineActorJson;

export { defineActor, defineActorFunctions, defineActorJson };
export type {
  TActorJson,
  TVibecanvasActorEffect,
  TVibecanvasActorEffectArgs,
  TVibecanvasActorEffectPortal,
  TVibecanvasActorEffectResult,
  TVibecanvasActorFunctions,
  TVibecanvasActorJson,
  TVibecanvasActorMessage,
  TVibecanvasActorOutput,
  TVibecanvasActorStateConfig,
  TVibecanvasActorTransition,
};
