/** Isolated Storage-compatible state with no browser-global fallback. */
export class FrontendMemoryStorage {
  readonly #values = new Map<string, string>();

  constructor(entries: readonly (readonly [string, string])[] = []) {
    for (const [key, value] of entries) this.#values.set(key, value);
  }

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }

  entries(): readonly (readonly [string, string])[] {
    return [...this.#values.entries()];
  }
}
