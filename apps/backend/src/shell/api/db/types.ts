import type { TCanvas } from '#backend/shell/database/model';
import type {
  TDbEvent as TServiceDbEvent,
  TEventSubscriptionOptions,
  TSequencedEvent,
} from '#backend/shell/events/types';

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
