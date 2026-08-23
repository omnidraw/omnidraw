import { Effect } from "effect";

export type TSimConnectionSnapshot = Readonly<{
  connected: boolean;
  generation: number;
}>;

export type TSimConnectionLease = Readonly<{
  id: number;
  retired: boolean;
}>;

/** Explicitly stepped logical connection generations for recovery simulations. */
export class ScriptedFrontendConnection {
  #connected = false;
  #generation = 0;
  #leaseId = 0;
  #hasConnected = false;
  readonly #retired = new Set<number>();
  readonly #listeners = new Set<(snapshot: TSimConnectionSnapshot) => void>();

  snapshot(): TSimConnectionSnapshot {
    return Object.freeze({ connected: this.#connected, generation: this.#generation });
  }

  lease(): TSimConnectionLease {
    return Object.freeze({ id: this.#leaseId, retired: this.#retired.has(this.#leaseId) });
  }

  assertCurrent(lease: TSimConnectionLease): void {
    if (lease.id !== this.#leaseId || this.#retired.has(lease.id)) {
      throw new Error("The simulated operation belongs to a retired connection generation.");
    }
  }

  step(event: "connect" | "disconnect"): void {
    if (event === "connect") {
      if (this.#connected) return;
      if (this.#hasConnected) {
        this.#retired.add(this.#leaseId);
        this.#leaseId += 1;
      }
      this.#hasConnected = true;
      this.#connected = true;
      this.#generation += 1;
      this.#publish();
      return;
    }
    if (!this.#connected) return;
    this.#connected = false;
    this.#retired.add(this.#leaseId);
    this.#leaseId += 1;
    this.#publish();
  }

  awaitConnectedAfter(generation: number): Effect.Effect<TSimConnectionSnapshot> {
    return Effect.callback((resume) => {
      const current = this.snapshot();
      if (current.connected && current.generation > generation) {
        resume(Effect.succeed(current));
        return;
      }
      const listener = (snapshot: TSimConnectionSnapshot): void => {
        if (!snapshot.connected || snapshot.generation <= generation) return;
        this.#listeners.delete(listener);
        resume(Effect.succeed(snapshot));
      };
      this.#listeners.add(listener);
      return Effect.sync(() => this.#listeners.delete(listener));
    });
  }

  #publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}
