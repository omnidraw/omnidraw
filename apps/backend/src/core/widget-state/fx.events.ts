import { Effect, type Stream } from 'effect';
import type { TWidgetStateSubscribeArgs, TWidgetStateSubscriptionEvent } from './types';
import { WidgetStateAuthority, type WidgetStateProgramError } from './service.widget-state';

export const fxWidgetStateEvents = Effect.fn('fxWidgetStateEvents')(function*(
  args: TWidgetStateSubscribeArgs,
): Effect.fn.Return<Stream.Stream<TWidgetStateSubscriptionEvent, WidgetStateProgramError>, WidgetStateProgramError, WidgetStateAuthority> {
  const authority = yield* WidgetStateAuthority;
  return yield* authority.events(args);
});
