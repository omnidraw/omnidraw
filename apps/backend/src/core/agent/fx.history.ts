import { Effect } from 'effect';
import {
  AgentAuthority,
  type AgentProgramError,
  type TAgentHistoryEntry,
  type TAgentHistoryRequest,
} from './service.agent';

export function fxReadAgentHistory(
  args: TAgentHistoryRequest,
): Effect.Effect<readonly TAgentHistoryEntry[], AgentProgramError, AgentAuthority> {
  return Effect.gen(function*() {
    const authority = yield* AgentAuthority;
    return yield* authority.history(args);
  });
}
