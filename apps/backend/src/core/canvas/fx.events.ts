import type { TCanvasEvent } from '@omnidraw/canvas-contract';
import { Effect, type Stream } from 'effect';
import type { CanvasAuthorityError } from './errors';
import { CanvasAuthority } from './service.canvas-authority';

export type TArgsCanvasEvents = Readonly<{ canvasId: string; afterRevision: number }>;

export function fxCanvasEvents(
  args: TArgsCanvasEvents,
): Effect.Effect<Stream.Stream<TCanvasEvent, CanvasAuthorityError>, CanvasAuthorityError, CanvasAuthority> {
  return Effect.gen(function*() {
    const authority = yield* CanvasAuthority;
    return yield* authority.events(args);
  });
}
