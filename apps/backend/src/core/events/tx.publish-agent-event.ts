import { Effect } from 'effect';
import type { TAgentEvent } from './events';
import { EventAuthority, type EventProgramError } from './service.events';

export type TArgsPublishAgentEvent = Readonly<{ event: TAgentEvent }>;

export const txPublishAgentEvent = Effect.fn('txPublishAgentEvent')(function*(
  args: TArgsPublishAgentEvent,
): Effect.fn.Return<number, EventProgramError, EventAuthority> {
  const authority = yield* EventAuthority;
  return yield* authority.publishAgent(args.event);
});
