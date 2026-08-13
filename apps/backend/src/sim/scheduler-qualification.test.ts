import { describe, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { createSimulationRuntime } from "./runtime";
import { SeededSimulationScheduler } from "./scheduler";

describe("deterministic scheduler qualification", () => {
  test("orders priorities, seeded peers, and dispatcher ownership", () => {
    const scheduler = new SeededSimulationScheduler(91, { autoFlush: false });
    const left = scheduler.makeDispatcher();
    const right = scheduler.makeDispatcher();
    const order: string[] = [];
    left.scheduleTask(() => order.push("left-low"), 10);
    left.scheduleTask(() => order.push("left-peer-a"), 1);
    left.scheduleTask(() => order.push("left-peer-b"), 1);
    right.scheduleTask(() => order.push("right"), 0);

    left.flush();
    expect(order.slice(0, 2).every((entry) => entry.startsWith("left-peer"))).toBe(true);
    expect(order[2]).toBe("left-low");
    expect(order).not.toContain("right");
    right.flush();
    expect(order[3]).toBe("right");
    expect(scheduler.snapshot().every((choice) => (
      choice.runnableSequences.includes(choice.selectedSequence)
    ))).toBe(true);
  });

  test("controls fork, yield, callback continuation, and virtual time", async () => {
    const runtime = createSimulationRuntime({
      applicationVersion: "qualification",
      scenario: "scheduler-fork-yield-callback-clock",
      rootSeed: 19,
    });
    const order: string[] = [];
    const result = await runtime.runPromise(Effect.gen(function*() {
      const child = yield* Effect.gen(function*() {
        order.push("child-start");
        yield* Effect.yieldNow;
        order.push("child-after-yield");
      }).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      order.push("parent-after-yield");

      const callbackValue = yield* Effect.callback<number>((resume) => {
        const dispatcher = runtime.scheduler.makeDispatcher();
        dispatcher.scheduleTask(() => resume(Effect.succeed(42)), 0);
        dispatcher.flush();
      });

      const slept = yield* Effect.gen(function*() {
        yield* Effect.sleep(250);
        return "clock-released" as const;
      }).pipe(Effect.forkChild);
      yield* TestClock.adjust(249);
      const before = slept.pollUnsafe();
      yield* TestClock.adjust(1);
      const after = yield* Fiber.join(slept);
      yield* Fiber.join(child);
      return { callbackValue, before, after };
    }));

    expect(result.callbackValue).toBe(42);
    expect(result.before).toBeUndefined();
    expect(result.after).toBe("clock-released");
    expect(order).toContain("child-after-yield");
    expect(order).toContain("parent-after-yield");
    expect(runtime.scheduler.snapshot().length).toBeGreaterThan(0);
    await runtime.dispose();
  });

  test("interrupts children, runs finalizers, and isolates runtime disposal", async () => {
    const left = createSimulationRuntime({
      applicationVersion: "qualification",
      scenario: "scheduler-finalization-left",
      rootSeed: 7,
    });
    const right = createSimulationRuntime({
      applicationVersion: "qualification",
      scenario: "scheduler-finalization-right",
      rootSeed: 8,
    });
    const finalized: string[] = [];

    const interruptEvidence = await left.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.acquireRelease(
        Effect.sync(() => finalized.push("child-acquired")),
        () => Effect.sync(() => finalized.push("child-finalized")),
      ).pipe(Effect.andThen(Effect.never), Effect.scoped, Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      return fiber.pollUnsafe();
    }));
    expect(interruptEvidence?._tag).toBe("Failure");
    expect(finalized).toEqual(["child-acquired", "child-finalized"]);

    let rightFinalized = false;
    const cancelRight = right.runCallback(Effect.acquireRelease(
      Effect.void,
      () => Effect.sync(() => { rightFinalized = true; }),
    ).pipe(Effect.andThen(Effect.never), Effect.scoped));
    await right.runPromise(Effect.yieldNow);
    await left.dispose();
    expect(rightFinalized).toBe(false);
    await right.dispose();
    expect(rightFinalized).toBe(true);
    cancelRight();
  });
});
