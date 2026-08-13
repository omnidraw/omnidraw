import { Effect } from 'effect';
import {
  AgentAuthority,
  type AgentProgramError,
  type TAgentConnectRequest,
  type TAgentConnection,
} from './service.agent';

export function fxConnectAgent(
  args: TAgentConnectRequest,
): Effect.Effect<TAgentConnection, AgentProgramError, AgentAuthority> {
  return Effect.gen(function*() {
    const authority = yield* AgentAuthority;
    return yield* authority.connect(args);
  });
}
