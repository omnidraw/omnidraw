import { Effect, Stream } from 'effect';
import { fxConnectAgent } from '../core/agent/fx.connect';
import { fxAgentEvents } from '../core/agent/fx.events';
import { fxReadAgentHistory } from '../core/agent/fx.history';
import type { AgentAuthority } from '../core/agent/service.agent';

export function runAgentConformance(): Effect.Effect<
  Readonly<{ historyCount: number; eventSequence: number; terminalCode: string }>,
  unknown,
  AgentAuthority
> {
  return Effect.gen(function*() {
    const request = {
      canvasId: 'canvas-1',
      widgetId: 'chat-1',
      sessionId: '00000000-0000-4000-8000-000000000001',
      mode: 'reuse' as const,
    };
    const connected = yield* fxConnectAgent(request);
    const reconnected = yield* fxConnectAgent(request);
    const history = yield* fxReadAgentHistory(request);
    const events = yield* fxAgentEvents({ afterSequence: 0 });
    const record = yield* Stream.runHead(events);
    const future = yield* fxAgentEvents({ afterSequence: 100 });
    const terminal = yield* Effect.flip(Stream.runHead(future));
    if (
      history.length !== connected.messageHistory.length
      || reconnected.messageHistory.length !== connected.messageHistory.length
      || record._tag !== 'Some'
    ) {
      return yield* Effect.die('Agent authority violated connect/history/cursor semantics.');
    }
    return {
      historyCount: history.length,
      eventSequence: record.value.sequence,
      terminalCode: terminal.code,
    };
  });
}
