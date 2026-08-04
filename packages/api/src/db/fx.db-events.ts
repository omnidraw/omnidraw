import type { TEventSubscriptionOptions, TSequencedEvent } from '@omnidraw/service-event-publisher/IEventPublisherService';
import type { TDbEvent } from './types';

type TPortal = {
  findCanvasById: (args: { id: string }) => Promise<unknown | null>;
  subscribeDbEventRecords: (
    canvasId: string,
    options?: TEventSubscriptionOptions,
  ) => AsyncIterable<TSequencedEvent<TDbEvent>>;
};

type TArgs = {
  afterSequence?: number;
  canvasId: string;
};

export async function* fxDbEvents(portal: TPortal, args: TArgs) {
  const canvas = await portal.findCanvasById({ id: args.canvasId });
  if (!canvas) throw new Error('Canvas not found');

  const options = args.afterSequence === undefined
    ? undefined
    : { afterSequence: args.afterSequence };
  for await (const record of portal.subscribeDbEventRecords(args.canvasId, options)) {
    yield { ...record.event, sequence: record.sequence };
  }
}
