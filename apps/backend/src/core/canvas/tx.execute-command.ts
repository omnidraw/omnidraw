import type { TCanvasCommand, TCanvasItemsChangedEvent } from '@omnidraw/canvas-contract';
import { Effect } from 'effect';
import type { CanvasAuthorityError } from './errors';
import { CanvasAuthority } from './service.canvas-authority';

export type TArgsExecuteCanvasCommand = TCanvasCommand;

export function txExecuteCanvasCommand(
  args: TArgsExecuteCanvasCommand,
): Effect.Effect<TCanvasItemsChangedEvent, CanvasAuthorityError, CanvasAuthority> {
  return Effect.gen(function*() {
    const authority = yield* CanvasAuthority;
    return yield* authority.execute(args);
  });
}
