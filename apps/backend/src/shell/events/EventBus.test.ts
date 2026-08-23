import { describe, expect, test } from 'bun:test';
import {
  EventBus,
  EventCursorInvalidError,
  EventReplayUnavailableError,
  EventSubscriberOverflowError,
} from './EventBus';

describe('EventBus bounded subscriptions', () => {
  test('fails a slow subscriber deterministically and removes it', async () => {
    const bus = new EventBus<string>(8, 2);
    const iterator = bus.subscribeRecords('topic', { afterSequence: 0 })[Symbol.asyncIterator]();
    bus.publish('topic', 'one');
    bus.publish('topic', 'two');
    bus.publish('topic', 'three');
    await expect(iterator.next()).rejects.toBeInstanceOf(EventSubscriberOverflowError);
    expect(bus.cursor()).toBe(3);
  });

  test('replays only values after the supplied cursor and supports cancellation', async () => {
    const bus = new EventBus<string>(8, 2);
    bus.publish('topic', 'one');
    bus.publish('topic', 'two');
    const iterator = bus.subscribeRecords('topic', { afterSequence: 1 })[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: { event: 'two', sequence: 2 } });
    expect(await iterator.return?.()).toEqual({ done: true, value: undefined });
    bus.publish('topic', 'three');
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  test('terminates with an explicit resync failure for future and evicted cursors', async () => {
    const future = new EventBus<string>(2, 2);
    await expect(
      future.subscribeRecords('topic', { afterSequence: 1 })[Symbol.asyncIterator]().next(),
    ).rejects.toBeInstanceOf(EventCursorInvalidError);

    future.publish('topic', 'one');
    future.publish('topic', 'two');
    future.publish('topic', 'three');
    await expect(
      future.subscribeRecords('topic', { afterSequence: 0 })[Symbol.asyncIterator]().next(),
    ).rejects.toBeInstanceOf(EventReplayUnavailableError);
  });
});
