import type { TVerifiedWidgetUiArtifact } from './interface';

export class WidgetUiArtifactCache {
  readonly #entries = new Map<string, TVerifiedWidgetUiArtifact>();
  #totalBytes = 0;
  readonly maxEntries: number;
  readonly maxBytes: number;

  constructor(config: Readonly<{ maxEntries?: number; maxBytes?: number }> = {}) {
    const maxEntries = config.maxEntries ?? 64;
    const maxBytes = config.maxBytes ?? 32 * 1024 * 1024;
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1_024) {
      throw new TypeError('Widget UI artifact cache size is invalid.');
    }
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 * 1024) {
      throw new TypeError('Widget UI artifact cache byte limit is invalid.');
    }
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  get(key: string): TVerifiedWidgetUiArtifact | null {
    const value = this.#entries.get(key);
    if (!value) return null;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: string, value: TVerifiedWidgetUiArtifact): void {
    const previous = this.#entries.get(key);
    if (previous) this.#totalBytes -= previous.retainedByteSize;
    this.#entries.delete(key);
    if (value.retainedByteSize > this.maxBytes) return;
    this.#entries.set(key, value);
    this.#totalBytes += value.retainedByteSize;
    while (this.#entries.size > this.maxEntries || this.#totalBytes > this.maxBytes) {
      const oldest = this.#entries.keys().next().value;
      if (typeof oldest !== 'string') break;
      const evicted = this.#entries.get(oldest);
      this.#entries.delete(oldest);
      if (evicted) this.#totalBytes -= evicted.retainedByteSize;
    }
  }

  clear(): void {
    this.#entries.clear();
    this.#totalBytes = 0;
  }

  get size(): number {
    return this.#entries.size;
  }

  get totalBytes(): number {
    return this.#totalBytes;
  }
}
