import { Effect, type Stream } from 'effect';
import type { TAgentEvent, TSequencedEvent } from './events';
import { EventAuthority, type EventProgramError } from './service.events';

export type TArgsAgentEventRecords = Readonly<{ afterSequence?: number }>;

export function fxAgentEventRecords(
  args: TArgsAgentEventRecords,
): Effect.Effect<Stream.Stream<TSequencedEvent<TAgentEvent>, EventProgramError>, EventProgramError, EventAuthority> {
  return Effect.gen(function*() {
    const authority = yield* EventAuthority;
    return yield* authority.agent(args);
  });
}
