import { reactive } from '@arrow-js/core';

import type { TActorRuntimeState, TMessageMap, TUnsubscribe, TVibecanvasJsonValue } from './shared';
import type { TWidgetSdk } from './widget';

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

function applySnapshot<TContext>(target: TActorSnapshot<TContext>, snapshot: TActorSnapshot<TContext>): void {
  target.state = snapshot.state;
  target.context = snapshot.context;
}

function throwSendError(result: TActorSendResult): void {
  if (result.ok) return;
  throw new Error(result.message);
}

export function createWidgetSdk<
  TContext = TVibecanvasJsonValue,
  TInput extends TMessageMap = TMessageMap,
>(
  portal: IWidgetHostPortal<TContext, TInput>,
  initial: TActorSnapshot<TContext>,
): TWidgetSdk<TContext, TInput> {
  const snapshot = reactive({ ...initial } as TActorSnapshot<TContext>) as unknown as TActorSnapshot<TContext>;
  const state = reactive({ value: snapshot.state }) as unknown as { value: TActorRuntimeState };
  const context = reactive({ value: snapshot.context }) as unknown as { value: TContext };

  const update = (nextSnapshot: TActorSnapshot<TContext>) => {
    applySnapshot(snapshot, nextSnapshot);
    state.value = nextSnapshot.state;
    context.value = nextSnapshot.context;
  };

  portal.subscribeActor?.((event) => {
    if (event.type === 'snapshot') update(event.snapshot);
  });

  // TODO: remove this pull once the host bridge always provides an initial snapshot synchronously.
  void Promise.resolve(portal.getActorSnapshot()).then(update);

  return {
    actor: {
      state,
      context,
      async sendMessage(name, payload) {
        const result = await portal.sendActorMessage({ name, payload });
        throwSendError(result);
      },
    },
  };
}

export async function createWidgetSdkFromPortal<
  TContext = TVibecanvasJsonValue,
  TInput extends TMessageMap = TMessageMap,
>(portal: IWidgetHostPortal<TContext, TInput>): Promise<TWidgetSdk<TContext, TInput>> {
  // TODO: decide whether widgets should await SDK creation or receive a synchronous stub first.
  const initial = await portal.getActorSnapshot();
  return createWidgetSdk(portal, initial);
}
