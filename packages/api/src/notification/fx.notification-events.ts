import type { TEventSubscriptionOptions, TSequencedEvent } from '@omnidraw/service-event-publisher/IEventPublisherService';
import type { TNotificationEvent, TNotificationStreamEvent } from './contract';

type TPortal = {
  subscribeNotificationRecords: (
    options?: TEventSubscriptionOptions,
  ) => AsyncIterable<TSequencedEvent<TNotificationEvent>>;
};

type TArgs = {
  afterSequence?: number;
};

export async function* fxNotificationEvents(portal: TPortal, args: TArgs): AsyncGenerator<TNotificationStreamEvent> {
  const options = args.afterSequence === undefined
    ? undefined
    : { afterSequence: args.afterSequence };
  for await (const record of portal.subscribeNotificationRecords(options)) {
    yield { ...record.event, sequence: record.sequence };
  }
}
