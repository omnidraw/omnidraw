import { Cause, Effect, Exit, Scope } from 'effect';

/** Structured, synchronously replaceable child lifetime for listener generations. */
export class CanvasScopeGeneration {
  #scope: Scope.Closeable | null = null;

  constructor(
    private readonly acquire: () => Effect.Effect<void, unknown, Scope.Scope>,
    private readonly onError: (error: unknown) => void,
  ) {}

  replace(active: boolean): void {
    this.#close();
    if (!active) return;
    const scope = Scope.makeUnsafe('sequential');
    this.#scope = scope;
    const exit = Effect.runSync(Effect.exit(
      this.acquire().pipe(Effect.provideService(Scope.Scope, scope)),
    ));
    if (exit._tag === 'Success') return;
    this.#close(exit);
    this.onError(Cause.squash(exit.cause));
  }

  dispose(): void {
    this.#close();
  }

  #close(exit: Exit.Exit<unknown, unknown> = Exit.void): void {
    const scope = this.#scope;
    this.#scope = null;
    if (scope === null) return;
    try {
      Effect.runSync(Scope.close(scope, exit));
    } catch (error) {
      this.onError(error);
    }
  }
}
