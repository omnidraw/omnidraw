import { Effect, type Stream } from 'effect';
import type { TDbEvent, TSequencedEvent } from './events';
import { EventAuthority, type EventProgramError } from './service.events';

export type TArgsDbEventRecords = Readonly<{ canvasId: string; afterSequence?: number }>;

export const fxDbEventRecords = Effect.fn('fxDbEventRecords')(function*(
  args: TArgsDbEventRecords,
): Effect.fn.Return<Stream.Stream<TSequencedEvent<TDbEvent>, EventProgramError>, EventProgramError, EventAuthority> {
  const authority = yield* EventAuthority;
  return yield* authority.db(args);
});
