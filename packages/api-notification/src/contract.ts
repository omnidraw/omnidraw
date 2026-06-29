import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';

export const ZNotificationEvent = z.object({
  type: z.enum(['info', 'success', 'error']),
  title: z.string(),
  description: z.string().optional(),
});

export type TNotificationEvent = z.infer<typeof ZNotificationEvent>

const notificationContract = oc.router({
  events: oc
    .input(z.object({}))
    .route({ method: 'GET' })
    .output(eventIterator(ZNotificationEvent)),
});

export { notificationContract };
