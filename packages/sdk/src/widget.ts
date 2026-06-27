import { reactive } from '@arrow-js/core';

import type { TActorRuntimeState, TActorSystemStatus, TMessageMap, TVibecanvasJsonValue } from './shared';

export type TWidgetActor<
  TContext = TVibecanvasJsonValue,
  TInput extends TMessageMap = TMessageMap,
> = {
  /** Arrow-reactive actor machine state. Use as `${() => actor.state.value}`. */
  readonly state: { value: TActorRuntimeState };

  /** Arrow-reactive actor system status. Use as `${() => actor.status.value}`. */
  readonly status: { value: TActorSystemStatus };

  /** Arrow-reactive actor context/data. Use as `${() => actor.context.value}`. */
  readonly context: { value: TContext };

  /** Send an input message to this widget's own actor. */
  sendMessage<TName extends keyof TInput & string>(name: TName, payload: TInput[TName]): Promise<void>;
};

type TSendMessage = (name: string, payload: TVibecanvasJsonValue) => Promise<void>;

let sendMessageImpl: TSendMessage = async () => {
  throw new Error('TODO: @vibecanvas/sdk/widget actor bridge is not connected yet.');
};

export const actor: TWidgetActor = {
  state: reactive({ value: 'booting' as TActorRuntimeState }) as unknown as { value: TActorRuntimeState },
  status: reactive({ value: 'created' as TActorSystemStatus }) as unknown as { value: TActorSystemStatus },
  context: reactive({ value: null as TVibecanvasJsonValue }) as unknown as { value: TVibecanvasJsonValue },
  sendMessage(name, payload) {
    return sendMessageImpl(name, payload);
  },
};

export function __setActorSnapshot(snapshot: {
  state: TActorRuntimeState;
  status: TActorSystemStatus;
  context: TVibecanvasJsonValue;
}): void {
  actor.state.value = snapshot.state;
  actor.status.value = snapshot.status;
  actor.context.value = snapshot.context;
}

export function __setSendMessage(fn: TSendMessage): void {
  sendMessageImpl = fn;
}

export type { TActorRuntimeState, TActorSystemStatus, TMessageMap, TVibecanvasJsonValue } from './shared';
