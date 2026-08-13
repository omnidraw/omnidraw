import { Effect, type Stream } from 'effect';
import {
  WidgetAuthority,
  type TWidgetPublicationResult,
  type WidgetProgramError,
} from './service.widgets';

export type TArgsWidgetEvents = Readonly<{ afterGeneration?: number }>;

export const fxWidgetEvents = Effect.fn('fxWidgetEvents')(function*(
  args: TArgsWidgetEvents,
): Effect.fn.Return<Stream.Stream<TWidgetPublicationResult, WidgetProgramError>, WidgetProgramError, WidgetAuthority> {
  const authority = yield* WidgetAuthority;
  return yield* authority.events(args);
});
