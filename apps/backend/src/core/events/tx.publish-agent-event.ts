import { Effect } from 'effect';
import type { TAgentEvent } from './events';
import { EventAuthority, type EventProgramError } from './service.events';

export type TArgsPublishAgentEvent = Readonly<{ event: TAgentEvent }>;

export function txPublishAgentEvent(
  args: TArgsPublishAgentEvent,
): Effect.Effect<number, EventProgramError, EventAuthority> {
  return Effect.gen(function*() {
    const authority = yield* EventAuthority;
    return yield* authority.publishAgent(args.event);
  });
}
