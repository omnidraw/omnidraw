import type { TCanvas } from '@vibecanvas/service-db/model';
import type {
  TDbEvent as TServiceDbEvent,
  TEventSubscriptionOptions,
  TSequencedEvent,
} from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type { TTenantContext } from '@vibecanvas/tenant-core';

type TDbEvent = TServiceDbEvent;

type TDbEventCapability = {
  subscribeDbEventRecords(
    tenant: TTenantContext,
    canvasId: string,
    options?: TEventSubscriptionOptions,
  ): AsyncIterable<TSequencedEvent<TDbEvent>>;
};

type TDbCanvasCapability = {
  canvas: {
    findById(tenant: TTenantContext, args: { id: string }): Promise<TCanvas | null>;
  };
};

type TDbApiContext = {
  db: TDbCanvasCapability;
  eventPublisher: TDbEventCapability;
  tenant: TTenantContext;
};

export type { TDbApiContext, TDbCanvasCapability, TDbEvent, TDbEventCapability };
