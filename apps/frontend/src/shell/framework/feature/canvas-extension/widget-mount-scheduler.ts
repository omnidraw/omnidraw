import type { TCanvasWidgetSchedulingState } from "@omnidraw/canvas";

export type TWidgetSchedulingState = TCanvasWidgetSchedulingState;

export type TWidgetMountSchedulerDiagnostics = Readonly<{
  concurrency: number;
  active: number;
  queued: number;
  deferred: number;
  peakActive: number;
  started: number;
  completed: number;
  cancelled: number;
  firstStartedAtMs: number | null;
  lastStartedAtMs: number | null;
  firstCompletedAtMs: number | null;
  lastCompletedAtMs: number | null;
  recentStarts: readonly string[];
}>;

type TQueuedMount = {
  readonly nodeId: string;
  readonly signal: AbortSignal;
  readonly run: (signal: AbortSignal) => void | Promise<void>;
  readonly settle: (started: boolean) => void;
  readonly reject: (error: unknown) => void;
  readonly stopAbort: () => void;
  controller: AbortController | null;
  cancelled: boolean;
  restartAfterActive: boolean;
  orderKey: string;
  scheduling: TWidgetSchedulingState;
  phase: "queued" | "active" | "settled";
};

export type TWidgetMountAdmission = Readonly<{
  result: Promise<boolean>;
  updateNode(node: Readonly<{ id: string; orderKey: string }>): void;
  updateScheduling(state: TWidgetSchedulingState): void;
  cancel(): void;
}>;

const MAX_DIAGNOSTIC_COUNT = 1_000_000;
const MAX_RECENT_STARTS = 64;

function increment(value: number): number {
  return Math.min(MAX_DIAGNOSTIC_COUNT, value + 1);
}

function compareMounts(left: TQueuedMount, right: TQueuedMount): number {
  if (left.scheduling.priority !== right.scheduling.priority) {
    return right.scheduling.priority - left.scheduling.priority;
  }
  if (left.scheduling.visible !== right.scheduling.visible) {
    return left.scheduling.visible ? -1 : 1;
  }
  if (left.scheduling.distance !== right.scheduling.distance) {
    return left.scheduling.distance - right.scheduling.distance;
  }
  if (left.scheduling.occlusion !== right.scheduling.occlusion) {
    return left.scheduling.occlusion - right.scheduling.occlusion;
  }
  const order = left.orderKey.localeCompare(right.orderKey);
  return order === 0 ? left.nodeId.localeCompare(right.nodeId) : order;
}

