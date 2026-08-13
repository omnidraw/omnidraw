import { Effect } from 'effect';
import type { CanvasAuthorityError } from './errors';
import { CanvasAuthority } from './service.canvas-authority';

export type TArgsReleaseCanvas = Readonly<{ canvasId: string }>;

export function txReleaseCanvas(
  args: TArgsReleaseCanvas,
): Effect.Effect<void, CanvasAuthorityError, CanvasAuthority> {
  return Effect.gen(function*() {
    const authority = yield* CanvasAuthority;
    return yield* authority.release(args);
  });
}
