import type { LoggingService } from '@vibecanvas/canvas/services';
import { describe, expect, test, vi } from 'vitest';
import {
  LegacyWidgetActorAdapter,
  type TWidgetActorEvent,
} from '../../src/widget/LegacyWidgetActorAdapter';
import type { TWidgetBrowserPort } from '../../src/ports';
import { createTestWidgetBrowser } from '../test-setup';

type TDeferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}>;

function createDeferred<T>(): TDeferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createControlledStream() {
  const firstNext = createDeferred<IteratorResult<TWidgetActorEvent>>();
  const neverNext = new Promise<IteratorResult<TWidgetActorEvent>>(() => undefined);
  const next = vi.fn()
    .mockImplementationOnce(() => firstNext.promise)
    .mockImplementation(() => neverNext);
  const close = vi.fn(async () => ({ done: true, value: undefined }) as IteratorResult<TWidgetActorEvent>);
  const iterable: AsyncIterable<TWidgetActorEvent> = {
    [Symbol.asyncIterator]() {
      return { next, return: close };
    },
  };
  return { close, firstNext, iterable, next };
}

function createAdapter(
  actorEvents: ReturnType<typeof vi.fn>,
  browser: TWidgetBrowserPort = createTestWidgetBrowser(),
): LegacyWidgetActorAdapter {
  return new LegacyWidgetActorAdapter({
    browser,
    logging: { warn: vi.fn() } as unknown as LoggingService,
    transport: {
      api: {
        actors: { events: actorEvents },
      },
    } as never,
  });
}

describe('LegacyWidgetActorAdapter listener ownership', () => {
  test('ignores an old stream result that arrives after a rapid stop and restart', async () => {
    const oldStream = createControlledStream();
    const currentStream = createControlledStream();
    const actorEvents = vi.fn()
      .mockResolvedValueOnce([null, oldStream.iterable] as const)
      .mockResolvedValueOnce([null, currentStream.iterable] as const);
    const adapter = createAdapter(actorEvents);

    adapter.start();
    await vi.waitFor(() => expect(oldStream.next).toHaveBeenCalledOnce());

    adapter.stop();
    adapter.start();
    const handler = vi.fn();
    adapter.subscribe('actor-1', handler);
    await vi.waitFor(() => expect(currentStream.next).toHaveBeenCalledOnce());

    const oldEvent: TWidgetActorEvent = {
      kind: 'actor',
      actorId: 'actor-1',
      name: 'old-generation',
      payload: null,
    };
    oldStream.firstNext.resolve({ done: false, value: oldEvent });
    await oldStream.firstNext.promise;
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
    expect(oldStream.next).toHaveBeenCalledOnce();

    const currentEvent: TWidgetActorEvent = {
      kind: 'actor',
      actorId: 'actor-1',
      name: 'current-generation',
      payload: null,
    };
    currentStream.firstNext.resolve({ done: false, value: currentEvent });
    await currentStream.firstNext.promise;
    await Promise.resolve();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(currentEvent);
    expect(oldStream.close).toHaveBeenCalledOnce();

    adapter.stop();
  });

  test('does not let an old reconnect wait start a second listener after restart', async () => {
    const reconnectCallbacks = new Map<number, () => void>();
    let nextTimerId = 0;
    const setTimeout = vi.fn((callback: () => void) => {
      const timerId = ++nextTimerId;
      reconnectCallbacks.set(timerId, callback);
      return timerId;
    });
    const clearTimeout = vi.fn((timer: unknown) => {
      reconnectCallbacks.delete(timer as number);
    });
    const browser: TWidgetBrowserPort = {
      ...createTestWidgetBrowser(),
      setTimeout,
      clearTimeout,
    };
    const exhaustedStream: AsyncIterable<TWidgetActorEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next: vi.fn(async () => ({ done: true, value: undefined }) as IteratorResult<TWidgetActorEvent>),
        };
      },
    };
    const currentStream = createControlledStream();
    const actorEvents = vi.fn()
      .mockResolvedValue([null, currentStream.iterable] as const)
      .mockResolvedValueOnce([null, exhaustedStream] as const);
    const adapter = createAdapter(actorEvents, browser);

    adapter.start();
    await vi.waitFor(() => expect(setTimeout).toHaveBeenCalledOnce());

    adapter.stop();
    adapter.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(clearTimeout).toHaveBeenCalledOnce();
    expect(actorEvents).toHaveBeenCalledTimes(2);
    expect(currentStream.next).toHaveBeenCalledOnce();

    adapter.stop();
  });
});
