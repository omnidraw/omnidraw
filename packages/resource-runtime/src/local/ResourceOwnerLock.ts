/**
 * @file Cross-process ownership fence for one local Resource Store root.
 */

import { open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { Database as SQLiteDatabase } from 'bun:sqlite';
import { ResourceError } from '../ResourceError';

const OWNER_FILENAME = '.vibecanvas-resource-owner';
const CLAIM_MUTEX_FILENAME = '.vibecanvas-resource-owner-claim.db';
const INVALID_OWNER_GRACE_MS = 10_000;
const CLAIM_MUTEX_TIMEOUT_MS = 5_000;
const CLAIM_MUTEX_RETRY_MS = 10;

const claimMutexTails = new Map<string, Promise<void>>();

type TStoredOwner = Readonly<{
  version: 1;
  ownerId: string;
  pid: number;
  token: string;
  claimedAtMs: number;
}>;

export type TResourceOwnerLockPortal = Readonly<{
  randomUUID(): string;
  pid: number;
  nowMs(): number;
  isProcessAlive(pid: number): boolean;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  openExclusive(path: string, content: string): Promise<void>;
  readText(path: string): Promise<string>;
  modifiedAtMs(path: string): Promise<number>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}>;

export type TResourceOwnerLockConfig = Readonly<{
  root: string;
  ownerId: string;
  invalidOwnerGraceMs?: number;
  portal?: TResourceOwnerLockPortal;
}>;

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function parseStoredOwner(value: string): TStoredOwner | null {
  try {
    const parsed = JSON.parse(value) as Partial<TStoredOwner>;
    return parsed.version === 1
      && typeof parsed.ownerId === 'string'
      && typeof parsed.pid === 'number'
      && Number.isInteger(parsed.pid)
      && parsed.pid > 0
      && typeof parsed.token === 'string'
      && parsed.token.length > 0
      && typeof parsed.claimedAtMs === 'number'
      && Number.isFinite(parsed.claimedAtMs)
      ? parsed as TStoredOwner
      : null;
  } catch {
    return null;
  }
}

function defaultPortal(): TResourceOwnerLockPortal {
  return {
    randomUUID: () => crypto.randomUUID(),
    pid: process.pid,
    nowMs: () => Date.now(),
    isProcessAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return error instanceof Error && 'code' in error && error.code === 'EPERM';
      }
    },
    mkdir,
    openExclusive: async (path, content) => {
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(content, { encoding: 'utf8' });
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    readText: (path) => readFile(path, 'utf8'),
    modifiedAtMs: async (path) => (await stat(path)).mtimeMs,
    rename,
    remove: (path) => rm(path, { force: true }),
  };
}

