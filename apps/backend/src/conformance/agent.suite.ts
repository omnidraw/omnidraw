import { Effect } from 'effect';
import { fxConnectAgent } from '../core/agent/fx.connect';
import { fxReadAgentHistory } from '../core/agent/fx.history';
import type { AgentAuthority } from '../core/agent/service.agent';

export function runAgentConformance(): Effect.Effect<
  Readonly<{ historyCount: number }>,
  unknown,
  AgentAuthority
> {
  return Effect.gen(function*() {
    const request = {
      canvasId: 'canvas-1',
      widgetId: 'chat-1',
      sessionId: '00000000-0000-4000-8000-000000000001',
      approvalPolicy: { mode: 'manual' as const },
      mode: 'reuse' as const,
    };
    const connected = yield* fxConnectAgent(request);
    const reconnected = yield* fxConnectAgent(request);
    const history = yield* fxReadAgentHistory(request);
    if (
      history.length !== connected.messageHistory.length
      || reconnected.messageHistory.length !== connected.messageHistory.length
    ) {
      return yield* Effect.die('Agent authority violated connect/history semantics.');
    }
    return { historyCount: history.length };
  });
}
