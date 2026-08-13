import type { TCanvasCommand, TCanvasItemsChangedEvent } from '@omnidraw/canvas-contract';
import { Effect } from 'effect';
import type { CanvasAuthorityError } from './errors';
import { CanvasAuthority } from './service.canvas-authority';

export type TArgsExecuteCanvasCommand = TCanvasCommand;

export const txExecuteCanvasCommand = Effect.fn('txExecuteCanvasCommand')(function*(
  args: TArgsExecuteCanvasCommand,
): Effect.fn.Return<TCanvasItemsChangedEvent, CanvasAuthorityError, CanvasAuthority> {
  const authority = yield* CanvasAuthority;
  return yield* authority.execute(args);
});
