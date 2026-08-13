import type { IWidgetBrowserMount } from "@omnidraw/sdk";
import { describe, expect, it, vi } from "vitest";
import { mountWidgetTarget } from "../../../src/shell/framework/feature/widget-runtime/mount-target";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

function fakeMount(ready: Promise<void>) {
  const dispose = vi.fn(async () => undefined);
  const mount: IWidgetBrowserMount = {
    ready: () => ready,
    setProps: vi.fn(),
    setTheme: vi.fn(),
    setViewport: vi.fn(),
    focus: vi.fn(),
    setSchedulingMode: vi.fn(async () => undefined),
    freeze: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    snapshot: vi.fn(async () => new Uint8Array()),
    diagnostics: vi.fn(() => ({
      artifactHash: `sha256:${"a".repeat(64)}`,
      generation: 1,
      instanceId: "instance-1",
      state: "running",
    })),
    dispose,
  };
  return { dispose, mount };
}

describe("widget runtime mount targets", () => {
  it("uses a fresh Capsule-owned target for a ready replacement", async () => {
    const container = document.createElement("div");
    const firstRaw = fakeMount(Promise.resolve());
    let firstTarget: HTMLElement | undefined;
    const first = await mountWidgetTarget({
      container,
      async mount(target) {
        firstTarget = target;
        target.attachShadow({ mode: "closed" });
        return firstRaw.mount;
      },
    });
    await first.ready();

    const secondReady = deferred<void>();
    const secondRaw = fakeMount(secondReady.promise);
    let secondTarget: HTMLElement | undefined;
    const second = await mountWidgetTarget({
      container,
      async mount(target) {
        secondTarget = target;
        target.attachShadow({ mode: "closed" });
        return secondRaw.mount;
      },
    });

    expect(secondTarget).not.toBe(firstTarget);
    expect(container.childElementCount).toBe(2);
    expect(secondTarget?.style.visibility).toBe("hidden");
    secondReady.resolve();
    await second.ready();
    expect(secondTarget?.style.visibility).toBe("visible");
    await first.dispose("replaced");
    expect(firstRaw.dispose).toHaveBeenCalledWith("replaced");
    expect(container.contains(firstTarget!)).toBe(false);
    expect(container.contains(secondTarget!)).toBe(true);
  });

  it("removes a rejected candidate without disturbing the last-good view", async () => {
    const container = document.createElement("div");
    const lastGoodRaw = fakeMount(Promise.resolve());
    const lastGood = await mountWidgetTarget({
      container,
      mount: async () => lastGoodRaw.mount,
    });
    await lastGood.ready();
    const lastGoodTarget = container.firstElementChild;

    const candidateReady = deferred<void>();
    const candidateRaw = fakeMount(candidateReady.promise);
    const candidate = await mountWidgetTarget({
      container,
      mount: async () => candidateRaw.mount,
    });
    candidateReady.reject(new Error("candidate failed"));

    await expect(candidate.ready()).rejects.toThrow("candidate failed");
    expect(candidateRaw.dispose).toHaveBeenCalledWith("replacement-failed");
    expect(lastGoodRaw.dispose).not.toHaveBeenCalled();
    expect(container.childElementCount).toBe(1);
    expect(container.firstElementChild).toBe(lastGoodTarget);
    expect(lastGoodTarget?.getAttribute("aria-hidden")).toBeNull();
    expect((lastGoodTarget as HTMLElement).style.visibility).toBe("visible");
  });
});
