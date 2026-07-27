export type TManagedCanvasRuntime = {
  boot(): void | Promise<void>;
  shutdown(): void | Promise<void>;
};

export type TCanvasRuntimeLifecyclePortal<TSource> = {
  createRuntime(source: TSource): TManagedCanvasRuntime;
  onBootStart?(source: TSource): void;
  onBootSuccess?(source: TSource): void;
  onBootError?(error: unknown, source: TSource): void;
  onShutdownError?(error: unknown): void;
};

/**
 * Serializes canvas runtime replacement so one host never owns overlapping
 * engine instances, observers, portal roots, or input subscriptions.
 */
export class CanvasRuntimeLifecycle<TSource> {
  #activeRuntime: TManagedCanvasRuntime | null = null;
  #generation = 0;
  #queue: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(
    private readonly portal: TCanvasRuntimeLifecyclePortal<TSource>,
  ) {}

  get activeRuntime() {
    return this.#activeRuntime;
  }

  replace(source: TSource | null) {
    if (this.#disposed && source !== null) {
      return this.#queue;
    }

    this.#generation += 1;
    const generation = this.#generation;
    const run = async () => {
      await this.#shutdownActive();
      if (
        source === null
        || this.#disposed
        || generation !== this.#generation
      ) {
        return;
      }

      let runtime: TManagedCanvasRuntime | null = null;
      try {
        runtime = this.portal.createRuntime(source);
        this.#activeRuntime = runtime;
        this.portal.onBootStart?.(source);
        await runtime.boot();
      } catch (error) {
        if (
          (runtime === null || this.#activeRuntime === runtime)
          && generation === this.#generation
          && !this.#disposed
        ) {
          this.portal.onBootError?.(error, source);
        }
        if (runtime !== null) {
          await this.#shutdownRuntime(runtime);
        }
        return;
      }

      if (
        generation !== this.#generation
        || this.#disposed
        || this.#activeRuntime !== runtime
      ) {
        await this.#shutdownRuntime(runtime);
        return;
      }
      this.portal.onBootSuccess?.(source);
    };

    this.#queue = this.#queue.then(run, run);
    return this.#queue;
  }

  dispose() {
    if (this.#disposed) {
      return this.#queue;
    }

    this.#disposed = true;
    return this.replace(null);
  }

  async #shutdownActive() {
    const runtime = this.#activeRuntime;
    this.#activeRuntime = null;
    if (runtime) {
      await this.#shutdownRuntime(runtime);
    }
  }

  async #shutdownRuntime(runtime: TManagedCanvasRuntime) {
    if (this.#activeRuntime === runtime) {
      this.#activeRuntime = null;
    }

    try {
      await runtime.shutdown();
    } catch (error) {
      this.portal.onShutdownError?.(error);
    }
  }
}
