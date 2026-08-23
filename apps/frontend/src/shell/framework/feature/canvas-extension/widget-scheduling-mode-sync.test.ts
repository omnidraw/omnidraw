import { describe, expect, test } from "bun:test";

import { createWidgetSchedulingModeSync } from "./widget-scheduling-mode-sync";

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createWidgetSchedulingModeSync", () => {
  test("serializes transitions and coalesces superseded visibility", async () => {
    const calls: string[] = [];
    const releases: (() => void)[] = [];
    const sink = {
      setSchedulingMode(mode: "active" | "throttled") {
        calls.push(mode);
        return new Promise<void>((resolve) => releases.push(resolve));
      },
    };
    const sync = createWidgetSchedulingModeSync("active");
    sync.attach(sink);
    await tick();
    expect(calls).toEqual(["active"]);

    sync.update("throttled");
    sync.update("active");
    sync.update("throttled");
    expect(calls).toEqual(["active"]);
    releases.shift()?.();
    await tick();
    expect(calls).toEqual(["active", "throttled"]);

    releases.shift()?.();
    await tick();
    sync.update("active");
    await tick();
    expect(calls).toEqual(["active", "throttled", "active"]);
    releases.shift()?.();
    sync.disconnect();
  });

  test("does not overlap replacement mount transitions", async () => {
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const first = {
      setSchedulingMode(mode: "active" | "throttled") {
        calls.push(`first:${mode}`);
        return new Promise<void>((resolve) => { releaseFirst = resolve; });
      },
    };
    const second = {
      async setSchedulingMode(mode: "active" | "throttled") {
        calls.push(`second:${mode}`);
      },
    };
    const sync = createWidgetSchedulingModeSync("throttled");
    sync.attach(first);
    await tick();
    sync.attach(second);
    expect(calls).toEqual(["first:throttled"]);
    releaseFirst();
    await tick();
    expect(calls).toEqual(["first:throttled", "second:throttled"]);
    sync.disconnect();
  });
});
