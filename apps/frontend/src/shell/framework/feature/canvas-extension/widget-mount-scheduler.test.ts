import { describe, expect, test } from "bun:test";

import {
  createWidgetMountScheduler,
  type TWidgetSchedulingState,
} from "./widget-mount-scheduler";

const visible = (priority: TWidgetSchedulingState["priority"] = 1): TWidgetSchedulingState => Object.freeze({
  eligible: true,
  visible: true,
  priority,
  distance: 0,
  occlusion: 0,
});
const offscreen: TWidgetSchedulingState = Object.freeze({
  eligible: false,
  visible: false,
  priority: 0,
  distance: 500,
  occlusion: 1,
});

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createWidgetMountScheduler", () => {
  test("coalesces cold admissions, starts visible work in stable order, and bounds concurrency", async () => {
    const drains: (() => void)[] = [];
    const scheduler = createWidgetMountScheduler({
      concurrency: 3,
      scheduleDrain: (drain) => drains.push(drain),
    });
    const starts: string[] = [];
    const releases: (() => void)[] = [];
    const add = (id: string, orderKey: string, scheduling: TWidgetSchedulingState) => {
      const controller = new AbortController();
      return scheduler.enqueue({
        node: { id, orderKey },
        scheduling,
        signal: controller.signal,
        run: () => new Promise<void>((resolve) => {
          starts.push(id);
          releases.push(resolve);
        }),
      });
    };

    const deferred = add("deferred", "0", offscreen);
    const low = add("low", "B", visible(1));
    const tiedB = add("tied-b", "A", visible(3));
    const tiedA = add("tied-a", "A", visible(3));
    add("fourth", "C", visible(2));

    expect(starts).toEqual([]);
    expect(drains).toHaveLength(1);
    drains.shift()?.();
    expect(starts).toEqual(["tied-a", "tied-b", "fourth"]);
    expect(scheduler.diagnostics()).toMatchObject({ active: 3, queued: 1, deferred: 1, peakActive: 3 });

    releases.shift()?.();
    await tick();
    drains.shift()?.();
    expect(starts).toEqual(["tied-a", "tied-b", "fourth", "low"]);

    deferred.updateScheduling(visible(4));
    releases.shift()?.();
    await tick();
    drains.shift()?.();
    expect(starts.at(-1)).toBe("deferred");

    for (const release of releases) release();
    await Promise.all([deferred.result, low.result, tiedA.result, tiedB.result]);
    await scheduler.dispose();
  });

  test("removes cancelled deferred work without running it", async () => {
    const scheduler = createWidgetMountScheduler();
    const controller = new AbortController();
    let ran = false;
    const admission = scheduler.enqueue({
      node: { id: "cold", orderKey: "A" },
      scheduling: offscreen,
      signal: controller.signal,
      run: () => { ran = true; },
    });

    controller.abort("retired");
    expect(await admission.result).toBe(false);
    expect(ran).toBe(false);
    expect(scheduler.diagnostics()).toMatchObject({ deferred: 0, cancelled: 1 });
    await scheduler.dispose();
  });

  test("preempts stale active work and restarts it only after eligibility returns", async () => {
    const scheduler = createWidgetMountScheduler({ concurrency: 1 });
    let starts = 0;
    const admission = scheduler.enqueue({
      node: { id: "moving", orderKey: "A" },
      scheduling: visible(),
      signal: new AbortController().signal,
      run: (signal) => {
        starts += 1;
        if (starts > 1) return;
        return new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    });
    await tick();
    expect(starts).toBe(1);

    admission.updateScheduling(offscreen);
    await tick();
    expect(scheduler.diagnostics()).toMatchObject({ active: 0, deferred: 1 });
    admission.updateScheduling(visible(4));
    await tick();

    expect(await admission.result).toBe(true);
    expect(starts).toBe(2);
    await scheduler.dispose();
  });

  test("waits for active work during disposal and starts no queued replacement", async () => {
    const scheduler = createWidgetMountScheduler({ concurrency: 1 });
    let release!: () => void;
    const first = scheduler.enqueue({
      node: { id: "first", orderKey: "A" },
      scheduling: visible(),
      signal: new AbortController().signal,
      run: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    const second = scheduler.enqueue({
      node: { id: "second", orderKey: "B" },
      scheduling: visible(),
      signal: new AbortController().signal,
      run: () => undefined,
    });
    await tick();

    let disposed = false;
    const disposal = scheduler.dispose().then(() => { disposed = true; });
    expect(await second.result).toBe(false);
    expect(disposed).toBe(false);
    release();
    await disposal;
    expect(await first.result).toBe(false);
    expect(scheduler.diagnostics().started).toBe(1);
  });
});
