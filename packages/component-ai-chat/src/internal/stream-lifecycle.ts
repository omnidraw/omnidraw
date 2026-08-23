import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import type { TAiChatStreamEvent } from "../contracts.js";

type TAiChatStreamLifecycleArgs = Readonly<{
  open(signal: AbortSignal): AsyncIterable<TAiChatStreamEvent>;
  onEvent(event: TAiChatStreamEvent): void | Promise<void>;
  onError(error: unknown): void;
  onEnd(): void;
}>;

type TAiChatLatestActionArgs<A> = Readonly<{
  run(signal: AbortSignal): Promise<A>;
  onSuccess(value: A): void;
  onError(error: unknown): void;
  onFinally?(): void;
}>;

type TAiChatPollArgs<A> = Readonly<{
  intervalMs: number;
  run(signal: AbortSignal): Promise<A>;
  onValue(value: A): "continue" | "stop";
  onError(error: unknown): void;
}>;

type TAiChatPollProgramArgs<A> = Readonly<{
  intervalMs: number;
  run: Effect.Effect<A, unknown>;
  onValue(value: A): "continue" | "stop";
  onError(error: unknown): void;
}>;

/** Lazy polling policy shared by the mounted component and controlled-clock tests. */
export function fxPollAiChat<A>(
  args: TAiChatPollProgramArgs<A>,
): Effect.Effect<void> {
  const poll: Effect.Effect<void> = Effect.suspend(() => args.run.pipe(
    Effect.flatMap((value) => Effect.sync(() => args.onValue(value)).pipe(
      Effect.flatMap((decision) => decision === "stop"
        ? Effect.void
        : Effect.sleep(args.intervalMs).pipe(Effect.andThen(poll))),
    )),
    Effect.catch((error) => Effect.sync(() => args.onError(error))),
  ));
  return poll;
}

export type TAiChatStreamLifecycle = Readonly<{
  close(): void;
}>;

/** One component-owned Effect runtime; disposal interrupts every child fiber. */
export class AiChatEffectRuntime {
  readonly #runtime = ManagedRuntime.make(Layer.empty);
  readonly #latestTasks = new Map<string, () => void>();
  #disposed = false;
  #disposePromise: Promise<void> | null = null;

  /**
   * Runs one replaceable action per semantic key. Replacing or closing an
   * action interrupts its continuation, so a stale completion cannot mutate a
   * remounted session.
   */
  startLatest<A>(
    key: string,
    args: TAiChatLatestActionArgs<A>,
  ): TAiChatStreamLifecycle {
    if (this.#disposed) throw new Error("The AI Chat lifecycle runtime is disposed.");
    this.#latestTasks.get(key)?.();
    let active = true;
    let interrupt: () => void = () => undefined;
    const close = () => {
      if (!active) return;
      active = false;
      if (this.#latestTasks.get(key) === close) this.#latestTasks.delete(key);
      interrupt();
    };
    this.#latestTasks.set(key, close);
    const program = Effect.tryPromise({
      try: args.run,
      catch: (cause) => cause,
    }).pipe(
      Effect.tap((value) => Effect.sync(() => {
        if (active) args.onSuccess(value);
      })),
      Effect.catch((error) => Effect.sync(() => {
        if (active) args.onError(error);
      })),
      Effect.ensuring(Effect.sync(() => {
        const publishFinally = active;
        active = false;
        if (this.#latestTasks.get(key) === close) this.#latestTasks.delete(key);
        if (publishFinally) args.onFinally?.();
      })),
    );
    interrupt = this.#runtime.runCallback(program);
    return Object.freeze({ close });
  }

  /** Interrupts a semantic task without exposing Effect or Fiber types. */
  close(key: string): void {
    this.#latestTasks.get(key)?.();
  }

  /** Retires one component-owned feature scope, such as a Settings mount. */
  closeMatching(prefix: string): void {
    for (const [key, close] of [...this.#latestTasks]) {
      if (key.startsWith(prefix)) close();
    }
  }

  startStream(args: TAiChatStreamLifecycleArgs): TAiChatStreamLifecycle {
    if (this.#disposed) throw new Error("The AI Chat lifecycle runtime is disposed.");
    this.#latestTasks.get("stream")?.();
    let closed = false;
    let activeController: AbortController | null = null;
    let interrupt: () => void = () => undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      if (this.#latestTasks.get("stream") === close) this.#latestTasks.delete("stream");
      activeController?.abort();
      interrupt();
    };
    this.#latestTasks.set("stream", close);
    const quiet = (controller: AbortController) => closed || controller.signal.aborted;
    const program = Effect.acquireRelease(
      Effect.sync(() => {
        activeController = new AbortController();
        return activeController;
      }),
      (controller) => Effect.sync(() => {
        controller.abort();
        if (activeController === controller) activeController = null;
      }),
    ).pipe(
      Effect.flatMap((controller) => Stream.unwrap(Effect.try({
        try: () => Stream.fromAsyncIterable(args.open(controller.signal), (cause) => cause),
        catch: (cause) => cause,
      })).pipe(
        Stream.runForEach((event) => Effect.tryPromise({
          try: () => Promise.resolve(args.onEvent(event)),
          catch: (cause) => cause,
        })),
        Effect.tap(() => Effect.sync(() => {
          if (!quiet(controller)) args.onEnd();
        })),
        Effect.catch((error) => Effect.sync(() => {
          if (!quiet(controller)) args.onError(error);
        })),
      )),
      Effect.scoped,
      Effect.ensuring(Effect.sync(() => {
        closed = true;
        if (this.#latestTasks.get("stream") === close) this.#latestTasks.delete("stream");
      })),
    );
    interrupt = this.#runtime.runCallback(program);
    return Object.freeze({ close });
  }

  /**
   * Runs a cancellable Effect-Clock polling loop. Host timers never own the
   * authentication lifecycle, and component disposal interrupts both sleep
   * and an in-flight poll action.
   */
  startPoll<A>(key: string, args: TAiChatPollArgs<A>): TAiChatStreamLifecycle {
    if (this.#disposed) throw new Error("The AI Chat lifecycle runtime is disposed.");
    this.#latestTasks.get(key)?.();
    let active = true;
    let cancel: () => void = () => undefined;
    const close = () => {
      if (!active) return;
      active = false;
      if (this.#latestTasks.get(key) === close) this.#latestTasks.delete(key);
      cancel();
    };
    this.#latestTasks.set(key, close);
    const program = Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (controller) => Effect.sync(() => controller.abort()),
    ).pipe(
      Effect.flatMap((controller) => fxPollAiChat({
        intervalMs: args.intervalMs,
        run: Effect.tryPromise({
            try: () => args.run(controller.signal),
            catch: (cause) => cause,
        }),
        onValue: (value) => active ? args.onValue(value) : "stop",
        onError(error) {
          if (active && !controller.signal.aborted) args.onError(error);
        },
      })),
      Effect.scoped,
      Effect.ensuring(Effect.sync(() => {
        active = false;
        if (this.#latestTasks.get(key) === close) this.#latestTasks.delete(key);
      })),
    );
    cancel = this.#runtime.runCallback(program);
    return Object.freeze({ close });
  }

  dispose(): Promise<void> {
    if (this.#disposePromise !== null) return this.#disposePromise;
    this.#disposed = true;
    for (const close of [...this.#latestTasks.values()]) close();
    this.#latestTasks.clear();
    this.#disposePromise = this.#runtime.dispose();
    return this.#disposePromise;
  }
}
