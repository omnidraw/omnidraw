import type { TCanvasEvent } from '@omnidraw/canvas-contract';
import { Effect, type Stream } from 'effect';
import type { CanvasAuthorityError } from './errors';
import { CanvasAuthority } from './service.canvas-authority';

export type TArgsCanvasEvents = Readonly<{ canvasId: string; afterRevision: number }>;

export const fxCanvasEvents = Effect.fn('fxCanvasEvents')(function*(
  args: TArgsCanvasEvents,
): Effect.fn.Return<Stream.Stream<TCanvasEvent, CanvasAuthorityError>, CanvasAuthorityError, CanvasAuthority> {
  const authority = yield* CanvasAuthority;
  return yield* authority.events(args);
});
