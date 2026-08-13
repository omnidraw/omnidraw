import { Effect, type Stream } from 'effect';
import type { TAgentEvent, TSequencedEvent } from '../events/events';
import { AgentAuthority, type AgentProgramError } from './service.agent';

export type TArgsAgentEvents = Readonly<{ afterSequence?: number }>;

export function fxAgentEvents(
  args: TArgsAgentEvents,
): Effect.Effect<Stream.Stream<TSequencedEvent<TAgentEvent>, AgentProgramError>, AgentProgramError, AgentAuthority> {
  return Effect.gen(function*() {
    const authority = yield* AgentAuthority;
    return yield* authority.events(args);
  });
}
