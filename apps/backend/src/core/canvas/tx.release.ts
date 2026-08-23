import { Effect } from 'effect';
import type { CanvasAuthorityError } from './errors';
import { CanvasAuthority } from './service.canvas-authority';

export type TArgsReleaseCanvas = Readonly<{ canvasId: string }>;

export const txReleaseCanvas = Effect.fn('txReleaseCanvas')(function*(
  args: TArgsReleaseCanvas,
): Effect.fn.Return<void, CanvasAuthorityError, CanvasAuthority> {
  const authority = yield* CanvasAuthority;
  return yield* authority.release(args);
});
