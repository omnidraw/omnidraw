import { Cause, Effect } from 'effect';
import { CanvasEffectRuntime } from '../internal/CanvasEffectRuntime';

export type TManagedCanvasRuntime = {
  bootEffect(): Effect.Effect<void, unknown>;
  shutdownEffect(): Effect.Effect<void, unknown>;
};

export type TCanvasRuntimeLifecyclePortal<TSource> = {
  createRuntime(source: TSource): TManagedCanvasRuntime;
  onBootStart?(source: TSource): void;
  onBootSuccess?(source: TSource): void;
  onBootError?(error: unknown, source: TSource): void;
  onShutdownError?(error: unknown): void;
};

/**
 * Serializes runtime replacement through an instance-owned Effect semaphore so
 * one host never overlaps engines, observers, portal roots, or input scopes.
 */
export class CanvasRuntimeLifecycle<TSource> {
  #activeRuntime: TManagedCanvasRuntime | null = null;
  #generation = 0;
  #disposed = false;
  #disposePromise: Promise<void> | null = null;
  readonly #effects = new CanvasEffectRuntime();

  constructor(
    private readonly portal: TCanvasRuntimeLifecyclePortal<TSource>,
  ) {}

  get activeRuntime() {
    return this.#activeRuntime;
  }

  replace(source: TSource | null): Promise<void> {
    if (this.#disposed && source !== null) return Promise.resolve();
    this.#generation += 1;
    const generation = this.#generation;
    return this.#effects.runSerial(this.#replaceEffect(source, generation));
  }

  dispose(): Promise<void> {
    if (this.#disposePromise !== null) return this.#disposePromise;
    this.#disposed = true;
    this.#disposePromise = this.replace(null).then(
      () => this.#effects.dispose(),
      (error) => this.#effects.dispose().then(() => Promise.reject(error)),
    );
    return this.#disposePromise;
  }

  #replaceEffect(
    source: TSource | null,
    generation: number,
  ): Effect.Effect<void, never> {
    const self = this;
    return Effect.gen(function*() {
      yield* self.#shutdownActiveEffect();
      if (
        source === null
        || self.#disposed
        || generation !== self.#generation
      ) return;

      let runtime: TManagedCanvasRuntime | null = null;
      const boot = Effect.gen(function*() {
        runtime = yield* Effect.try({
          try: () => self.portal.createRuntime(source),
          catch: (cause) => cause,
        });
        self.#activeRuntime = runtime;
        yield* Effect.try({
          try: () => self.portal.onBootStart?.(source),
          catch: (cause) => cause,
        });
        yield* runtime!.bootEffect();
      });

      const exit = yield* Effect.exit(boot);
      if (exit._tag === 'Failure') {
        const error = Cause.squash(exit.cause);
        if (
          (runtime === null || self.#activeRuntime === runtime)
          && generation === self.#generation
          && !self.#disposed
        ) {
          try {
            self.portal.onBootError?.(error, source);
          } catch {
            // Host diagnostics cannot prevent owned runtime teardown.
          }
        }
        if (runtime !== null) yield* self.#shutdownRuntimeEffect(runtime);
        return;
      }

      if (
        generation !== self.#generation
        || self.#disposed
        || self.#activeRuntime !== runtime
      ) {
        yield* self.#shutdownRuntimeEffect(runtime!);
        return;
      }
      try {
        self.portal.onBootSuccess?.(source);
      } catch {
        // Host diagnostics do not own runtime lifetime.
      }
    });
  }

  #shutdownActiveEffect(): Effect.Effect<void, never> {
    const self = this;
    return Effect.gen(function*() {
      const runtime = self.#activeRuntime;
      self.#activeRuntime = null;
      if (runtime !== null) yield* self.#shutdownRuntimeEffect(runtime);
    });
  }

  #shutdownRuntimeEffect(
    runtime: TManagedCanvasRuntime,
  ): Effect.Effect<void, never> {
    if (this.#activeRuntime === runtime) this.#activeRuntime = null;
    return Effect.exit(runtime.shutdownEffect()).pipe(
      Effect.flatMap((exit) => {
        if (exit._tag === 'Success') return Effect.void;
        const error = Cause.squash(exit.cause);
        return Effect.sync(() => {
        try {
          this.portal.onShutdownError?.(error);
        } catch {
          // Host diagnostics stay isolated from teardown.
        }
        });
      }),
    );
  }
}
