import { expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { FrontendTransportError } from "./service.frontend-transport";
import {
  FRONTEND_RECONNECT_RECOVERY_RETRY_DELAYS_MS,
  fxRecoverAfterReconnect,
} from "./fx.recover-after-reconnect";

test("reconnect recovery exhausts its finite retry policy on the Effect Clock", async () => {
  const failure = new FrontendTransportError({
    code: "TRANSPORT_FAILURE",
    status: 503,
    message: "Recovery authority remained unavailable.",
    details: null,
  });
  let attempts = 0;
  const program = fxRecoverAfterReconnect({
    expectedGeneration: 4,
    observeGeneration: Effect.succeed({ connected: true, generation: 4 }),
    awaitGenerationChange: Effect.never,
    recover: Effect.suspend(() => {
      attempts += 1;
      return Effect.fail(failure);
    }),
  });

  const observed = await Effect.runPromise(Effect.gen(function*() {
    const recovery = yield* program.pipe(Effect.forkChild);
    yield* TestClock.adjust(FRONTEND_RECONNECT_RECOVERY_RETRY_DELAYS_MS
      .reduce((total, delay) => total + delay, 0));
    return yield* Effect.flip(Fiber.join(recovery));
  }).pipe(Effect.provide(TestClock.layer({ warningDelay: "1 hour" }))));

  expect(observed).toBe(failure);
  expect(attempts).toBe(FRONTEND_RECONNECT_RECOVERY_RETRY_DELAYS_MS.length + 1);
});
