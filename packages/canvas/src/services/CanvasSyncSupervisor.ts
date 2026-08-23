import type {
  TCanvasDocumentTransport,
  TCanvasEvent,
  TCanvasItemsChangedEvent,
} from '@omnidraw/canvas-contract';
import { CanvasEventCodec } from '@omnidraw/canvas-contract';
import { Effect } from 'effect';
import { CanvasEffectRuntime } from '../internal/CanvasEffectRuntime';
import type { TCanvasWaitHandle, TCanvasWaitPort } from '../types';

type TCanvasSyncSupervisorOptions = Readonly<{
  canvasId: string;
  transport: TCanvasDocumentTransport;
  wait: TCanvasWaitPort;
  acceptedRevision(): number;
  recoveryActive(): boolean;
  awaitRecoveryEffect(): Effect.Effect<void>;
  acceptEvent(event: TCanvasItemsChangedEvent): void;
  scheduleRecovery(cause?: unknown): void;
  reportError(error: unknown): void;
}>;

/** Instance owner for Canvas queues, fibers, retries, and generation fences. */
export class CanvasSyncSupervisor {
  readonly #effects = new CanvasEffectRuntime();
  readonly #activeWaits = new Set<TCanvasWaitHandle>();
  #eventIterator: AsyncIterator<TCanvasEvent> | null = null;
  #cancelEventStream: (() => void) | null = null;
  #eventGeneration = 0;
  #outboxGeneration = 0;
  #disposed = false;

  constructor(private readonly options: TCanvasSyncSupervisorOptions) {}

  get outboxGeneration(): number {
    return this.#outboxGeneration;
  }

  isOutboxGeneration(generation: number): boolean {
    return !this.#disposed && generation === this.#outboxGeneration;
  }

  invalidateOutbox(): void {
    this.#outboxGeneration += 1;
    this.#effects.resetSerial();
  }

  run<A, E>(program: Effect.Effect<A, E>): Promise<A> {
    return this.#effects.run(program);
  }

  fork<E>(
    program: Effect.Effect<void, E>,
    onError: (error: E) => void = () => undefined,
  ): () => void {
    return this.#effects.fork(program, onError);
  }

  forkSerial<E>(
    program: Effect.Effect<void, E>,
    onError: (error: E) => void = () => undefined,
  ): () => void {
    return this.#effects.forkSerial(program, onError);
  }

  startEventStream(): void {
    if (this.#disposed) return;
    this.#cancelEventStream?.();
    const generation = ++this.#eventGeneration;
    this.#cancelEventStream = this.#effects.fork(
      this.#consumeEventsEffect(generation),
      (error) => this.options.reportError(error),
    );
  }

  waitBeforeRetryEffect(delayMs: number): Effect.Effect<void, unknown> {
    if (this.#disposed) return Effect.void;
    return Effect.acquireRelease(
      Effect.sync(() => {
        const wait = this.options.wait.wait(delayMs);
        this.#activeWaits.add(wait);
        return wait;
      }),
      (wait) => Effect.sync(() => {
        this.#activeWaits.delete(wait);
        wait.cancel();
      }),
    ).pipe(
      Effect.flatMap((wait) => Effect.tryPromise({
        try: () => wait.promise,
        catch: (cause) => cause,
      })),
      Effect.scoped,
    );
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#eventGeneration += 1;
    this.#outboxGeneration += 1;
    this.#cancelEventStream?.();
    this.#cancelEventStream = null;
    const iterator = this.#eventIterator;
    this.#eventIterator = null;
    for (const wait of [...this.#activeWaits]) wait.cancel();
    try {
      await iterator?.return?.();
    } catch {
      // Stream cancellation is best-effort; the owned runtime still closes.
    }
    await this.#effects.dispose();
  }

  #consumeEventsEffect(generation: number): Effect.Effect<void, unknown> {
    const current = () => !this.#disposed && generation === this.#eventGeneration;
    const consume = (): Effect.Effect<void, unknown> => Effect.suspend(() => {
      if (!current()) return Effect.void;
      if (this.options.recoveryActive()) {
        return this.options.awaitRecoveryEffect().pipe(Effect.andThen(consume()));
      }
      const subscription = Effect.acquireRelease(
        Effect.try({
          try: () => {
            const iterable = this.options.transport.subscribe({
              canvasId: this.options.canvasId,
              afterRevision: this.options.acceptedRevision(),
            });
            const iterator = iterable[Symbol.asyncIterator]();
            this.#eventIterator = iterator;
            return iterator;
          },
          catch: (cause) => cause,
        }),
        (iterator) => Effect.tryPromise({
          try: async () => { await iterator.return?.(); },
          catch: (cause) => cause,
        }).pipe(
          Effect.catch(() => Effect.void),
          Effect.ensuring(Effect.sync(() => {
            if (this.#eventIterator === iterator) this.#eventIterator = null;
          })),
        ),
      ).pipe(
        Effect.flatMap((iterator) => this.#consumeIteratorEffect(iterator, generation)),
        Effect.scoped,
        Effect.matchEffect({
          onFailure: (error) => Effect.sync(() => {
            if (current()) this.options.reportError(error);
            return 'retry' as const;
          }),
          onSuccess: (result) => Effect.succeed(result),
        }),
      );
      return subscription.pipe(Effect.flatMap((result) => {
        if (!current()) return Effect.void;
        if (result === 'recovery') {
          return this.options.awaitRecoveryEffect().pipe(Effect.andThen(consume()));
        }
        return this.waitBeforeRetryEffect(250).pipe(Effect.andThen(consume()));
      }));
    });
    return consume();
  }

  #consumeIteratorEffect(
    iterator: AsyncIterator<TCanvasEvent>,
    generation: number,
  ): Effect.Effect<'ended' | 'recovery' | 'stopped', unknown> {
    return Effect.suspend(() => {
      if (this.#disposed || generation !== this.#eventGeneration) {
        return Effect.succeed('stopped' as const);
      }
      return Effect.tryPromise({
        try: () => iterator.next(),
        catch: (cause) => cause,
      }).pipe(Effect.flatMap((next) => {
        if (next.done) return Effect.succeed('ended' as const);
        if (this.options.recoveryActive()) {
          return Effect.succeed('recovery' as const);
        }
        return Effect.try({
          try: () => CanvasEventCodec.decode(next.value),
          catch: (cause) => cause,
        }).pipe(
          Effect.flatMap((event) => Effect.sync(() => {
            if (event.type === 'items-changed') {
              try {
                this.options.acceptEvent(event);
                return false;
              } catch (error) {
                if (!this.#disposed) this.options.scheduleRecovery(error);
                return true;
              }
            }
            this.options.scheduleRecovery();
            return true;
          })),
          Effect.flatMap((recover) => recover
            ? Effect.succeed('recovery' as const)
            : this.#consumeIteratorEffect(iterator, generation)),
        );
      }));
    });
  }
}
