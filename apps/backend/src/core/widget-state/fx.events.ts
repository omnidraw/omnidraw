import { Effect, type Stream } from 'effect';
import type { TWidgetStateSubscribeArgs, TWidgetStateSubscriptionEvent } from './types';
import { WidgetStateAuthority, type WidgetStateProgramError } from './service.widget-state';

export function fxWidgetStateEvents(
  args: TWidgetStateSubscribeArgs,
): Effect.Effect<Stream.Stream<TWidgetStateSubscriptionEvent, WidgetStateProgramError>, WidgetStateProgramError, WidgetStateAuthority> {
  return Effect.gen(function*() {
    const authority = yield* WidgetStateAuthority;
    return yield* authority.events(args);
  });
}
