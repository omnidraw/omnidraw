import { describe, expect, test } from 'bun:test';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import { ZNotificationEvent } from './contract';
import { fxNotificationEvents } from './fx.notification-events';

describe('notification warning delivery', () => {
  test('accepts warning severity and replays the latest warning to a late subscriber', async () => {
    const warning = ZNotificationEvent.parse({
      type: 'warning',
      title: 'Widget tooling prerequisites unavailable',
      description: 'Install Node.js and npm.',
    });
    const publisher = new EventPublisherService();
    publisher.publishNotification(warning);

    const events = fxNotificationEvents(publisher, {});
    expect(await events.next()).toEqual({ done: false, value: warning });
    await events.return(undefined);
    expect(publisher.getLatestNotification()).toEqual(warning);
  });
});
