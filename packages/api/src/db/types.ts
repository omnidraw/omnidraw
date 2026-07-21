import type { z } from 'zod';
import type { ZDbEventSchema } from './contract';

type TDbEvent = z.infer<typeof ZDbEventSchema>;

type TDbEventCapability = {
  subscribeDbEvents(canvasId: string): AsyncIterable<TDbEvent>;
};

type TDbApiContext = {
  eventPublisher: TDbEventCapability;
};

export type { TDbApiContext, TDbEventCapability };
