import { Effect, type Stream } from 'effect';
import type { TNotificationEvent, TSequencedEvent } from './events';
import { EventAuthority, type EventProgramError } from './service.events';

export type TArgsNotificationEventRecords = Readonly<{ afterSequence?: number }>;

export const fxNotificationEventRecords = Effect.fn('fxNotificationEventRecords')(function*(
  args: TArgsNotificationEventRecords,
): Effect.fn.Return<Stream.Stream<TSequencedEvent<TNotificationEvent>, EventProgramError>, EventProgramError, EventAuthority> {
  const authority = yield* EventAuthority;
  return yield* authority.notifications(args);
});
