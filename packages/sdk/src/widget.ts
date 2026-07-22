import { reactive } from '@arrow-js/core';

import type { TActorRuntimeState, TMessageMap, TVibecanvasJsonValue } from './shared';

export {
  __setServerFunctionTransport,
  createServerFunctionProxy,
} from './function-client';
export type {
  IServerFunctionClientTransport,
  TServerFunctionClient,
  TServerFunctionClientOf,
  TServerFunctionClientRequest,
} from './function-client';

export type {
  TWidgetManifestV2,
  TWidgetServerManifest,
  TWidgetUiManifest,
} from '@vibecanvas/widget-contract';

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

type TSendMessage = (name: string, payload: TVibecanvasJsonValue) => Promise<void>;

let sendMessageImpl: TSendMessage = async () => {
  throw new Error('TODO: @vibecanvas/sdk/widget actor bridge is not connected yet.');
};

export const actor: TWidgetActor = {
  state: reactive({ value: 'booting' as TActorRuntimeState }) as unknown as { value: TActorRuntimeState },
  context: reactive({ value: null as TVibecanvasJsonValue }) as unknown as { value: TVibecanvasJsonValue },
  sendMessage(name, payload) {
    return sendMessageImpl(name, payload);
  },
};

export function __setActorSnapshot(snapshot: {
  state: TActorRuntimeState;
  context: TVibecanvasJsonValue;
}): void {
  actor.state.value = snapshot.state;
  actor.context.value = snapshot.context;
}

export function __setSendMessage(fn: TSendMessage): void {
  sendMessageImpl = fn;
}

export type { TActorRuntimeState, TMessageMap, TVibecanvasJsonValue } from './shared';
