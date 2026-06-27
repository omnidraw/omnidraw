import { __setActorSnapshot, __setSendMessage } from './widget';
import type { TActorRuntimeState, TActorSystemStatus, TMessageMap, TUnsubscribe, TVibecanvasJsonValue } from './shared';

export type TActorSendOptions = {
  readonly messageId?: string;
  readonly correlationId?: string;
};

export type TActorSendResult = {
  readonly ok: true;
  readonly messageId: string;
} | {
  readonly ok: false;
  readonly messageId?: string;
  readonly code: string;
  readonly message: string;
  readonly details?: TVibecanvasJsonValue;
};

export type TActorSnapshot<TContext = TVibecanvasJsonValue> = {
  state: TActorRuntimeState;
  status: TActorSystemStatus;
  context: TContext;
};

export type TWidgetHostActorEvent<TContext = TVibecanvasJsonValue> = {
  readonly type: 'snapshot';
  readonly snapshot: TActorSnapshot<TContext>;
};

export interface IWidgetHostPortal<
  TContext = TVibecanvasJsonValue,
  TInput extends TMessageMap = TMessageMap,
> {
  // TODO: implement with the Arrow sandbox host bridge.
  getActorSnapshot(): TActorSnapshot<TContext> | Promise<TActorSnapshot<TContext>>;

  // TODO: implement by calling the host API for this widget's own actor instance.
  sendActorMessage<TName extends keyof TInput & string>(args: {
    name: TName;
    payload: TInput[TName];
    options?: TActorSendOptions;
  }): Promise<TActorSendResult>;

  // TODO: implement with a scoped host subscription so actor updates push into Arrow reactivity.
  subscribeActor?(handler: (event: TWidgetHostActorEvent<TContext>) => void): TUnsubscribe;
}

function throwSendError(result: TActorSendResult): void {
  if (result.ok) return;
  throw new Error(result.message);
}

export function connectWidgetBridge<
  TContext = TVibecanvasJsonValue,
  TInput extends TMessageMap = TMessageMap,
>(portal: IWidgetHostPortal<TContext, TInput>): void {
  __setSendMessage(async (name, payload) => {
    const result = await portal.sendActorMessage({ name, payload: payload as TInput[keyof TInput & string] });
    throwSendError(result);
  });

  portal.subscribeActor?.((event) => {
    if (event.type === 'snapshot') __setActorSnapshot(event.snapshot as TActorSnapshot);
  });

  // TODO: remove this pull once the host bridge always pushes the initial snapshot before widget code runs.
  void Promise.resolve(portal.getActorSnapshot()).then((snapshot) => {
    __setActorSnapshot(snapshot as TActorSnapshot);
  });
}
