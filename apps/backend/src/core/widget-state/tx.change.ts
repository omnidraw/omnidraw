import { Effect } from 'effect';
import type { TWidgetStateChangeArgs, TWidgetStateChangeResult } from './types';
import { WidgetStateAuthority, type WidgetStateProgramError } from './service.widget-state';

export const txChangeWidgetState = Effect.fn('txChangeWidgetState')(function*(
  args: TWidgetStateChangeArgs,
): Effect.fn.Return<TWidgetStateChangeResult, WidgetStateProgramError, WidgetStateAuthority> {
  const authority = yield* WidgetStateAuthority;
  return yield* authority.change(args);
});
