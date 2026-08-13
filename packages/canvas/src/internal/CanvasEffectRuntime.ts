import { Effect, Layer, ManagedRuntime, Semaphore } from 'effect';

/** Instance-owned Effect runtime hidden behind the package's Effect-free API. */
export class CanvasEffectRuntime {
  readonly #runtime = ManagedRuntime.make(Layer.empty);
  #serial = Semaphore.makeUnsafe(1);
  #disposed = false;

  run<A, E>(program: Effect.Effect<A, E>): Promise<A> {
    if (this.#disposed) throw new Error('The Canvas lifecycle runtime is disposed.');
    return this.#runtime.runPromise(program);
  }

  runSerial<A, E>(program: Effect.Effect<A, E>): Promise<A> {
    return this.run(this.#serial.withPermits(1)(program));
  }

  /**
   * Starts a supervised operation in this instance's serial lane. The returned
   * canceler interrupts both queued and running work; disposing the runtime
   * interrupts every lane operation.
   */
  forkSerial<E>(
    program: Effect.Effect<void, E>,
    onError: (error: E) => void = () => undefined,
  ): () => void {
    return this.fork(this.#serial.withPermits(1)(program), onError);
  }

  /**
   * Opens a fresh serial lane after a document generation is invalidated.
   * Already-running fibers remain supervised, while new-generation commands
   * cannot be stranded behind an obsolete transport request.
   */
  resetSerial(): void {
    if (this.#disposed) return;
    this.#serial = Semaphore.makeUnsafe(1);
  }

  fork<E>(
    program: Effect.Effect<void, E>,
    onError: (error: E) => void = () => undefined,
  ): () => void {
    if (this.#disposed) throw new Error('The Canvas lifecycle runtime is disposed.');
    let active = true;
    const supervised = program.pipe(
      Effect.catch((error) => Effect.sync(() => {
        if (active) onError(error);
      })),
    );
    const cancel = this.#runtime.runCallback(supervised, {
      onExit: () => { active = false; },
    });
    return () => {
      if (!active) return;
      active = false;
      cancel();
    };
  }

  dispose(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    this.#disposed = true;
    return this.#runtime.dispose();
  }
}
