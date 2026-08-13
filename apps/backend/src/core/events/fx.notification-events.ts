import { Effect, type Stream } from 'effect';
import type { TNotificationEvent, TSequencedEvent } from './events';
import { EventAuthority, type EventProgramError } from './service.events';

export function fxNotificationEventRecords(
  args: Readonly<{ afterSequence?: number }>,
): Effect.Effect<Stream.Stream<TSequencedEvent<TNotificationEvent>, EventProgramError>, EventProgramError, EventAuthority> {
  return Effect.gen(function*() {
    const authority = yield* EventAuthority;
    return yield* authority.notifications(args);
  });
}
