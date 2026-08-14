import { describe, expect, test, vi } from "vitest";
import { Effect } from "effect";
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
    bootEffect: vi.fn(() => Effect.tryPromise({
      try: () => bootPromise,
      catch: (cause) => cause,
    })),
    shutdownEffect: vi.fn(() => Effect.void),
  };
}

function recoveryWait() {
  const gate = deferred();
  const cancel = vi.fn(() => gate.resolve());
  return { handle: { promise: gate.promise, cancel }, resolve: gate.resolve, cancel };
}

describe("CanvasRuntimeLifecycle", () => {
  test("shuts down the previous runtime before starting its replacement", async () => {
    const events: string[] = [];
    const runtimes = new Map<string, TManagedCanvasRuntime>();
    const lifecycle = new CanvasRuntimeLifecycle<string>({
      createRuntime: (source) => {
        const instance = {
          bootEffect: vi.fn(() => Effect.sync(() => {
            events.push(`boot:${source}`);
          })),
          shutdownEffect: vi.fn(() => Effect.sync(() => {
            events.push(`shutdown:${source}`);
          })),
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
    first.bootEffect.mockImplementation(() => Effect.tryPromise({
      try: () => {
      firstBootStarted.resolve();
      return firstBoot.promise;
      },
      catch: (cause) => cause,
    }));
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
    expect(first.shutdownEffect).toHaveBeenCalledTimes(1);
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

    expect(onBootError).toHaveBeenCalledWith(failure, "failed");
    expect(failed.shutdownEffect).toHaveBeenCalledTimes(1);
    expect(lifecycle.activeRuntime).toBeNull();
  });

  test("retries a transient initial boot only after the host accepts a newer connection generation", async () => {
    const failure = new Error("SocketCloseError: 1006");
    const first = runtime("first", Promise.reject(failure));
    const second = runtime("second");
    const recovery = recoveryWait();
    const onBootError = vi.fn();
    const onBootSuccess = vi.fn();
    const onBootRecoveryWait = vi.fn();
    let attempts = 0;
    const lifecycle = new CanvasRuntimeLifecycle<string>({
      createRuntime: () => attempts++ === 0 ? first : second,
      recoverBoot: (error) => error === failure ? recovery.handle : null,
      onBootRecoveryWait,
      onBootError,
      onBootSuccess,
    });

    const replacement = lifecycle.replace("canvas-a");
    await vi.waitFor(() => expect(onBootRecoveryWait).toHaveBeenCalledWith(failure, "canvas-a"));
    expect(attempts).toBe(1);
    expect(first.shutdownEffect).toHaveBeenCalledTimes(1);
    expect(onBootError).not.toHaveBeenCalled();

    recovery.resolve();
    await replacement;

    expect(attempts).toBe(2);
    expect(second.bootEffect).toHaveBeenCalledTimes(1);
    expect(onBootSuccess).toHaveBeenCalledTimes(1);
    expect(lifecycle.activeRuntime).toBe(second);
  });

  test("a source replacement cancels pending boot recovery and cannot boot a stale retry", async () => {
    const failed = runtime("failed", Promise.reject(new Error("transport closed")));
    const current = runtime("current");
    const recovery = recoveryWait();
    const created: string[] = [];
    const lifecycle = new CanvasRuntimeLifecycle<string>({
      createRuntime: (source) => {
        created.push(source);
        return source === "old" ? failed : current;
      },
      recoverBoot: () => recovery.handle,
    });

    const old = lifecycle.replace("old");
    await vi.waitFor(() => expect(failed.shutdownEffect).toHaveBeenCalledTimes(1));
    const next = lifecycle.replace("new");
    await Promise.all([old, next]);

    expect(recovery.cancel).toHaveBeenCalled();
    expect(created).toEqual(["old", "new"]);
    expect(current.bootEffect).toHaveBeenCalledTimes(1);
    expect(lifecycle.activeRuntime).toBe(current);
  });

  test("shutdown cancels a pending boot-generation wait without creating another runtime", async () => {
    const failed = runtime("failed", Promise.reject(new Error("transport closed")));
    const recovery = recoveryWait();
    const createRuntime = vi.fn(() => failed);
    const lifecycle = new CanvasRuntimeLifecycle<string>({
      createRuntime,
      recoverBoot: () => recovery.handle,
    });

    const replacement = lifecycle.replace("canvas-a");
    await vi.waitFor(() => expect(failed.shutdownEffect).toHaveBeenCalledTimes(1));
    await Promise.all([replacement, lifecycle.dispose()]);

    expect(recovery.cancel).toHaveBeenCalled();
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(lifecycle.activeRuntime).toBeNull();
  });

  test("reports a synchronous runtime-construction failure", async () => {
    const failure = new Error("runtime composition unavailable");
    const onBootError = vi.fn();
    const lifecycle = new CanvasRuntimeLifecycle<string>({
      createRuntime: () => {
        throw failure;
      },
      onBootError,
    });

    await lifecycle.replace("failed");

    expect(onBootError).toHaveBeenCalledWith(failure, "failed");
    expect(lifecycle.activeRuntime).toBeNull();
  });

  test("reports successful boot only after the runtime is current", async () => {
    const onBootSuccess = vi.fn();
    const lifecycle = new CanvasRuntimeLifecycle<string>({
      createRuntime: (source) => runtime(source),
      onBootSuccess,
    });

    await lifecycle.replace("ready");

    expect(onBootSuccess).toHaveBeenCalledWith("ready");
  });

  test("dispose is idempotent and rejects future runtime starts", async () => {
    const active = runtime("active");
    const createRuntime = vi.fn(() => active);
    const lifecycle = new CanvasRuntimeLifecycle<string>({ createRuntime });
    await lifecycle.replace("active");

    await Promise.all([lifecycle.dispose(), lifecycle.dispose()]);
    await lifecycle.replace("late");

    expect(active.shutdownEffect).toHaveBeenCalledTimes(1);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(lifecycle.activeRuntime).toBeNull();
  });

  test("disposal invalidates a pending boot and resolves after its cleanup", async () => {
    const boot = deferred();
    const bootStarted = deferred();
    const shutdown = deferred();
    const active = runtime("active");
    active.bootEffect.mockImplementation(() => Effect.tryPromise({
      try: () => {
        bootStarted.resolve();
        return boot.promise;
      },
      catch: (cause) => cause,
    }));
    active.shutdownEffect.mockImplementation(() => Effect.tryPromise({
      try: () => shutdown.promise,
      catch: (cause) => cause,
    }));
    const onBootSuccess = vi.fn();
    const onBootError = vi.fn();
    const lifecycle = new CanvasRuntimeLifecycle<string>({
      createRuntime: () => active,
      onBootSuccess,
      onBootError,
    });

    const replacement = lifecycle.replace("active");
    await bootStarted.promise;
    let disposeSettled = false;
    const disposal = lifecycle.dispose().finally(() => {
      disposeSettled = true;
    });
    boot.resolve();
    await vi.waitFor(() => expect(active.shutdownEffect).toHaveBeenCalledTimes(1));

    expect(disposeSettled).toBe(false);
    shutdown.resolve();
    await Promise.all([replacement, disposal]);
    expect(onBootSuccess).not.toHaveBeenCalled();
    expect(onBootError).not.toHaveBeenCalled();
    expect(active.shutdownEffect).toHaveBeenCalledTimes(1);
    expect(lifecycle.activeRuntime).toBeNull();
  });

  test("isolates shutdown failures and continues replacement", async () => {
    const first = runtime("first");
    first.shutdownEffect.mockReturnValueOnce(Effect.fail(new Error("cleanup failed")));
    const second = runtime("second");
    const onShutdownError = vi.fn();
    const lifecycle = new CanvasRuntimeLifecycle<string>({
      createRuntime: (source) => source === "first" ? first : second,
      onShutdownError,
    });

    await lifecycle.replace("first");
    await lifecycle.replace("second");

    expect(onShutdownError).toHaveBeenCalledTimes(1);
    expect(second.bootEffect).toHaveBeenCalledTimes(1);
    expect(lifecycle.activeRuntime).toBe(second);
  });
});