/** One extension-owned, cancellation-aware queue for expensive cold widget starts. */
export function createWidgetMountScheduler(options: Readonly<{
  concurrency?: number;
  monotonicNow?(): number;
  scheduleDrain?(drain: () => void): void;
}> = {}): Readonly<{
  enqueue(args: Readonly<{
    node: Readonly<{ id: string; orderKey: string }>;
    scheduling: TWidgetSchedulingState;
    signal: AbortSignal;
    run(signal: AbortSignal): void | Promise<void>;
  }>): TWidgetMountAdmission;
  diagnostics(): TWidgetMountSchedulerDiagnostics;
  dispose(): Promise<void>;
}> {
  const concurrency = Math.max(1, Math.min(16, Math.floor(options.concurrency ?? 3)));
  const scheduleDrain = options.scheduleDrain ?? ((drain: () => void) => queueMicrotask(drain));
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const jobs = new Set<TQueuedMount>();
  const activeRuns = new Set<Promise<void>>();
  const recentStarts: string[] = [];
  let active = 0;
  let peakActive = 0;
  let started = 0;
  let completed = 0;
  let cancelled = 0;
  let drainPending = false;
  let disposed = false;
  let firstStartedAtMs: number | null = null;
  let lastStartedAtMs: number | null = null;
  let firstCompletedAtMs: number | null = null;
  let lastCompletedAtMs: number | null = null;

  const requestDrain = (): void => {
    if (disposed || drainPending) return;
    drainPending = true;
    scheduleDrain(() => {
      drainPending = false;
      drain();
    });
  };
  const cancel = (job: TQueuedMount): void => {
    if (job.phase === "settled" || job.cancelled) return;
    job.cancelled = true;
    cancelled = increment(cancelled);
    if (job.phase === "active") {
      job.restartAfterActive = false;
      job.controller?.abort(job.signal.reason ?? new DOMException("Widget startup was cancelled.", "AbortError"));
      return;
    }
    job.phase = "settled";
    jobs.delete(job);
    job.stopAbort();
    job.settle(false);
  };
  const start = (job: TQueuedMount): void => {
    job.phase = "active";
    job.restartAfterActive = false;
    job.controller = new AbortController();
    active += 1;
    peakActive = Math.max(peakActive, active);
    started = increment(started);
    const startedAt = monotonicNow();
    firstStartedAtMs ??= startedAt;
    lastStartedAtMs = startedAt;
    recentStarts.push(job.nodeId);
    if (recentStarts.length > MAX_RECENT_STARTS) recentStarts.shift();
    let run: Promise<void>;
    try {
      run = Promise.resolve(job.run(job.controller.signal));
    } catch (error) {
      run = Promise.reject(error);
    }
    activeRuns.add(run);
    void run.then(
      () => {
        if (!job.restartAfterActive && !job.cancelled) job.settle(true);
      },
      (error) => {
        if (!job.restartAfterActive && !job.cancelled) job.reject(error);
      },
    ).finally(() => {
      activeRuns.delete(run);
      job.controller = null;
      active -= 1;
      completed = increment(completed);
      const completedAt = monotonicNow();
      firstCompletedAtMs ??= completedAt;
      lastCompletedAtMs = completedAt;
      if (job.restartAfterActive && !job.cancelled && !disposed) {
        job.restartAfterActive = false;
        job.phase = "queued";
      } else {
        job.phase = "settled";
        jobs.delete(job);
        job.stopAbort();
        if (job.cancelled) job.settle(false);
      }
      requestDrain();
    });
  };
  const drain = (): void => {
    if (disposed) return;
    while (active < concurrency) {
      const next = [...jobs]
        .filter((job) => job.phase === "queued" && job.scheduling.eligible)
        .sort(compareMounts)[0];
      if (next === undefined) return;
      start(next);
    }
  };

  return Object.freeze({
    enqueue(args) {
      let resolve!: (started: boolean) => void;
      let reject!: (error: unknown) => void;
      const result = new Promise<boolean>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      let stopAbort = (): void => undefined;
      const job: TQueuedMount = {
        nodeId: args.node.id,
        signal: args.signal,
        orderKey: args.node.orderKey,
        scheduling: args.scheduling,
        run: args.run,
        settle: resolve,
        reject,
        stopAbort: () => stopAbort(),
        controller: null,
        cancelled: false,
        restartAfterActive: false,
        phase: "queued",
      };
      const onAbort = (): void => cancel(job);
      stopAbort = () => args.signal.removeEventListener("abort", onAbort);
      if (disposed || args.signal.aborted) {
        job.phase = "settled";
        cancelled = increment(cancelled);
        resolve(false);
      } else {
        jobs.add(job);
        args.signal.addEventListener("abort", onAbort, { once: true });
        requestDrain();
      }
      return Object.freeze({
        result,
        updateNode(node) {
          if (job.phase !== "queued" || node.id !== job.nodeId) return;
          job.orderKey = node.orderKey;
          requestDrain();
        },
        updateScheduling(state) {
          if (job.phase === "settled") return;
          job.scheduling = state;
          if (job.phase === "active" && !state.eligible && !job.cancelled) {
            job.restartAfterActive = true;
            job.controller?.abort(new DOMException("Widget startup left the eligible viewport.", "AbortError"));
          }
          requestDrain();
        },
        cancel: () => cancel(job),
      });
    },
    diagnostics() {
      let queued = 0;
      let deferred = 0;
      for (const job of jobs) {
        if (job.phase !== "queued") continue;
        if (job.scheduling.eligible) queued += 1;
        else deferred += 1;
      }
      return Object.freeze({
        concurrency,
        active,
        queued,
        deferred,
        peakActive,
        started,
        completed,
        cancelled,
        firstStartedAtMs,
        lastStartedAtMs,
        firstCompletedAtMs,
        lastCompletedAtMs,
        recentStarts: Object.freeze([...recentStarts]),
      });
    },
    async dispose() {
      if (!disposed) {
        disposed = true;
        for (const job of [...jobs]) cancel(job);
      }
      await Promise.allSettled([...activeRuns]);
    },
  });
}
