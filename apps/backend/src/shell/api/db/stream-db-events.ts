import type { TEventSubscriptionOptions, TSequencedEvent } from '#backend/shell/events/types';
import type { TDbEvent } from './types';

type TEffects = {
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

export async function* streamDbEvents(effects: TEffects, args: TArgs) {
  const canvas = await effects.findCanvasById({ id: args.canvasId });
  if (!canvas) throw new Error('Canvas not found');

  const options = args.afterSequence === undefined
    ? undefined
    : { afterSequence: args.afterSequence };
  for await (const record of effects.subscribeDbEventRecords(args.canvasId, options)) {
    yield { ...record.event, sequence: record.sequence };
  }
}
