import { describe, expect, test, vi } from "vitest";
import { Effect } from "effect";
import { PrivateRpcError } from "./private-rpc-error";
import type { TBackendCanvas } from "./backend.types";
import {
  StartupApplicationState,
  StartupCanvasCatalog,
  StartupFence,
  StartupNavigation,
  StartupNotifications,
  txStartupCanvas,
} from "./startup-canvas";

const canvas = (id: string): TBackendCanvas => ({
  id,
  name: `Canvas ${id}`,
  revision: 0,
  createdAtSec: "2026-01-01 00:00:00",
  updatedAtSec: "2026-01-01 00:00:00",
});

function run(options: Readonly<{
  listed?: readonly TBackendCanvas[];
  failure?: PrivateRpcError;
  pathname?: string;
}> = {}) {
  const created = canvas("created");
  const calls = {
    create: vi.fn(),
    navigate: vi.fn(),
    notify: vi.fn(),
    setCanvases: vi.fn(),
  };
  const program = txStartupCanvas({ pathname: options.pathname ?? "/", requestId: 1 }).pipe(
    Effect.provideService(StartupCanvasCatalog, StartupCanvasCatalog.of({
      list: () => options.failure === undefined
        ? Effect.succeed(options.listed ?? [])
        : Effect.fail(options.failure),
      create: (name) => Effect.sync(() => { calls.create(name); return created; }),
    })),
    Effect.provideService(StartupApplicationState, StartupApplicationState.of({
      setCanvases: (canvases) => Effect.sync(() => { calls.setCanvases(canvases); }),
    })),
    Effect.provideService(StartupNavigation, StartupNavigation.of({
      navigate: (path) => Effect.sync(() => { calls.navigate(path); }),
    })),
    Effect.provideService(StartupNotifications, StartupNotifications.of({
      showError: (message) => Effect.sync(() => { calls.notify(message); }),
    })),
    Effect.provideService(StartupFence, StartupFence.of({
      current: () => Effect.succeed(true),
    })),
  );
  return { calls, created, program };
}

describe("startup canvas transaction", () => {
  test("stores existing canvases without creating or navigating", async () => {
    const existing = canvas("existing");
    const harness = run({ listed: [existing] });
    await Effect.runPromise(harness.program);
    expect(harness.calls.setCanvases).toHaveBeenCalledWith([existing]);
    expect(harness.calls.create).not.toHaveBeenCalled();
    expect(harness.calls.navigate).not.toHaveBeenCalled();
  });

  test("creates, stores, and selects the first canvas", async () => {
    const harness = run();
    await Effect.runPromise(harness.program);
    expect(harness.calls.create).toHaveBeenCalledWith("Untitled Canvas");
    expect(harness.calls.setCanvases).toHaveBeenCalledWith([harness.created]);
    expect(harness.calls.navigate).toHaveBeenCalledWith("/c/created");
  });

  test("does not create or redirect while a direct Canvas snapshot resolves", async () => {
    const harness = run({ pathname: "/c/deep-link" });
    await Effect.runPromise(harness.program);
    expect(harness.calls.setCanvases).toHaveBeenCalledWith([]);
    expect(harness.calls.create).not.toHaveBeenCalled();
    expect(harness.calls.navigate).not.toHaveBeenCalled();
  });

  test("preserves typed list failures and reports them", async () => {
    const failure = new PrivateRpcError({
      code: "UNAVAILABLE",
      status: 503,
      message: "list failed",
      details: null,
    });
    const harness = run({ failure });
    await expect(Effect.runPromise(harness.program)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(harness.calls.notify).toHaveBeenCalledWith("list failed");
  });
});
