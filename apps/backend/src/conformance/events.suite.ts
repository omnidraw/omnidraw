import { Effect, Stream } from 'effect';
import { fxAgentEventRecords } from '../core/events/fx.agent-events';
import { txPublishAgentEvent } from '../core/events/tx.publish-agent-event';
import type { EventAuthority } from '../core/events/service.events';

const agentEventKind = (event: unknown): string => (
  typeof event === 'object'
    && event !== null
    && 'kind' in event
    && typeof event.kind === 'string'
    ? event.kind
    : 'chat'
);

export function runEventsConformance(): Effect.Effect<
  Readonly<{
    firstSequence: number;
    replayed: readonly Readonly<{ sequence: number; kind: string }>[];
    afterCursor: readonly Readonly<{ sequence: number; kind: string }>[];
    terminalCode: string;
  }>,
  unknown,
  EventAuthority
> {
  return Effect.gen(function*() {
    const firstSequence = yield* txPublishAgentEvent({
      event: { kind: 'widget-catalog', type: 'changed' },
    });
    yield* txPublishAgentEvent({
      event: {
        kind: 'widgetupdate',
        widgetId: 'widget-1',
        sessionId: 'session-1',
        cwd: '/portable-counter',
        files: ['ui/main.ts'],
      },
    });
    const replay = yield* fxAgentEventRecords({ afterSequence: firstSequence - 1 });
    const replayed = yield* Stream.runCollect(Stream.take(replay, 2));
    const after = yield* fxAgentEventRecords({ afterSequence: firstSequence });
    const cursor = yield* Stream.runCollect(Stream.take(after, 1));
    const future = yield* fxAgentEventRecords({ afterSequence: 100 });
    const terminal = yield* Effect.flip(Stream.runHead(future));
    if (replayed.length !== 2 || cursor.length !== 1) {
      return yield* Effect.die('Event replay history is incomplete.');
    }
    return {
      firstSequence,
      replayed: Array.from(replayed, ({ sequence, event }) => ({
        sequence,
        kind: agentEventKind(event),
      })),
      afterCursor: Array.from(cursor, ({ sequence, event }) => ({
        sequence,
        kind: agentEventKind(event),
      })),
      terminalCode: terminal.code,
    };
  });
}
