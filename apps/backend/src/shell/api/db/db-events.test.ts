import { describe, expect, test } from 'bun:test';
import { EventPublisherService } from '#backend/shell/events/EventPublisherService';
import { apiDbEvents } from './api.db-events';

const CANVAS_ID = 'canvas-a';
const UNKNOWN_CANVAS_ID = 'canvas-unknown';

type TFixture = ReturnType<typeof createFixture>;

function createFixture() {
  const publisher = new EventPublisherService();
  let subscriptionCount = 0;
  const effects = {
    findCanvasById: async (args: { id: string }) => (
      args.id === CANVAS_ID
        ? {
          id: CANVAS_ID,
          name: 'Owner canvas',
          revision: 0,
          createdAtSec: '2026-01-01 00:00:00',
          updatedAtSec: '2026-01-01 00:00:00',
        }
        : null
    ),
    subscribeDbEventRecords: (canvasId: string, options?: { afterSequence?: number }) => {
      subscriptionCount += 1;
      return publisher.subscribeDbEventRecords(canvasId, options);
    },
  };
  return {
    context: () => ({
      db: {
        canvas: {
          findById: effects.findCanvasById,
        },
      },
      eventPublisher: {
        subscribeDbEventRecords: effects.subscribeDbEventRecords,
      },
    }),
    publisher,
    subscriptionCount: () => subscriptionCount,
  };
}

async function rejectionSignature(fixture: TFixture, canvasId: string) {
  const subscribe = apiDbEvents.callable({ context: fixture.context() });
  const events = await subscribe({ canvasId });
  try {
    await events.next();
    throw new Error('Expected rejection.');
  } catch (error) {
    return {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

describe('database event API replay', () => {
  test('rejects an unknown canvas before opening the subscription', async () => {
    const fixture = createFixture();
    const unknown = await rejectionSignature(fixture, UNKNOWN_CANVAS_ID);

    expect(unknown).toEqual({ name: 'Error', message: 'Canvas not found' });
    expect(fixture.subscriptionCount()).toBe(0);
  });

  test('returns a monotonic sequence and replays only events after the reconnect cursor', async () => {
    const fixture = createFixture();
    const firstSequence = fixture.publisher.publishDbEvent(CANVAS_ID, {
      data: { change: 'delete', table: 'widgets', id: 'already-delivered' },
    });
    const secondSequence = fixture.publisher.publishDbEvent(CANVAS_ID, {
      data: { change: 'delete', table: 'widgets', id: 'replay-me' },
    });

    const subscribe = apiDbEvents.callable({ context: fixture.context() });
    const events = await subscribe({
      afterSequence: firstSequence,
      canvasId: CANVAS_ID,
    });
    expect(await events.next()).toEqual({
      done: false,
      value: {
        data: { change: 'delete', table: 'widgets', id: 'replay-me' },
        sequence: secondSequence,
      },
    });
    expect(secondSequence).toBe(firstSequence + 1);
    expect(fixture.subscriptionCount()).toBe(1);
    await events.return(undefined);
  });
});
