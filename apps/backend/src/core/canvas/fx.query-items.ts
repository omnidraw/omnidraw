import type { TCanvasItemPage, TCanvasItemQuery } from '@omnidraw/canvas-contract';
import { Effect } from 'effect';
import type { CanvasAuthorityError } from './errors';
import { CanvasAuthority } from './service.canvas-authority';

export type TArgsQueryCanvasItems = TCanvasItemQuery;

export const fxQueryCanvasItems = Effect.fn('fxQueryCanvasItems')(function*(
  args: TArgsQueryCanvasItems,
): Effect.fn.Return<TCanvasItemPage, CanvasAuthorityError, CanvasAuthority> {
  const authority = yield* CanvasAuthority;
  return yield* authority.queryItems(args);
});
