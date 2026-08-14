import { Cause, Effect } from 'effect';
import { CanvasEffectRuntime } from '../internal/CanvasEffectRuntime';
import type { TCanvasWaitHandle } from '../types';

export type TManagedCanvasRuntime = {
  bootEffect(): Effect.Effect<void, unknown>;
  shutdownEffect(): Effect.Effect<void, unknown>;
};

export type TCanvasRuntimeLifecyclePortal<TSource> = {
  createRuntime(source: TSource): TManagedCanvasRuntime;
  onBootStart?(source: TSource): void;
  onBootSuccess?(source: TSource): void;
  onBootError?(error: unknown, source: TSource): void;
  onBootRecoveryWait?(error: unknown, source: TSource): void;
  recoverBoot?(error: unknown, source: TSource): TCanvasWaitHandle | null;
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
  #pendingBootRecovery: TCanvasWaitHandle | null = null;
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
    this.#pendingBootRecovery?.cancel();
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

      yield* self.#bootUntilSettledEffect(source, generation);
    });
  }

  #bootUntilSettledEffect(
    source: TSource,
    generation: number,
  ): Effect.Effect<void, never> {
    const self = this;
    return Effect.suspend(() => Effect.gen(function*() {
      if (self.#disposed || generation !== self.#generation) return;
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
      if (exit._tag === 'Success') {
        if (
          generation !== self.#generation
          || self.#disposed
          || self.#activeRuntime !== runtime
        ) {
          if (runtime !== null) yield* self.#shutdownRuntimeEffect(runtime);
          return;
        }
        try {
          self.portal.onBootSuccess?.(source);
        } catch {
          // Host diagnostics do not own runtime lifetime.
        }
        return;
      }

      const error = Cause.squash(exit.cause);
      if (runtime !== null) yield* self.#shutdownRuntimeEffect(runtime);
      if (self.#disposed || generation !== self.#generation) return;

      let recovery: TCanvasWaitHandle | null = null;
      try {
        recovery = self.portal.recoverBoot?.(error, source) ?? null;
      } catch {
        recovery = null;
      }
      if (recovery === null) {
        try {
          self.portal.onBootError?.(error, source);
        } catch {
          // Host diagnostics cannot prevent owned runtime teardown.
        }
        return;
      }
      self.#pendingBootRecovery = recovery;
      try {
        self.portal.onBootRecoveryWait?.(error, source);
      } catch {
        // Recovery ownership remains with the lifecycle.
      }
      const recoveryExit = yield* Effect.exit(Effect.tryPromise({
        try: () => recovery!.promise,
        catch: (cause) => cause,
      }).pipe(Effect.ensuring(Effect.sync(() => {
        if (self.#pendingBootRecovery === recovery) self.#pendingBootRecovery = null;
        recovery?.cancel();
      }))));
      if (self.#disposed || generation !== self.#generation) return;
      if (recoveryExit._tag === 'Failure') {
        const recoveryError = Cause.squash(recoveryExit.cause);
        try {
          self.portal.onBootError?.(recoveryError, source);
        } catch {
          // Host diagnostics cannot prevent owned runtime teardown.
        }
        return;
      }
      yield* self.#bootUntilSettledEffect(source, generation);
    }));
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
