import { eventIterator, pc } from '../procedure';
import { z } from 'zod';

export const ZNotificationEvent = z.object({
  type: z.enum(['info', 'success', 'warning', 'error']),
  title: z.string(),
  description: z.string().optional(),
});

export type TNotificationEvent = z.infer<typeof ZNotificationEvent>;

export const ZNotificationStreamEvent = ZNotificationEvent.extend({
  sequence: z.number().int().positive(),
});

export type TNotificationStreamEvent = z.infer<typeof ZNotificationStreamEvent>;

const notificationContract = pc.router({
  events: pc
    .input(z.object({
      afterSequence: z.number().int().nonnegative().optional(),
    }))
    .route({ method: 'GET' })
    .output(eventIterator(ZNotificationStreamEvent)),
});

export { notificationContract };
