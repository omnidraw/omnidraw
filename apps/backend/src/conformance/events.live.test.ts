import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { EventAuthority } from '../core/events/service.events';
import { EventPublisherService } from '../shell/events/EventPublisherService';
import { eventAuthorityFromLive } from '../shell/runtime/layer.semantic-authorities';
import { runEventsConformance } from './events.suite';

describe('events live conformance', () => {
  test('runs shared publication/replay/cursor semantics against EventPublisherService', async () => {
    const result = await Effect.runPromise(runEventsConformance().pipe(
      Effect.provideService(EventAuthority, eventAuthorityFromLive(new EventPublisherService())),
    ));
    expect(result).toEqual({
      firstSequence: 1,
      replayedSequence: 1,
      cursorCount: 1,
      terminalCode: 'EVENT_CURSOR_INVALID',
    });
  });
});
