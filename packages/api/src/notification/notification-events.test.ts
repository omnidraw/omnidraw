import { describe, expect, test } from 'bun:test';
import { EventPublisherService } from '@omnidraw/service-event-publisher/EventPublisherService';
import { ZNotificationEvent } from './contract';
import { fxNotificationEvents } from './fx.notification-events';

describe('notification warning delivery', () => {
  test('accepts warning severity and atomically replays the latest warning to a late subscriber', async () => {
    const warning = ZNotificationEvent.parse({
      type: 'warning',
      title: 'Widget tooling prerequisites unavailable',
      description: 'Install Node.js and npm.',
    });
    const publisher = new EventPublisherService();
    const sequence = publisher.publishNotification(warning);

    const events = fxNotificationEvents(publisher, {});
    expect(await events.next()).toEqual({
      done: false,
      value: { ...warning, sequence },
    });
    await events.return(undefined);
    expect(publisher.getLatestNotification()).toEqual(warning);
  });

  test('replays only records after the supplied reconnect cursor', async () => {
    const publisher = new EventPublisherService();
    const firstSequence = publisher.publishNotification({
      type: 'info',
      title: 'Already delivered',
    });
    const secondSequence = publisher.publishNotification({
      type: 'success',
      title: 'Replay me',
    });

    const events = fxNotificationEvents(publisher, {
      afterSequence: firstSequence,
    });
    expect(await events.next()).toEqual({
      done: false,
      value: { type: 'success', title: 'Replay me', sequence: secondSequence },
    });
    await events.return(undefined);
  });
});
