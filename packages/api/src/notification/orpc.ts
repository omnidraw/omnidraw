import { implement } from '@orpc/server';
import { notificationContract } from './contract';
import type { TNotificationApiContext } from './types';

const baseNotificationOs = implement(notificationContract)
  .$context<TNotificationApiContext>();

export { baseNotificationOs };
