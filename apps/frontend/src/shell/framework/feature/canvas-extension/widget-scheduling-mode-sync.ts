import type { IWidgetBrowserMount } from "@omnidraw/sdk";

export type TWidgetSchedulingMode = "active" | "throttled";

type TSchedulingModeSink = Pick<IWidgetBrowserMount, "setSchedulingMode">;

/** Serializes Capsule scheduling changes and coalesces superseded visibility states. */
export function createWidgetSchedulingModeSync(
  initial: TWidgetSchedulingMode,
): Readonly<{
  attach(sink: TSchedulingModeSink): void;
  detach(sink: TSchedulingModeSink): void;
  update(mode: TWidgetSchedulingMode): void;
  disconnect(): void;
}> {
  let sink: TSchedulingModeSink | null = null;
  let desired = initial;
  let applied: TWidgetSchedulingMode | null = null;
  let running = false;
  let disposed = false;

  const drain = (): void => {
    if (disposed || running || sink === null || desired === applied) return;
    running = true;
    void (async () => {
      while (!disposed && sink !== null && desired !== applied) {
        const target: TSchedulingModeSink = sink;
        const mode = desired;
        try {
          await target.setSchedulingMode(mode);
        } catch {
          // Runtime lifecycle/fatal handling owns failures; scheduling stays advisory.
        }
        if (sink !== target) continue;
        applied = mode;
      }
    })().finally(() => {
      running = false;
      drain();
    });
  };

  return Object.freeze({
    attach(nextSink) {
      if (disposed) return;
      sink = nextSink;
      applied = null;
      drain();
    },
    detach(retiredSink) {
      if (sink !== retiredSink) return;
      sink = null;
      applied = null;
    },
    update(mode) {
      if (disposed || desired === mode) return;
      desired = mode;
      drain();
    },
    disconnect() {
      disposed = true;
      sink = null;
      applied = null;
    },
  });
}
