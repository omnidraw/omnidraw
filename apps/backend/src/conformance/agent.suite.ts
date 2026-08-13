import { Effect, Stream } from 'effect';
import { fxConnectAgent } from '../core/agent/fx.connect';
import { fxAgentEvents } from '../core/agent/fx.events';
import { fxReadAgentHistory } from '../core/agent/fx.history';
import type { AgentAuthority } from '../core/agent/service.agent';

const agentEventKind = (event: unknown): string => (
  typeof event === 'object'
    && event !== null
    && 'kind' in event
    && typeof event.kind === 'string'
    ? event.kind
    : 'chat'
);

export function runAgentConformance(): Effect.Effect<
  Readonly<{
    historyCount: number;
    eventSequence: number;
    eventKind: string;
    terminalCode: string;
  }>,
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
      JSON.stringify(history) !== JSON.stringify(connected.messageHistory)
      || JSON.stringify(reconnected.messageHistory) !== JSON.stringify(connected.messageHistory)
      || record._tag !== 'Some'
      || record.value.sequence !== 1
      || agentEventKind(record.value.event) !== 'widget-catalog'
    ) {
      return yield* Effect.die('Agent authority violated connect/history/cursor semantics.');
    }
    return {
      historyCount: history.length,
      eventSequence: record.value.sequence,
      eventKind: agentEventKind(record.value.event),
      terminalCode: terminal.code,
    };
  });
}
