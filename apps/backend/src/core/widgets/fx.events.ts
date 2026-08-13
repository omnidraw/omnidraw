import { Effect, type Stream } from 'effect';
import {
  WidgetAuthority,
  type TWidgetPublicationResult,
  type WidgetProgramError,
} from './service.widgets';

export function fxWidgetEvents(
  args: Readonly<{ afterGeneration?: number }>,
): Effect.Effect<Stream.Stream<TWidgetPublicationResult, WidgetProgramError>, WidgetProgramError, WidgetAuthority> {
  return Effect.gen(function*() {
    const authority = yield* WidgetAuthority;
    return yield* authority.events(args);
  });
}
