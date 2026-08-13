import type { TCanvasItemPage, TCanvasItemQuery } from '@omnidraw/canvas-contract';
import { Effect } from 'effect';
import type { CanvasAuthorityError } from './errors';
import { CanvasAuthority } from './service.canvas-authority';

export type TArgsQueryCanvasItems = TCanvasItemQuery;

export function fxQueryCanvasItems(
  args: TArgsQueryCanvasItems,
): Effect.Effect<TCanvasItemPage, CanvasAuthorityError, CanvasAuthority> {
  return Effect.gen(function*() {
    const authority = yield* CanvasAuthority;
    return yield* authority.queryItems(args);
  });
}
