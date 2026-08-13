import type { TPublicationReadWriteBarrier } from './typed';

type TQueuedOperation = {
  kind: 'read' | 'write';
  operation: () => unknown | Promise<unknown>;
  resolve(value: unknown): void;
  reject(reason: unknown): void;
};

/**
 * Fair in-process reader/writer barrier for the two-rename replacement window.
 *
 * Cross-process exclusion is provided separately by `.writer.lock`. A poisoned
 * barrier rejects readers without invoking their callbacks, so an unrecoverable
 * path gap can never leak through an in-process runtime lookup.
 */
export class PublicationReadWriteBarrier implements TPublicationReadWriteBarrier {
  readonly #queue: TQueuedOperation[] = [];
  #activeReaders = 0;
  #writerActive = false;
  readonly #poisonReasons = new Map<string, Error>();

  withRead<T>(operation: () => T | Promise<T>): Promise<T> {
    return this.#enqueue('read', operation);
  }

  withWrite<T>(operation: () => T | Promise<T>): Promise<T> {
    return this.#enqueue('write', operation);
  }

  poison(reason: Error, scope = '*'): void {
    this.#poisonReasons.set(scope, reason);
  }

  repair(scope: string): void {
    this.#poisonReasons.delete(scope);
  }

  isPoisoned(scope?: string): boolean {
    return scope === undefined
      ? this.#poisonReasons.size > 0
      : this.#poisonReasons.has(scope);
  }

  #enqueue<T>(kind: 'read' | 'write', operation: () => T | Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#queue.push({
        kind,
        operation,
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.#drain();
    });
  }

  #drain(): void {
    if (this.#writerActive) return;
    const first = this.#queue[0];
    if (first === undefined) return;
    if (first.kind === 'write') {
      if (this.#activeReaders !== 0) return;
      this.#queue.shift();
      this.#writerActive = true;
      void this.#run(first).finally(() => {
        this.#writerActive = false;
        this.#drain();
      });
      return;
    }

    while (this.#queue[0]?.kind === 'read' && !this.#writerActive) {
      const reader = this.#queue.shift()!;
      const poisonReason = this.#poisonReasons.values().next().value as Error | undefined;
      if (poisonReason !== undefined) {
        reader.reject(poisonReason);
        continue;
      }
      this.#activeReaders += 1;
      void this.#run(reader).finally(() => {
        this.#activeReaders -= 1;
        this.#drain();
      });
    }
    if (this.#activeReaders === 0 && this.#queue[0]?.kind === 'write') this.#drain();
  }

  async #run(operation: TQueuedOperation): Promise<void> {
    try {
      operation.resolve(await operation.operation());
    } catch (error) {
      operation.reject(error);
    }
  }
}
