import type { TActorRuntimeState, TMessageMap, TVibecanvasJsonValue } from './shared';
export { createWidgetSdk, createWidgetSdkFromPortal } from './widget-bridge';
export type { IWidgetHostPortal, TActorSendOptions, TActorSendResult, TActorSnapshot } from './widget-bridge';

export type TWidgetActor<
  TContext = TVibecanvasJsonValue,
  TInput extends TMessageMap = TMessageMap,
> = {
  /** Arrow-reactive actor machine state. Use as `${() => actor.state.value}`. */
  readonly state: { value: TActorRuntimeState };

  /** Arrow-reactive actor context/data. Use as `${() => actor.context.value}`. */
  readonly context: { value: TContext };

  /** Send an input message to this widget's own actor. */
  sendMessage<TName extends keyof TInput & string>(name: TName, payload: TInput[TName]): Promise<void>;
};

export type TWidgetSdk<
  TContext = TVibecanvasJsonValue,
  TInput extends TMessageMap = TMessageMap,
> = {
  readonly actor: TWidgetActor<TContext, TInput>;
};

export type TDefineWidgetFactory<
  TView,
  TContext = TVibecanvasJsonValue,
  TInput extends TMessageMap = TMessageMap,
> = (sdk: TWidgetSdk<TContext, TInput>) => TView | Promise<TView>;

export function defineWidget<
  TView,
  TContext = TVibecanvasJsonValue,
  TInput extends TMessageMap = TMessageMap,
>(factory: TDefineWidgetFactory<TView, TContext, TInput>) {
  return factory;
}

export type { TActorRuntimeState, TMessageMap, TUnsubscribe, TVibecanvasJsonValue } from './shared';
