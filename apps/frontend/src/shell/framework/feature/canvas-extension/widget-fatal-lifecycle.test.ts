import { describe, expect, test } from "bun:test";
import type { IWidgetBrowserMount } from "@omnidraw/sdk";

import { retireFatalWidgetMount } from "./widget-fatal-lifecycle";

function mount(dispose: (reason?: string) => Promise<void>): IWidgetBrowserMount {
  return { dispose } as IWidgetBrowserMount;
}

describe("retireFatalWidgetMount", () => {
  test("keeps the current mount fatal-owned after a replacement failure", async () => {
    const order: string[] = [];
    let resolveDisposal!: () => void;
    const disposal = new Promise<void>((resolve) => { resolveDisposal = resolve; });
    const error = Object.freeze({ code: "GUEST_EXCEPTION" });
    let disposeCount = 0;
    const current = mount(async (reason) => {
      disposeCount += 1;
      order.push(`dispose:${reason}`);
      await disposal;
    });
    const failedCandidate = mount(async (reason) => { order.push(`candidate-dispose:${reason}`); });
    let installed: IWidgetBrowserMount | undefined = current;

    // A failed replacement never transfers installed-mount ownership.
    await failedCandidate.dispose("replacement-failed");
    expect(installed).toBe(current);
    expect(order).toEqual(["candidate-dispose:replacement-failed"]);
    order.length = 0;
    const retirement = retireFatalWidgetMount({
      canRenderFailure: () => installed === undefined,
      detach: () => order.push("detach"),
      error,
      failedMount: current,
      isCurrent: () => installed === current,
      renderFailure: (value) => {
        expect(value).toBe(error);
        order.push("failure");
      },
      retire: () => {
        installed = undefined;
        order.push("retire");
      },
    });

    expect(installed).toBeUndefined();
    expect(order).toEqual(["retire", "detach", "dispose:fatal-runtime"]);
    expect(await retireFatalWidgetMount({
      canRenderFailure: () => installed === undefined,
      detach: () => order.push("duplicate-detach"),
      error,
      failedMount: current,
      isCurrent: () => installed === current,
      renderFailure: () => order.push("duplicate-failure"),
      retire: () => order.push("duplicate-retire"),
    })).toBe(false);
    expect(disposeCount).toBe(1);
    resolveDisposal();
    expect(await retirement).toBe(true);
    expect(order).toEqual(["retire", "detach", "dispose:fatal-runtime", "failure"]);
  });

  test("ignores a fatal from the old mount after replacement commits", async () => {
    const actions: string[] = [];
    const old = mount(async () => { actions.push("dispose-old"); });
    const replacement = mount(async () => { actions.push("dispose-replacement"); });
    const installed: IWidgetBrowserMount | undefined = replacement;
    expect(await retireFatalWidgetMount({
      canRenderFailure: () => false,
      detach: () => actions.push("detach"),
      error: { code: "STALE" },
      failedMount: old,
      isCurrent: () => installed === old,
      renderFailure: () => actions.push("failure"),
      retire: () => actions.push("retire"),
    })).toBe(false);
    expect(actions).toEqual([]);
  });
});
