type TMutationRateLedger = {
  lastSeenAt: number;
  timestamps: number[];
};

type TMutationAdmission =
  | Readonly<{ allowed: true }>
  | Readonly<{
    allowed: false;
    retryAfterMs: number;
  }>;

class WidgetStateMutationRateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #maxLedgers: number;
  readonly #ledgers = new Map<string, TMutationRateLedger>();

  constructor(limit: number, windowMs: number, maxLedgers: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#maxLedgers = maxLedgers;
  }

  get size(): number {
    return this.#ledgers.size;
  }

  admit(scope: string, now: number): TMutationAdmission {
    this.#prune(now);
    let ledger = this.#ledgers.get(scope);
    if (ledger === undefined) {
      if (this.#ledgers.size >= this.#maxLedgers) {
        return Object.freeze({
          allowed: false,
          retryAfterMs: this.#earliestRetryAfter(now),
        });
      }
      ledger = { lastSeenAt: now, timestamps: [] };
      this.#ledgers.set(scope, ledger);
    }

    ledger.lastSeenAt = Math.max(ledger.lastSeenAt, now);
    if (ledger.timestamps.length >= this.#limit) {
      return Object.freeze({
        allowed: false,
        retryAfterMs: Math.max(1, ledger.timestamps[0]! + this.#windowMs - now),
      });
    }
    ledger.timestamps.push(now);
    return Object.freeze({ allowed: true });
  }

  release(scope: string): void {
    this.#ledgers.delete(scope);
  }

  clear(): void {
    this.#ledgers.clear();
  }

  #prune(now: number): void {
    const cutoff = now - this.#windowMs;
    for (const [scope, ledger] of this.#ledgers) {
      while (
        ledger.timestamps.length > 0
        && ledger.timestamps[0]! <= cutoff
      ) {
        ledger.timestamps.shift();
      }
      if (ledger.timestamps.length === 0) this.#ledgers.delete(scope);
    }
  }

  #earliestRetryAfter(now: number): number {
    let retryAfterMs = this.#windowMs;
    for (const ledger of this.#ledgers.values()) {
      const first = ledger.timestamps[0];
      if (first === undefined) continue;
      retryAfterMs = Math.min(
        retryAfterMs,
        Math.max(1, first + this.#windowMs - now),
      );
    }
    return retryAfterMs;
  }
}

export { WidgetStateMutationRateLimiter };
export type { TMutationAdmission };
