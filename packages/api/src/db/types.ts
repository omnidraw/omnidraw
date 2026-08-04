import type { TCanvas } from '@omnidraw/service-db/model';
import type {
  TDbEvent as TServiceDbEvent,
  TEventSubscriptionOptions,
  TSequencedEvent,
} from '@omnidraw/service-event-publisher/IEventPublisherService';

type TDbEvent = TServiceDbEvent;

type TDbEventCapability = {
  subscribeDbEventRecords(
    canvasId: string,
    options?: TEventSubscriptionOptions,
  ): AsyncIterable<TSequencedEvent<TDbEvent>>;
};

type TDbCanvasCapability = {
  canvas: {
    findById(args: { id: string }): Promise<TCanvas | null>;
  };
};

type TDbApiContext = {
  db: TDbCanvasCapability;
  eventPublisher: TDbEventCapability;
};

export type { TDbApiContext, TDbCanvasCapability, TDbEvent, TDbEventCapability };
