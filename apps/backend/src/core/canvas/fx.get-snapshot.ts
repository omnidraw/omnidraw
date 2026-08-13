import type { TCanvasSnapshot } from '@omnidraw/canvas-contract';
import { Effect } from 'effect';
import type { CanvasAuthorityError } from './errors';
import { CanvasAuthority } from './service.canvas-authority';

export type TArgsGetCanvasSnapshot = Readonly<{ canvasId: string }>;

export const fxGetCanvasSnapshot = Effect.fn('fxGetCanvasSnapshot')(function*(
  args: TArgsGetCanvasSnapshot,
): Effect.fn.Return<TCanvasSnapshot, CanvasAuthorityError, CanvasAuthority> {
  const authority = yield* CanvasAuthority;
  return yield* authority.getSnapshot(args);
});
