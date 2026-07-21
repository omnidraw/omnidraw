import { eventIterator, oc } from '@orpc/contract';
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

const dbContract = oc.router({
  events: oc
    .input(z.object({ canvasId: z.string() }))
    .route({ method: 'GET' })
    .output(eventIterator(ZDbEventSchema)),
});

export { dbContract };
