import { Effect, type Stream } from 'effect';
import type { TAgentEvent, TSequencedEvent } from './events';
import { EventAuthority, type EventProgramError } from './service.events';

export type TArgsAgentEventRecords = Readonly<{ afterSequence?: number }>;

export const fxAgentEventRecords = Effect.fn('fxAgentEventRecords')(function*(
  args: TArgsAgentEventRecords,
): Effect.fn.Return<Stream.Stream<TSequencedEvent<TAgentEvent>, EventProgramError>, EventProgramError, EventAuthority> {
  const authority = yield* EventAuthority;
  return yield* authority.agent(args);
});
