import { apiNotificationEvents } from './api.notification-events';
import { baseNotificationOs } from './orpc';

const notificationHandlers = {
  events: apiNotificationEvents,
};

export { baseNotificationOs, notificationHandlers };
