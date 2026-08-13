import type { TEventSubscriptionOptions, TSequencedEvent } from '#backend/shell/events/types';
import type { TNotificationEvent, TNotificationStreamEvent } from './contract';

type TEffects = {
  subscribeNotificationRecords: (
    options?: TEventSubscriptionOptions,
  ) => AsyncIterable<TSequencedEvent<TNotificationEvent>>;
};

type TArgs = {
  afterSequence?: number;
};

export async function* streamNotificationEvents(effects: TEffects, args: TArgs): AsyncGenerator<TNotificationStreamEvent> {
  const options = args.afterSequence === undefined
    ? undefined
    : { afterSequence: args.afterSequence };
  for await (const record of effects.subscribeNotificationRecords(options)) {
    yield { ...record.event, sequence: record.sequence };
  }
}
