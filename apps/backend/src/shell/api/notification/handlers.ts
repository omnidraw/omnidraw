import { apiNotificationEvents } from './api.notification-events';
import { baseNotificationOs } from './procedure-builder';

const notificationHandlers = {
  events: apiNotificationEvents,
};

export { baseNotificationOs, notificationHandlers };
