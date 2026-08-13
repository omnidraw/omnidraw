import { Effect } from 'effect';
import type { TWidgetStateChangeArgs, TWidgetStateChangeResult } from './types';
import { WidgetStateAuthority, type WidgetStateProgramError } from './service.widget-state';

export function txChangeWidgetState(
  args: TWidgetStateChangeArgs,
): Effect.Effect<TWidgetStateChangeResult, WidgetStateProgramError, WidgetStateAuthority> {
  return Effect.gen(function*() {
    const authority = yield* WidgetStateAuthority;
    return yield* authority.change(args);
  });
}
