import { describe, expect, test } from 'bun:test';
import { EventPublisherService } from './EventPublisherService';

describe('EventPublisherService', () => {
  test('publishes one process-wide notification stream and latest value', async () => {
    const service = new EventPublisherService();
    const iterator = service.subscribeNotifications()[Symbol.asyncIterator]();
    const next = iterator.next();

    const sequence = service.publishNotification({
      type: 'info',
      title: 'Filesystem catalog refreshed',
    });

    expect(sequence).toBe(1);
    expect(await next).toEqual({
      done: false,
      value: { type: 'info', title: 'Filesystem catalog refreshed' },
    });
    expect(service.getLatestNotification()).toEqual({
      type: 'info',
      title: 'Filesystem catalog refreshed',
    });
    await iterator.return?.();
  });

  test('supports canvas topics, wildcard replay, and one monotonic cursor', async () => {
    const service = new EventPublisherService();
    const firstSequence = service.publishDbEvent('canvas-a', {
      data: { change: 'delete', table: 'canvas_items', id: 'one' },
    });
    service.publishDbEvent('canvas-b', {
      data: { change: 'delete', table: 'canvas_items', id: 'two' },
    });

    const canvasReplay = service.subscribeDbEventRecords('canvas-a', {
      afterSequence: 0,
    })[Symbol.asyncIterator]();
    expect(await canvasReplay.next()).toEqual({
      done: false,
      value: {
        event: { data: { change: 'delete', table: 'canvas_items', id: 'one' } },
        sequence: firstSequence,
      },
    });
    await canvasReplay.return?.();

    const wildcard = service.subscribeDbEvents('*', {
      afterSequence: firstSequence,
    })[Symbol.asyncIterator]();
    expect(await wildcard.next()).toEqual({
      done: false,
      value: { data: { change: 'delete', table: 'canvas_items', id: 'two' } },
    });
    expect(service.getDbEventCursor()).toBe(2);
    await wildcard.return?.();
  });

  test('replays the latest notification by default and resumes from a cursor', async () => {
    const service = new EventPublisherService();
    const firstSequence = service.publishNotification({ type: 'info', title: 'First' });

    const initial = service.subscribeNotificationRecords()[Symbol.asyncIterator]();
    expect(await initial.next()).toEqual({
      done: false,
      value: { event: { type: 'info', title: 'First' }, sequence: firstSequence },
    });
    await initial.return?.();

    const secondSequence = service.publishNotification({ type: 'success', title: 'Second' });
    const reconnect = service.subscribeNotificationRecords({
      afterSequence: firstSequence,
    })[Symbol.asyncIterator]();
    expect(await reconnect.next()).toEqual({
      done: false,
      value: { event: { type: 'success', title: 'Second' }, sequence: secondSequence },
    });
    await reconnect.return?.();
  });
});
