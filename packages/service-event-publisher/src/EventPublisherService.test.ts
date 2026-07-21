import { describe, expect, test } from 'bun:test';
import { EventPublisherService } from './EventPublisherService';

describe('EventPublisherService', () => {
  test('publishes service-owned notification contracts', async () => {
    const service = new EventPublisherService();
    const iterator = service.subscribeNotifications()[Symbol.asyncIterator]();
    const next = iterator.next();

    service.publishNotification({ type: 'info', title: 'Ready' });

    expect(await next).toEqual({
      done: false,
      value: { type: 'info', title: 'Ready' },
    });
    expect(service.getLatestNotification()).toEqual({ type: 'info', title: 'Ready' });
    await iterator.return?.();
  });
});
