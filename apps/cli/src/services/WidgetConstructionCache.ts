import type {
  TWidgetFilesystemConstruction,
  TWidgetFilesystemConstructionCache,
} from '@omnidraw/service-agent';
import {
  fnDecodeWidgetFilesystemConstruction,
  fnEncodeWidgetFilesystemConstruction,
} from '@omnidraw/service-agent';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CACHE_FORMAT = 'omnidraw.widget-construction-cache.v1';
const MAX_ENTRIES = 16;
const MAX_ENTRY_BYTES = 24 * 1_024 * 1_024;
const MAX_TOTAL_BYTES = 128 * 1_024 * 1_024;

type TCacheIndex = Readonly<{
  format: typeof CACHE_FORMAT;
  entries: Readonly<Record<string, Readonly<{ byteSize: number; updatedAtMs: number }>>>;
}>;

/**
 * Durable, bounded construction cache so a server restart can reuse the exact
 * validated widget build instead of re-running npm/vite/Capsule. The key is the
 * executable-input digest plus builder identity; a read is only honored after
 * the build service re-verifies every digest against the current request.
 */
export class WidgetConstructionCache implements TWidgetFilesystemConstructionCache {
  readonly #directory: string;
  #indexPath: string;
  #index: TCacheIndex | null = null;
  #tail: Promise<void> = Promise.resolve();

  constructor(directory: string) {
    this.#directory = directory;
    this.#indexPath = join(directory, 'index.json');
  }

  async read(key: string): Promise<TWidgetFilesystemConstruction | null> {
    try {
      const index = await this.#loadIndex();
      const entry = index.entries[key];
      if (entry === undefined) return null;
      const path = this.#entryPath(key);
      const bytes = await readFile(path);
      if (bytes.byteLength !== entry.byteSize) {
        await this.#deleteEntry(key);
        return null;
      }
      return fnDecodeWidgetFilesystemConstruction(bytes.toString('utf8'));
    } catch (error) {
      if (this.#isMissing(error)) return null;
      return null;
    }
  }

  async write(key: string, construction: TWidgetFilesystemConstruction): Promise<void> {
    const operation = this.#tail.then(async () => {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      const json = fnEncodeWidgetFilesystemConstruction(construction);
      const bytes = Buffer.from(json, 'utf8');
      if (bytes.byteLength > MAX_ENTRY_BYTES) {
        throw new Error('Widget construction cache entry exceeds its byte limit.');
      }
      await this.#enforceBounds(key, bytes.byteLength);
      await this.#atomicWrite(this.#entryPath(key), bytes);
      const index = await this.#loadIndex();
      const entries = { ...index.entries, [key]: Object.freeze({
        byteSize: bytes.byteLength,
        updatedAtMs: Date.now(),
      }) };
      await this.#atomicWrite(this.#indexPath, Buffer.from(
        JSON.stringify(Object.freeze({ format: CACHE_FORMAT, entries })),
        'utf8',
      ));
      this.#index = Object.freeze({ format: CACHE_FORMAT, entries });
    });
    this.#tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async close(): Promise<void> {
    await this.#tail;
  }

  #entryPath(key: string): string {
    const digest = createHash('sha256').update(key).digest('hex');
    return join(this.#directory, `${digest}.json`);
  }

  async #loadIndex(): Promise<TCacheIndex> {
    if (this.#index !== null) return this.#index;
    try {
      const raw = await readFile(this.#indexPath, 'utf8');
      const value = JSON.parse(raw) as TCacheIndex;
      if (value.format !== CACHE_FORMAT || typeof value.entries !== 'object' || value.entries === null) {
        return Object.freeze({ format: CACHE_FORMAT, entries: Object.freeze({}) });
      }
      this.#index = Object.freeze({ format: CACHE_FORMAT, entries: value.entries });
      return this.#index;
    } catch (error) {
      if (this.#isMissing(error)) {
        return Object.freeze({ format: CACHE_FORMAT, entries: Object.freeze({}) });
      }
      throw error;
    }
  }

  async #enforceBounds(key: string, addingBytes: number): Promise<void> {
    const index = await this.#loadIndex();
    let totalBytes = addingBytes;
    for (const [entryKey, entry] of Object.entries(index.entries)) {
      if (entryKey !== key) totalBytes += entry.byteSize;
    }
    const oversized = Object.entries(index.entries)
      .filter(([entryKey]) => entryKey !== key)
      .sort((left, right) => left[1].updatedAtMs - right[1].updatedAtMs);
    while (
      oversized.length > 0
      && (Object.keys(index.entries).length - (index.entries[key] === undefined ? 0 : 1)) >= MAX_ENTRIES
      || (oversized.length > 0 && totalBytes > MAX_TOTAL_BYTES)
    ) {
      const [evictKey, evictEntry] = oversized.shift()!;
      totalBytes -= evictEntry.byteSize;
      await this.#deleteEntry(evictKey).catch(() => undefined);
    }
  }

  async #deleteEntry(key: string): Promise<void> {
    await unlink(this.#entryPath(key)).catch((error) => {
      if (!this.#isMissing(error)) throw error;
    });
    const index = await this.#loadIndex();
    if (index.entries[key] === undefined) return;
    const entries = Object.fromEntries(
      Object.entries(index.entries).filter(([entryKey]) => entryKey !== key),
    );
    const next = Object.freeze({ format: CACHE_FORMAT, entries: Object.freeze(entries) });
    await this.#atomicWrite(this.#indexPath, Buffer.from(JSON.stringify(next), 'utf8'));
    this.#index = next;
  }

  async #atomicWrite(path: string, bytes: Buffer): Promise<void> {
    const temporary = `${path}.tmp`;
    await writeFile(temporary, bytes, { flag: 'w', mode: 0o600 });
    try {
      await rename(temporary, path);
    } catch (error) {
      if (!this.#isMissing(error)) throw error;
      await writeFile(path, bytes, { flag: 'w', mode: 0o600 });
    }
  }

  #isMissing(error: unknown): boolean {
    return error !== null
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: unknown }).code === 'ENOENT';
  }
}

export { MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_TOTAL_BYTES };
