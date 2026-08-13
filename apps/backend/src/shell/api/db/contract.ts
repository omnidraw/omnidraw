import { eventIterator, pc } from '../procedure';
import { z } from 'zod';

export const ZDbEventSchema = z.object({
  data: z.discriminatedUnion('change', [
    z.object({
      change: z.literal('insert'),
      table: z.string(),
      id: z.string(),
      record: z.record(z.any(), z.any()),
    }),
    z.object({
      change: z.literal('update'),
      table: z.string(),
      id: z.string(),
      record: z.record(z.any(), z.any()),
    }),
    z.object({
      change: z.literal('delete'),
      table: z.string(),
      id: z.string(),
    }),
  ]),
});

export const ZDbEventStreamSchema = ZDbEventSchema.extend({
  sequence: z.number().int().positive(),
});

const dbContract = pc.router({
  events: pc
    .input(z.object({
      canvasId: z.string(),
      afterSequence: z.number().int().nonnegative().optional(),
    }))
    .route({ method: 'GET' })
    .output(eventIterator(ZDbEventStreamSchema)),
});

export { dbContract };
