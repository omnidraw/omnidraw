import type { TEventSubscriptionOptions, TSequencedEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { TNotificationEvent, TNotificationStreamEvent } from './contract';

type TPortal = {
  subscribeNotificationRecords: (
    tenant: TTenantContext,
    options?: TEventSubscriptionOptions,
  ) => AsyncIterable<TSequencedEvent<TNotificationEvent>>;
};

type TArgs = {
  afterSequence?: number;
  tenant: TTenantContext;
};

export async function* fxNotificationEvents(portal: TPortal, args: TArgs): AsyncGenerator<TNotificationStreamEvent> {
  const options = args.afterSequence === undefined
    ? undefined
    : { afterSequence: args.afterSequence };
  for await (const record of portal.subscribeNotificationRecords(args.tenant, options)) {
    yield { ...record.event, sequence: record.sequence };
  }
}
