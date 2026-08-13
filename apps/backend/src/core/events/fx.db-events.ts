import { Effect, type Stream } from 'effect';
import type { TDbEvent, TSequencedEvent } from './events';
import { EventAuthority, type EventProgramError } from './service.events';

export function fxDbEventRecords(
  args: Readonly<{ canvasId: string; afterSequence?: number }>,
): Effect.Effect<Stream.Stream<TSequencedEvent<TDbEvent>, EventProgramError>, EventProgramError, EventAuthority> {
  return Effect.gen(function*() {
    const authority = yield* EventAuthority;
    return yield* authority.db(args);
  });
}