function isSqliteBusy(error: unknown): boolean {
  return error instanceof Error
    && ('code' in error && (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED'));
}

async function withInProcessClaimLane<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = claimMutexTails.get(root) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const tail = result.then(() => undefined, () => undefined);
  claimMutexTails.set(root, tail);
  void tail.finally(() => {
    if (claimMutexTails.get(root) === tail) claimMutexTails.delete(root);
  });
  return result;
}

async function withCrossProcessClaimMutex<T>(root: string, operation: () => Promise<T>): Promise<T> {
  return withInProcessClaimLane(root, async () => {
    await mkdir(root, { recursive: true });
    const database = new SQLiteDatabase(join(root, CLAIM_MUTEX_FILENAME), { create: true });
    const deadline = Date.now() + CLAIM_MUTEX_TIMEOUT_MS;
    let began = false;
    try {
      while (!began) {
        try {
          database.exec('BEGIN EXCLUSIVE;');
          began = true;
        } catch (error) {
          if (!isSqliteBusy(error) || Date.now() >= deadline) {
            throw new ResourceError(
              'RESOURCE_OWNER_CONFLICT',
              'Resource Store ownership recovery is already in progress.',
            );
          }
          await new Promise<void>((resolve) => setTimeout(resolve, CLAIM_MUTEX_RETRY_MS));
        }
      }
      const result = await operation();
      database.exec('COMMIT;');
      began = false;
      return result;
    } finally {
      if (began) {
        try { database.exec('ROLLBACK;'); } catch { /* The transaction may already be gone. */ }
      }
      database.close();
    }
  });
}

/** A held lease. Releasing it removes the lock only if its fencing token still matches. */
export class ResourceOwnerLease {
  readonly ownerId: string;
  readonly path: string;
  readonly token: string;
  readonly #portal: TResourceOwnerLockPortal;
  #released = false;
  #releasePromise: Promise<void> | null = null;

  constructor(args: Readonly<{
    ownerId: string;
    path: string;
    token: string;
    portal: TResourceOwnerLockPortal;
  }>) {
    this.ownerId = args.ownerId;
    this.path = args.path;
    this.token = args.token;
    this.#portal = args.portal;
  }

  release(): Promise<void> {
    if (this.#released) return Promise.resolve();
    if (this.#releasePromise) return this.#releasePromise;
    const releasing = (async () => {
      await withCrossProcessClaimMutex(dirname(this.path), async () => {
        let current: TStoredOwner | null = null;
        try {
          current = parseStoredOwner(await this.#portal.readText(this.path));
        } catch (error) {
          if (isMissing(error)) return;
          throw error;
        }
        if (current?.token === this.token) await this.#portal.remove(this.path);
      });
      this.#released = true;
    })();
    this.#releasePromise = releasing;
    void releasing.catch(() => {
      if (this.#releasePromise === releasing) this.#releasePromise = null;
    });
    return releasing;
  }
}

/**
 * Atomically claims a storage root. A live or ambiguous owner fails closed; a
 * lock whose process is gone is fenced by an atomic rename before takeover.
 */
export async function claimResourceOwner(
  config: TResourceOwnerLockConfig,
): Promise<ResourceOwnerLease> {
  const portal = config.portal ?? defaultPortal();
  const lockPath = join(config.root, OWNER_FILENAME);
  const invalidOwnerGraceMs = config.invalidOwnerGraceMs ?? INVALID_OWNER_GRACE_MS;
  return withCrossProcessClaimMutex(config.root, async () => {
    await portal.mkdir(dirname(lockPath), { recursive: true });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = portal.randomUUID();
      const owner: TStoredOwner = {
        version: 1,
        ownerId: config.ownerId,
        pid: portal.pid,
        token,
        claimedAtMs: portal.nowMs(),
      };
      try {
        await portal.openExclusive(lockPath, `${JSON.stringify(owner)}\n`);
        return new ResourceOwnerLease({ ownerId: config.ownerId, path: lockPath, token, portal });
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }

      let existing: TStoredOwner | null = null;
      let modifiedAtMs = portal.nowMs();
      try {
        const [content, modified] = await Promise.all([
          portal.readText(lockPath),
          portal.modifiedAtMs(lockPath),
        ]);
        existing = parseStoredOwner(content);
        modifiedAtMs = modified;
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }

      const invalidOwnerIsRecent = existing === null
        && portal.nowMs() - modifiedAtMs < invalidOwnerGraceMs;
      if (invalidOwnerIsRecent || (existing !== null && portal.isProcessAlive(existing.pid))) {
        throw new ResourceError(
          'RESOURCE_OWNER_CONFLICT',
          'Another Resource Store owns this storage root.',
          existing ? { ownerId: existing.ownerId, pid: existing.pid } : undefined,
        );
      }

      const quarantinePath = `${lockPath}.stale-${portal.randomUUID()}`;
      try {
        await portal.rename(lockPath, quarantinePath);
        await portal.remove(quarantinePath);
      } catch (error) {
        if (isMissing(error)) continue;
        throw new ResourceError(
          'RESOURCE_OWNER_CONFLICT',
          'Resource Store ownership changed during recovery.',
        );
      }
    }

    throw new ResourceError(
      'RESOURCE_OWNER_CONFLICT',
      'Resource Store ownership could not be established.',
    );
  });
}
