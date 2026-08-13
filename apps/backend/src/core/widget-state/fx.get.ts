import { Effect } from 'effect';
import type { TWidgetStateGetArgs, TWidgetStateGetResult } from './types';
import { WidgetStateAuthority, type WidgetStateProgramError } from './service.widget-state';

export const fxGetWidgetState = Effect.fn('fxGetWidgetState')(function*(
  args: TWidgetStateGetArgs,
): Effect.fn.Return<TWidgetStateGetResult, WidgetStateProgramError, WidgetStateAuthority> {
  const authority = yield* WidgetStateAuthority;
  return yield* authority.get(args);
});
