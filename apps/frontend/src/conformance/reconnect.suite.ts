import { Effect } from "effect";
import type {
  TArgsRecoverAfterReconnect,
  TRecoverAfterReconnectResult,
} from "@/core/app/fx.recover-after-reconnect";
import type { TFrontendTransportFailure } from "@/core/app/service.frontend-transport";
import { FrontendTransportError } from "@/core/app/service.frontend-transport";

export type TReconnectLease = Readonly<{ id: number }>;
export type TReconnectConformanceHarness = Readonly<{
  snapshot(): Readonly<{ connected: boolean; generation: number }>;
  lease(): TReconnectLease;
  connect(): void;
  disconnect(): void;
  isCurrent(lease: TReconnectLease): boolean;
  runReconnectRecovery<T>(
    program: Effect.Effect<
      TRecoverAfterReconnectResult<T>,
      TFrontendTransportFailure
    >,
  ): Promise<TRecoverAfterReconnectResult<T>>;
  recoveryProgram<T>(
    args: TArgsRecoverAfterReconnect<T>,
  ): Effect.Effect<
    TRecoverAfterReconnectResult<T>,
    TFrontendTransportFailure
  >;
  observeRecoveryGeneration(): Effect.Effect<Readonly<{
    connected: boolean;
    generation: number;
  }>>;
  awaitRecoveryGenerationChange(expectedGeneration: number): Effect.Effect<
    Readonly<{ connected: boolean; generation: number }>,
    TFrontendTransportFailure
  >;
  waitForRecoveryAttempt(attempts: () => number, expected: number): Promise<void>;
  advanceRecoveryTime(durationMillis: number): Promise<void>;
}>;

/** Same generation scenario proves retirement and stale-result rejection. */
export function reconnectConformanceSuite(harness: TReconnectConformanceHarness): void {
  const initial = harness.lease();
  harness.connect();
  if (harness.snapshot().generation !== 1 || !harness.isCurrent(initial)) throw new Error("Initial connection generation is invalid.");
  harness.disconnect();
  if (harness.isCurrent(initial)) throw new Error("Disconnect did not retire the active lease.");
  const disconnected = harness.lease();
  harness.connect();
  const snapshot = harness.snapshot();
  if (!snapshot.connected || snapshot.generation !== 2) throw new Error("Reconnect did not advance the generation.");
  if (harness.isCurrent(disconnected)) throw new Error("A lease captured while disconnected survived reconnect.");
  if (!harness.isCurrent(harness.lease())) throw new Error("Fresh reconnect lease was incorrectly retired.");
}

export async function reconnectRecoveryConformanceSuite(
  harness: TReconnectConformanceHarness,
): Promise<void> {
  harness.connect();

  let attempts = 0;
  const transient = new FrontendTransportError({
    code: "TRANSPORT_FAILURE",
    status: 503,
    message: "Recovery authority is still starting.",
    details: null,
  });
  const retryGeneration = harness.snapshot().generation;
  const recovered = harness.runReconnectRecovery(harness.recoveryProgram({
    expectedGeneration: retryGeneration,
    observeGeneration: harness.observeRecoveryGeneration(),
    awaitGenerationChange: harness.awaitRecoveryGenerationChange(retryGeneration),
    recover: Effect.suspend(() => {
      attempts += 1;
      return attempts === 1
        ? Effect.fail(transient)
        : Effect.succeed([{ sequence: 7 }] as const);
    }),
  }));
  await harness.waitForRecoveryAttempt(() => attempts, 1);
  await harness.advanceRecoveryTime(100);
  const outcome = await recovered;
  if (outcome._tag !== "Recovered" || outcome.events[0]?.sequence !== 7 || attempts !== 2) {
    throw new Error("Transient reconnect recovery did not retry on the controlled Effect Clock.");
  }

  const terminal = new FrontendTransportError({
    code: "CHAT_SCOPE_INVALID",
    status: 404,
    message: "The mounted chat scope no longer exists.",
    details: null,
  });
  const terminalGeneration = harness.snapshot().generation;
  let observed: unknown = null;
  try {
    await harness.runReconnectRecovery(harness.recoveryProgram({
      expectedGeneration: terminalGeneration,
      observeGeneration: harness.observeRecoveryGeneration(),
      awaitGenerationChange: harness.awaitRecoveryGenerationChange(terminalGeneration),
      recover: Effect.fail(terminal),
    }));
  } catch (error) {
    observed = error;
  }
  if (observed !== terminal) throw new Error("Terminal reconnect recovery failure did not surface unchanged.");

  let generationAttempts = 0;
  const retiringGeneration = harness.snapshot().generation;
  const generationChanged = harness.runReconnectRecovery(harness.recoveryProgram({
    expectedGeneration: retiringGeneration,
    observeGeneration: harness.observeRecoveryGeneration(),
    awaitGenerationChange: harness.awaitRecoveryGenerationChange(retiringGeneration),
    recover: Effect.suspend(() => {
      generationAttempts += 1;
      return Effect.fail(transient);
    }),
  }));
  await harness.waitForRecoveryAttempt(() => generationAttempts, 1);
  harness.disconnect();
  harness.connect();
  const changed = await generationChanged;
  if (changed._tag !== "GenerationChanged" || generationAttempts !== 1) {
    throw new Error("Generation change did not retire stale reconnect recovery.");
  }
}
