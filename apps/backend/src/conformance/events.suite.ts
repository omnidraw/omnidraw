import { Effect, Stream } from 'effect';
import { fxAgentEventRecords } from '../core/events/fx.agent-events';
import { txPublishAgentEvent } from '../core/events/tx.publish-agent-event';
import type { EventAuthority } from '../core/events/service.events';

export function runEventsConformance(): Effect.Effect<
  Readonly<{
    firstSequence: number;
    replayedSequence: number;
    cursorCount: number;
    terminalCode: string;
  }>,
  unknown,
  EventAuthority
> {
  return Effect.gen(function*() {
    const firstSequence = yield* txPublishAgentEvent({
      event: { kind: 'widget-catalog', type: 'changed' },
    });
    const replay = yield* fxAgentEventRecords({ afterSequence: firstSequence - 1 });
    const replayed = yield* Stream.runHead(replay);
    yield* txPublishAgentEvent({ event: { kind: 'widget-catalog', type: 'changed' } });
    const after = yield* fxAgentEventRecords({ afterSequence: firstSequence });
    const cursor = yield* Stream.runHead(after);
    const future = yield* fxAgentEventRecords({ afterSequence: 100 });
    const terminal = yield* Effect.flip(Stream.runHead(future));
    if (replayed._tag !== 'Some') return yield* Effect.die('Event replay is missing.');
    return {
      firstSequence,
      replayedSequence: replayed.value.sequence,
      cursorCount: cursor._tag === 'Some' ? 1 : 0,
      terminalCode: terminal.code,
    };
  });
}
