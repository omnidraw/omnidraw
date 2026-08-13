import { Effect } from 'effect';
import type { TWidgetStateGetArgs, TWidgetStateGetResult } from './types';
import { WidgetStateAuthority, type WidgetStateProgramError } from './service.widget-state';

export function fxGetWidgetState(
  args: TWidgetStateGetArgs,
): Effect.Effect<TWidgetStateGetResult, WidgetStateProgramError, WidgetStateAuthority> {
  return Effect.gen(function*() {
    const authority = yield* WidgetStateAuthority;
    return yield* authority.get(args);
  });
}
