import { Effect } from 'effect';
import {
  AgentAuthority,
  type AgentProgramError,
  type TAgentHistoryEntry,
  type TAgentHistoryRequest,
} from './service.agent';

export const fxReadAgentHistory = Effect.fn('fxReadAgentHistory')(function*(
  args: TAgentHistoryRequest,
): Effect.fn.Return<readonly TAgentHistoryEntry[], AgentProgramError, AgentAuthority> {
  const authority = yield* AgentAuthority;
  return yield* authority.history(args);
});
