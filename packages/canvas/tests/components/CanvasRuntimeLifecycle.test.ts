import { describe, expect, test, vi } from "vitest";
import {
  CanvasRuntimeLifecycle,
  type TManagedCanvasRuntime,
} from "../../src/components/CanvasRuntimeLifecycle";

type TDeferred = {
  promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
};

function deferred(): TDeferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function runtime(name: string, bootPromise: Promise<void> = Promise.resolve()) {
  return {
    name,
    boot: vi.fn(() => bootPromise),
    shutdown: vi.fn(async () => undefined),
  };
}

describe("CanvasRuntimeLifecycle", () => {
  test("shuts down the previous runtime before starting its replacement", async () => {
    const events: string[] = [];
    const runtimes = new Map<string, TManagedCanvasRuntime>();
    const lifecycle = new CanvasRuntimeLifecycle<string>({
      createRuntime: (source) => {
        const instance = {
          boot: vi.fn(async () => {
            events.push(`boot:${source}`);
          }),
          shutdown: vi.fn(async () => {
            events.push(`shutdown:${source}`);
          }),
        };
        runtimes.set(source, instance);
        return instance;
      },
    });

    await lifecycle.replace("a");
    await lifecycle.replace("b");

    expect(events).toEqual(["boot:a", "shutdown:a", "boot:b"]);
    expect(lifecycle.activeRuntime).toBe(runtimes.get("b"));
  });

  test("coalesces queued sources and never boots stale work", async () => {
    const firstBoot = deferred();
    const firstBootStarted = deferred();
    const created: string[] = [];
    const first = runtime("a");
    first.boot.mockImplementation(() => {
      firstBootStarted.resolve();
      return firstBoot.promise;
    });
    const lifecycle = new CanvasRuntimeLifecycle<string>({
      createRuntime: (source) => {
        created.push(source);
        return source === "a" ? first : runtime(source);
      },
    });

    const firstReplacement = lifecycle.replace("a");
    await firstBootStarted.promise;
    const secondReplacement = lifecycle.replace("b");
    const thirdReplacement = lifecycle.replace("c");
    firstBoot.resolve();

    await Promise.all([
      firstReplacement,
      secondReplacement,
      thirdReplacement,
    ]);

    expect(created).toEqual(["a", "c"]);
    expect(first.shutdown).toHaveBeenCalledTimes(1);
  });

  test("reports a current boot failure and tears its runtime down", async () => {
    const failure = new Error("backend unavailable");
    const failed = runtime("failed", Promise.reject(failure));
    const onBootError = vi.fn();
    const lifecycle = new CanvasRuntimeLifecycle<string>({
      createRuntime: () => failed,
      onBootError,
    });

    await lifecycle.replace("failed");

    expect(onBootError).toHaveBeenCalledWith(failure);
    expect(failed.shutdown).toHaveBeenCalledTimes(1);
    expect(lifecycle.activeRuntime).toBeNull();
  });

  test("dispose is idempotent and rejects future runtime starts", async () => {
    const active = runtime("active");
    const createRuntime = vi.fn(() => active);
    const lifecycle = new CanvasRuntimeLifecycle<string>({ createRuntime });
    await lifecycle.replace("active");

    await Promise.all([lifecycle.dispose(), lifecycle.dispose()]);
    await lifecycle.replace("late");

    expect(active.shutdown).toHaveBeenCalledTimes(1);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(lifecycle.activeRuntime).toBeNull();
  });

  test("isolates shutdown failures and continues replacement", async () => {
    const first = runtime("first");
    first.shutdown.mockRejectedValueOnce(new Error("cleanup failed"));
    const second = runtime("second");
    const onShutdownError = vi.fn();
    const lifecycle = new CanvasRuntimeLifecycle<string>({
      createRuntime: (source) => source === "first" ? first : second,
      onShutdownError,
    });

    await lifecycle.replace("first");
    await lifecycle.replace("second");

    expect(onShutdownError).toHaveBeenCalledTimes(1);
    expect(second.boot).toHaveBeenCalledTimes(1);
    expect(lifecycle.activeRuntime).toBe(second);
  });
});
