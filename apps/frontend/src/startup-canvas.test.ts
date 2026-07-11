import { describe, expect, test, vi } from "vitest";
import type { TBackendCanvas } from "./types/backend.types";
import { createStartupCanvasBootstrap } from "./startup-canvas";

const canvas = (id: string): TBackendCanvas => ({
  id,
  name: `Canvas ${id}`,
  automerge_url: `automerge:${id}`,
  created_at: "2026-01-01 00:00:00",
});

function createHarness(options?: {
  listed?: TBackendCanvas[];
  listError?: Error;
  createError?: Error;
}) {
  const created = canvas("created");
  const listCanvases = vi.fn(async () => [options?.listError ?? null, options?.listError ? undefined : options?.listed ?? []] as const);
  const createCanvas = vi.fn(async () => [options?.createError ?? null, options?.createError ? undefined : created] as const);
  const setCanvases = vi.fn();
  const navigate = vi.fn();
  const onError = vi.fn();
  const bootstrap = createStartupCanvasBootstrap({ listCanvases, createCanvas, setCanvases, navigate, onError });

  return { bootstrap, createCanvas, listCanvases, navigate, onError, setCanvases, created };
}

describe("startup canvas bootstrap", () => {
  test("stores existing canvases without creating or navigating", async () => {
    const existing = canvas("existing");
    const harness = createHarness({ listed: [existing] });

    await harness.bootstrap({ pathname: "/" });

    expect(harness.setCanvases).toHaveBeenCalledWith([existing]);
    expect(harness.createCanvas).not.toHaveBeenCalled();
    expect(harness.navigate).not.toHaveBeenCalled();
  });

  test("creates, stores, and selects a canvas when the list is empty", async () => {
    const harness = createHarness();

    await harness.bootstrap({ pathname: "/" });

    expect(harness.createCanvas).toHaveBeenCalledWith("Untitled Canvas");
    expect(harness.setCanvases).toHaveBeenCalledWith([harness.created]);
    expect(harness.navigate).toHaveBeenCalledWith("/c/created");
  });

  test("reports list and create failures and permits a retry", async () => {
    const listFailure = createHarness({ listError: new Error("list failed") });
    await expect(listFailure.bootstrap({ pathname: "/" })).rejects.toThrow("list failed");
    await expect(listFailure.bootstrap({ pathname: "/" })).rejects.toThrow("list failed");
    expect(listFailure.listCanvases).toHaveBeenCalledTimes(2);
    expect(listFailure.onError).toHaveBeenCalledWith("list failed");

    const createFailure = createHarness({ createError: new Error("create failed") });
    await expect(createFailure.bootstrap({ pathname: "/" })).rejects.toThrow("create failed");
    expect(createFailure.onError).toHaveBeenCalledWith("create failed");
    expect(createFailure.setCanvases).not.toHaveBeenCalled();
  });

  test("deduplicates concurrent and repeated successful startup", async () => {
    const harness = createHarness();

    await Promise.all([
      harness.bootstrap({ pathname: "/" }),
      harness.bootstrap({ pathname: "/" }),
    ]);
    await harness.bootstrap({ pathname: "/" });

    expect(harness.listCanvases).toHaveBeenCalledTimes(1);
    expect(harness.createCanvas).toHaveBeenCalledTimes(1);
  });

  test("preserves a valid deep link", async () => {
    const linked = canvas("linked");
    const harness = createHarness({ listed: [linked] });

    await harness.bootstrap({ pathname: "/c/linked" });

    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.setCanvases).toHaveBeenCalledWith([linked]);
  });
});
