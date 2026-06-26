import type { TActorOutputEnvelope, TMessageMap, TVibecanvasJsonValue } from './shared';

export type TActorFunctionPortal = {
  next: () => Promise<unknown>;
  emitMessage: (msg: TActorOutputEnvelope) => Promise<void>;
};

export type TActorReadPortal = TActorFunctionPortal & {
  setData: (data: TVibecanvasJsonValue) => Promise<void>;
};

export type TActorWritePortal = TActorReadPortal;

export type TActorFunctionArgs<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue> = {
  readonly data: TContext;
  readonly context?: TContext;
  readonly msg: TMsg;
};

/** Backward-compatible short names used by current actor fixtures. */
export type TFnPortal = TActorFunctionPortal;
export type TFxPortal = TActorReadPortal;
export type TTxPortal = TActorWritePortal;
export type TFnArgs<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue> = TActorFunctionArgs<TContext, TMsg>;
export type TFxArgs<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue> = TActorFunctionArgs<TContext, TMsg>;
export type TTxArgs<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue> = TActorFunctionArgs<TContext, TMsg>;

export type TActorFn<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue, TResult = unknown> = (
  portal: TActorFunctionPortal,
  args: TActorFunctionArgs<TContext, TMsg>,
) => TResult | Promise<TResult>;

export type TActorFx<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue, TResult = unknown> = (
  portal: TActorReadPortal,
  args: TActorFunctionArgs<TContext, TMsg>,
) => TResult | Promise<TResult>;

export type TActorTx<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue, TResult = unknown> = (
  portal: TActorWritePortal,
  args: TActorFunctionArgs<TContext, TMsg>,
) => TResult | Promise<TResult>;

export type TActorFunctionRegistry<
  TContext = TVibecanvasJsonValue,
  TInput extends TMessageMap = TMessageMap,
> = {
  readonly fn?: Record<`fn.${string}`, TActorFn<TContext, TInput[keyof TInput & string]>>;
  readonly fx?: Record<`fx.${string}`, TActorFx<TContext, TInput[keyof TInput & string]>>;
  readonly tx?: Record<`tx.${string}`, TActorTx<TContext, TInput[keyof TInput & string]>>;
};

export function defineActorFunctions<
  TContext = TVibecanvasJsonValue,
  TInput extends TMessageMap = TMessageMap,
>(registry: TActorFunctionRegistry<TContext, TInput>): TActorFunctionRegistry<TContext, TInput> {
  return registry;
}

export function defineFn<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue, TResult = unknown>(
  fn: TActorFn<TContext, TMsg, TResult>,
): TActorFn<TContext, TMsg, TResult> {
  return fn;
}

export function defineFx<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue, TResult = unknown>(
  fx: TActorFx<TContext, TMsg, TResult>,
): TActorFx<TContext, TMsg, TResult> {
  return fx;
}

export function defineTx<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue, TResult = unknown>(
  tx: TActorTx<TContext, TMsg, TResult>,
): TActorTx<TContext, TMsg, TResult> {
  return tx;
}

export type { TActorOutputEnvelope, TMessageMap, TVibecanvasJsonValue } from './shared';
