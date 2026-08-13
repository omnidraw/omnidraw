import {
  CanvasService,
  CanvasServiceError,
  type ICanvasService,
  type ICanvasStore,
} from '#backend/shell/canvas/authority';
import { Effect, Layer, Stream } from 'effect';
import { CanvasAuthorityError } from '../../core/canvas/errors';
import {
  CanvasAuthority,
  type ICanvasAuthority,
} from '../../core/canvas/service.canvas-authority';
import { LiveCanvas } from '../runtime/service.live-mechanics';

function mapCanvasError(error: unknown): CanvasAuthorityError {
  if (error instanceof CanvasAuthorityError) return error;
  if (error instanceof CanvasServiceError) {
    return new CanvasAuthorityError(error.code, error.message, error.details, { cause: error });
  }
  return new CanvasAuthorityError('UNAVAILABLE', 'Canvas authority adapter failed.', {}, { cause: error });
}

/** Adapts the application-owned Canvas service without taking over its lifecycle. */
export function canvasAuthorityFromService(service: ICanvasService): ICanvasAuthority {
  return CanvasAuthority.of({
    getSnapshot: (request) => Effect.tryPromise({
      try: () => service.getSnapshot(request),
      catch: mapCanvasError,
    }),
    queryItems: (request) => Effect.tryPromise({
      try: () => service.queryItems(request),
      catch: mapCanvasError,
    }),
    execute: (request) => Effect.tryPromise({
      try: () => service.execute(request),
      catch: mapCanvasError,
    }),
    events: (request) => Effect.try({
      try: () => service.subscribe(request),
      catch: mapCanvasError,
    }).pipe(Effect.map((events) => Stream.fromAsyncIterable(events, mapCanvasError))),
    release: (request) => Effect.tryPromise({
      try: () => service.release(request),
      catch: mapCanvasError,
    }),
  });
}

export function layerCanvasAuthorityFromService(args: Readonly<{
  service: ICanvasService;
}>): Layer.Layer<CanvasAuthority> {
  return Layer.succeed(CanvasAuthority, canvasAuthorityFromService(args.service));
}

export function layerCanvasAuthorityLive(args: Readonly<{
  store: ICanvasStore;
}>): Layer.Layer<CanvasAuthority> {
  return Layer.effect(
    CanvasAuthority,
    Effect.gen(function*() {
      const service = new CanvasService({ store: args.store });
      yield* Effect.addFinalizer(() => Effect.promise(() => service.stop()));
      return canvasAuthorityFromService(service);
    }),
  );
}

/** Production authority is selected from the one scoped application graph. */
export const layerCanvasAuthorityFromLive: Layer.Layer<
  CanvasAuthority,
  never,
  LiveCanvas
> = Layer.effect(
  CanvasAuthority,
  Effect.map(LiveCanvas, canvasAuthorityFromService),
);
