import { Effect } from "effect";
import type { TFrontendTransportFailure } from "./service.frontend-transport";

export const FRONTEND_RECONNECT_RECOVERY_RETRY_DELAYS_MS = Object.freeze([
  100,
  250,
  500,
  1_000,
  2_000,
] as const);

export type TFrontendConnectionGeneration = Readonly<{
  connected: boolean;
  generation: number;
}>;

export type TArgsRecoverAfterReconnect<T> = Readonly<{
  expectedGeneration: number;
  observeGeneration: Effect.Effect<TFrontendConnectionGeneration>;
  awaitGenerationChange: Effect.Effect<
    TFrontendConnectionGeneration,
    TFrontendTransportFailure
  >;
  recover: Effect.Effect<readonly T[], TFrontendTransportFailure>;
}>;

export type TRecoverAfterReconnectResult<T> =
  | Readonly<{ _tag: "Recovered"; events: readonly T[] }>
  | Readonly<{ _tag: "GenerationChanged" }>;

function generationIsCurrent(
  expectedGeneration: number,
  observed: TFrontendConnectionGeneration,
): boolean {
  return observed.connected && observed.generation === expectedGeneration;
}

function recoveryFailureIsRetriable(error: TFrontendTransportFailure): boolean {
  return error.status === 0
    || error.status === 408
    || error.status === 429
    || error.status >= 500;
}

/**
 * Recovers domain state for one accepted physical connection generation.
 * Transient failures use the active Effect Clock; a connection change returns
 * control to the stream supervisor instead of publishing stale recovery data.
 */
export function fxRecoverAfterReconnect<T>(
  args: TArgsRecoverAfterReconnect<T>,
): Effect.Effect<TRecoverAfterReconnectResult<T>, TFrontendTransportFailure> {
  const changedResult: TRecoverAfterReconnectResult<T> = Object.freeze({
    _tag: "GenerationChanged",
  });
  const changed = Effect.succeed(changedResult);

  const attempt = (
    retryIndex: number,
  ): Effect.Effect<TRecoverAfterReconnectResult<T>, TFrontendTransportFailure> =>
    Effect.matchEffect(args.recover, {
      onFailure: (error) => Effect.flatMap(args.observeGeneration, (observed) => {
        if (!generationIsCurrent(args.expectedGeneration, observed)) return changed;
        const retryDelay = FRONTEND_RECONNECT_RECOVERY_RETRY_DELAYS_MS[retryIndex];
        if (retryDelay === undefined || !recoveryFailureIsRetriable(error)) {
          return Effect.fail(error);
        }
        return Effect.sleep(retryDelay).pipe(
          Effect.andThen(args.observeGeneration),
          Effect.flatMap((afterDelay) => generationIsCurrent(args.expectedGeneration, afterDelay)
            ? attempt(retryIndex + 1)
            : changed),
        );
      }),
      onSuccess: (events) => Effect.map(args.observeGeneration, (observed) =>
        generationIsCurrent(args.expectedGeneration, observed)
          ? Object.freeze({ _tag: "Recovered" as const, events })
          : Object.freeze({ _tag: "GenerationChanged" as const })),
    });

  const recoverCurrentGeneration = Effect.flatMap(args.observeGeneration, (observed) =>
    generationIsCurrent(args.expectedGeneration, observed) ? attempt(0) : changed);

  return Effect.raceFirst(
    recoverCurrentGeneration,
    Effect.as(args.awaitGenerationChange, changedResult),
  );
}
