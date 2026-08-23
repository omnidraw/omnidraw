import { Effect } from 'effect';
import {
  AgentAuthority,
  type AgentProgramError,
  type TAgentConnectRequest,
  type TAgentConnection,
} from './service.agent';

export const fxConnectAgent = Effect.fn('fxConnectAgent')(function*(
  args: TAgentConnectRequest,
): Effect.fn.Return<TAgentConnection, AgentProgramError, AgentAuthority> {
  const authority = yield* AgentAuthority;
  return yield* authority.connect(args);
});
