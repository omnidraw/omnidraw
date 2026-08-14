import type {
  TCanvasCommand,
  TCanvasEvent,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasItemsChangedEvent,
  TCanvasSnapshot,
} from '@omnidraw/canvas-contract';
import { Context, type Effect, type Stream } from 'effect';
import type { CanvasAuthorityError } from './errors';

export interface ICanvasAuthority {
  readonly getSnapshot: (
    args: Readonly<{ canvasId: string }>,
  ) => Effect.Effect<TCanvasSnapshot, CanvasAuthorityError>;
  readonly queryItems: (
    args: TCanvasItemQuery,
  ) => Effect.Effect<TCanvasItemPage, CanvasAuthorityError>;
  readonly execute: (
    args: TCanvasCommand,
  ) => Effect.Effect<TCanvasItemsChangedEvent, CanvasAuthorityError>;
  readonly events: (
    args: Readonly<{ canvasId: string; afterRevision: number }>,
  ) => Effect.Effect<Stream.Stream<TCanvasEvent, CanvasAuthorityError>, CanvasAuthorityError>;
  readonly release: (
    args: Readonly<{ canvasId: string }>,
  ) => Effect.Effect<void, CanvasAuthorityError>;
  readonly beginDeletion: (
    args: Readonly<{ canvasId: string }>,
  ) => Effect.Effect<void, CanvasAuthorityError>;
  readonly abortDeletion: (
    args: Readonly<{ canvasId: string }>,
  ) => Effect.Effect<void, CanvasAuthorityError>;
  readonly commitDeletion: (
    args: Readonly<{ canvasId: string }>,
  ) => Effect.Effect<void, CanvasAuthorityError>;
}

export class CanvasAuthority extends Context.Service<CanvasAuthority, ICanvasAuthority>()(
  'omnidraw/backend/CanvasAuthority',
) {}
