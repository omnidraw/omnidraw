import type { TEventSubscriptionOptions, TSequencedEvent } from '@omnidraw/service-event-publisher/IEventPublisherService';
import type { TTenantContext } from '@omnidraw/tenant-core';
import type { TDbEvent } from './types';

type TPortal = {
  findCanvasById: (tenant: TTenantContext, args: { id: string }) => Promise<unknown | null>;
  subscribeDbEventRecords: (
    tenant: TTenantContext,
    canvasId: string,
    options?: TEventSubscriptionOptions,
  ) => AsyncIterable<TSequencedEvent<TDbEvent>>;
};

type TArgs = {
  afterSequence?: number;
  canvasId: string;
  tenant: TTenantContext;
};

export async function* fxDbEvents(portal: TPortal, args: TArgs) {
  const canvas = await portal.findCanvasById(args.tenant, { id: args.canvasId });
  if (!canvas) throw new Error('Canvas not found');

  const options = args.afterSequence === undefined
    ? undefined
    : { afterSequence: args.afterSequence };
  for await (const record of portal.subscribeDbEventRecords(args.tenant, args.canvasId, options)) {
    yield { ...record.event, sequence: record.sequence };
  }
}
