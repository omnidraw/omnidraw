import { expect, test } from "bun:test";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import type { TPrivateRequestInput, TPrivateRequestOutput } from "../app/private-operation-contract";
import { DbResources, type TDbResourceRequestPath } from "./service.db-resources";
import type { TDbApplyDetails } from "./types";
import { DB_OPERATION_POLL_INTERVAL_MS, fxPollDbOperation } from "./fx.poll-db-operation";

const run = (status: TDbApplyDetails["apply"]["status"]): TDbApplyDetails => ({
  apply: {
    id: "apply-1",
    resourceId: "resource-1",
    draftId: "draft-1",
    sourceApplyId: null,
    status,
    lastError: null,
    backupRetained: false,
    createdAtSec: "1",
    completedAtSec: status === "succeeded" ? "2" : null,
  },
  drain: null,
});

test("database operation polling uses virtual time and stops on terminal state", async () => {
  const responses = [run("preparing"), run("applying"), run("succeeded")];
  let reads = 0;
  const resources = DbResources.of({
    read: <Path extends TDbResourceRequestPath>(
      _path: Path,
      _input: TPrivateRequestInput<Path>,
    ) => Effect.sync(() => responses[Math.min(reads++, responses.length - 1)] as TPrivateRequestOutput<Path>),
    write: <Path extends TDbResourceRequestPath>(
      _path: Path,
      _input: TPrivateRequestInput<Path>,
    ) => Effect.die(new Error("Unexpected database write")) as Effect.Effect<TPrivateRequestOutput<Path>>,
  });

  const result = await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* fxPollDbOperation({
      kind: "apply",
      operationId: "apply-1",
    }).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* TestClock.adjust(DB_OPERATION_POLL_INTERVAL_MS * 2);
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(Layer.merge(
    Layer.succeed(DbResources, resources),
    TestClock.layer({ warningDelay: "1 hour" }),
  ))));

  expect(result.apply.status).toBe("succeeded");
  expect(reads).toBe(3);
});

test("interrupting database polling prevents another status read", async () => {
  let reads = 0;
  const resources = DbResources.of({
    read: <Path extends TDbResourceRequestPath>(
      _path: Path,
      _input: TPrivateRequestInput<Path>,
    ) => Effect.sync(() => {
      reads += 1;
      return run("preparing") as TPrivateRequestOutput<Path>;
    }),
    write: <Path extends TDbResourceRequestPath>(
      _path: Path,
      _input: TPrivateRequestInput<Path>,
    ) => Effect.die(new Error("Unexpected database write")) as Effect.Effect<TPrivateRequestOutput<Path>>,
  });

  await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* fxPollDbOperation({
      kind: "apply",
      operationId: "apply-1",
    }).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(fiber);
    yield* TestClock.adjust(DB_OPERATION_POLL_INTERVAL_MS * 10);
  }).pipe(Effect.provide(Layer.merge(
    Layer.succeed(DbResources, resources),
    TestClock.layer({ warningDelay: "1 hour" }),
  ))));

  expect(reads).toBe(1);
});
