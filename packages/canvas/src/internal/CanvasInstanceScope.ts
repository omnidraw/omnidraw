import { Effect, Exit, Scope } from 'effect';

type TCleanupOperation = () => void | Promise<void>;

/**
 * One sequential lifetime for a mounted Canvas runtime.
 *
 * Every finalizer is best-effort. Cleanup failures are retained while the
 * remaining finalizers run, then reported as the original error or one
 * AggregateError. Closing is idempotent, including after failed acquisition.
 */
export class CanvasInstanceScope {
  readonly #scope = Scope.makeUnsafe('sequential');
  readonly #cleanupErrors: unknown[] = [];
  #closed = false;

  acquire<A, E>(
    acquire: Effect.Effect<A, E>,
    release: (resource: A) => void | Promise<void>,
  ): Effect.Effect<A, E> {
    return Effect.acquireRelease(
      acquire,
      (resource) => this.#attemptCleanup(() => release(resource)),
    ).pipe(Effect.provideService(Scope.Scope, this.#scope));
  }

  acquireSync<A>(
    acquire: () => A,
    release: (resource: A) => void | Promise<void>,
  ): Effect.Effect<A, unknown> {
    return this.acquire(
      Effect.try({ try: acquire, catch: (cause) => cause }),
      release,
    );
  }

  acquirePromise<A>(
    acquire: (signal: AbortSignal) => PromiseLike<A>,
    release: (resource: A) => void | Promise<void>,
  ): Effect.Effect<A, unknown> {
    return this.acquire(
      Effect.tryPromise({ try: acquire, catch: (cause) => cause }),
      release,
    );
  }

  addFinalizer(operation: TCleanupOperation): Effect.Effect<void> {
    return this.acquire(Effect.void, () => operation());
  }

  addFinalizerEffect(operation: Effect.Effect<void>): Effect.Effect<void> {
    return Effect.acquireRelease(
      Effect.void,
      () => operation,
    ).pipe(Effect.provideService(Scope.Scope, this.#scope));
  }

  /** Forks a supervised child that is interrupted before this scope closes. */
  fork<E>(operation: Effect.Effect<void, E>): Effect.Effect<void> {
    return Effect.forkIn(operation, this.#scope).pipe(Effect.asVoid);
  }

  attempt(operation: TCleanupOperation): Effect.Effect<void> {
    return this.#attemptCleanup(operation);
  }

  close(exit: Exit.Exit<unknown, unknown> = Exit.void): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      if (this.#closed) return Effect.void;
      this.#closed = true;
      return Scope.close(this.#scope, exit).pipe(
        Effect.andThen(Effect.suspend(() => {
          if (this.#cleanupErrors.length === 0) return Effect.void;
          if (this.#cleanupErrors.length === 1) {
            return Effect.fail(this.#cleanupErrors[0]);
          }
          return Effect.fail(new AggregateError(
            [...this.#cleanupErrors],
            'Canvas runtime teardown failed.',
          ));
        })),
      );
    });
  }

  #attemptCleanup(operation: TCleanupOperation): Effect.Effect<void> {
    return Effect.tryPromise({
      try: () => Promise.resolve(operation()),
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((error) => Effect.sync(() => {
        this.#cleanupErrors.push(error);
      })),
    );
  }
}
