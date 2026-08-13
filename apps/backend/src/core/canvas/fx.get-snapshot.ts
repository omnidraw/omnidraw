import type { TCanvasSnapshot } from '@omnidraw/canvas-contract';
import { Effect } from 'effect';
import type { CanvasAuthorityError } from './errors';
import { CanvasAuthority } from './service.canvas-authority';

export type TArgsGetCanvasSnapshot = Readonly<{ canvasId: string }>;

export function fxGetCanvasSnapshot(
  args: TArgsGetCanvasSnapshot,
): Effect.Effect<TCanvasSnapshot, CanvasAuthorityError, CanvasAuthority> {
  return Effect.gen(function*() {
    const authority = yield* CanvasAuthority;
    return yield* authority.getSnapshot(args);
  });
}
