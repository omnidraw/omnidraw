export type TControlledBrowserSeed = Readonly<{
  idPrefix?: string;
  firstId?: number;
  firstTimeMillis?: number;
}>;

/** Explicit browser-world inputs for deterministic frontend simulation. */
export class ControlledFrontendBrowser {
  readonly #idPrefix: string;
  #nextId: number;
  #timeMillis: number;
  #clipboard = "";

  constructor(seed: TControlledBrowserSeed = {}) {
    this.#idPrefix = seed.idPrefix ?? "sim";
    this.#nextId = seed.firstId ?? 1;
    this.#timeMillis = seed.firstTimeMillis ?? 0;
  }

  nextId(): string {
    const id = `${this.#idPrefix}-${this.#nextId}`;
    this.#nextId += 1;
    return id;
  }

  nowMillis(): number {
    return this.#timeMillis;
  }

  advanceTimeBy(millis: number): void {
    if (!Number.isFinite(millis) || millis < 0) throw new Error("Simulated time must advance by a finite non-negative duration.");
    this.#timeMillis += millis;
  }

  writeClipboard(text: string): void {
    this.#clipboard = text;
  }

  clipboardText(): string {
    return this.#clipboard;
  }
}
