import { __setActorSnapshot, __setSendMessage } from './widget';
import type { TActorRuntimeState, TMessageMap, TUnsubscribe, TVibecanvasJsonValue } from './shared';

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
  context: TContext;
};

export type TWidgetHostActorEvent<TContext = TVibecanvasJsonValue> = {
  readonly cursor?: string;
  readonly type: 'snapshot';
  readonly snapshot: TActorSnapshot<TContext>;
};

export type TWidgetHostActorEventResult<TContext = TVibecanvasJsonValue> =
  | TWidgetHostActorEvent<TContext>
  | { readonly cursor?: string; readonly type: 'noop' };

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

  // Optional in-process subscription for non-sandbox tests and future host integrations.
  subscribeActor?(handler: (event: TWidgetHostActorEvent<TContext>) => void): TUnsubscribe;

  // Sandbox-safe long-poll contract. Host resolves when the actor snapshot changes.
  nextActorEvent?(args: { cursor?: string }): Promise<TWidgetHostActorEventResult<TContext>>;
}

function throwSendError(result: TActorSendResult): void {
  if (result.ok) return;
  throw new Error(result.message);
}

export function connectWidgetBridge<
  TContext = TVibecanvasJsonValue,
  TInput extends TMessageMap = TMessageMap,
>(portal: IWidgetHostPortal<TContext, TInput>): TUnsubscribe {
  let disposed = false;
  let cursor: string | undefined;

  __setSendMessage(async (name, payload) => {
    const result = await portal.sendActorMessage({ name, payload: payload as TInput[keyof TInput & string] });
    throwSendError(result);
  });

  const subscriptionUnsubscribe = portal.subscribeActor?.((event) => {
    if (event.cursor !== undefined) cursor = event.cursor;
    if (event.type === 'snapshot') __setActorSnapshot(event.snapshot as TActorSnapshot);
  });

  void Promise.resolve(portal.getActorSnapshot()).then((snapshot) => {
    if (!disposed) __setActorSnapshot(snapshot as TActorSnapshot);
  });

  if (portal.nextActorEvent) {
    const poll = async (): Promise<void> => {
      while (!disposed) {
        const event = await portal.nextActorEvent?.({ cursor });
        if (!event || disposed) continue;
        if (event.cursor !== undefined) cursor = event.cursor;
        if (event.type === 'snapshot') __setActorSnapshot(event.snapshot as TActorSnapshot);
      }
    };

    void poll();
  }

  return () => {
    disposed = true;
    subscriptionUnsubscribe?.();
  };
}
