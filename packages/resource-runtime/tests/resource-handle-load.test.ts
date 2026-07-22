import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from '@tursodatabase/database';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DB_RESOURCE_DEFAULT_IDLE_HANDLE_TIMEOUT_MS,
  DB_RESOURCE_DEFAULT_MAX_OPEN_HANDLES,
  DbResource,
  RESOURCE_KEY_VALUE_DEFAULT_IDLE_HANDLE_TIMEOUT_MS,
  RESOURCE_KEY_VALUE_DEFAULT_MAX_OPEN_HANDLES,
  ResourceKeyValueStore,
  type TDatabaseFactory,
  type TResourceIdleSweepScheduler,
  type TResourceKeyValueDatabaseFactory,
} from '../src/local';

const MAX_OPEN_HANDLES = 32;
const RESOURCE_COUNT = 40;
const IDLE_HANDLE_TIMEOUT_MS = 60_000;
const roots: string[] = [];

const tenant = {
  orgId: 'org-load',
  accountId: 'account-load',
  cellId: 'cell-load',
  placementEpoch: 1,
  roles: ['member'],
  capabilities: [],
  requestId: 'request-load',
} as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `vibecanvas-${label}-`));
  roots.push(root);
  return root;
}

function createManualIdleClock(): Readonly<{
  advanceTo: (nowMs: number) => Promise<void>;
  nowMs: () => number;
  scheduledDueAtMs: () => number | null;
  scheduleIdleSweep: TResourceIdleSweepScheduler;
}> {
  let currentNowMs = 0;
  let scheduled: Readonly<{
    callback: () => void | Promise<void>;
    dueAtMs: number;
  }> | null = null;
  const scheduleIdleSweep: TResourceIdleSweepScheduler = (callback, delayMs) => {
    const entry = Object.freeze({ callback, dueAtMs: currentNowMs + delayMs });
    scheduled = entry;
    return () => {
      if (scheduled === entry) scheduled = null;
    };
  };
  return {
    nowMs: () => currentNowMs,
    scheduledDueAtMs: () => scheduled?.dueAtMs ?? null,
    scheduleIdleSweep,
    advanceTo: async (nowMs) => {
      currentNowMs = nowMs;
      const entry = scheduled;
      if (!entry) throw new Error('Expected a required idle-handle sweep to be scheduled.');
      if (currentNowMs < entry.dueAtMs) {
        throw new Error(`Idle-handle sweep ran ${entry.dueAtMs - currentNowMs}ms before its requested delay.`);
      }
      scheduled = null;
      await entry.callback();
    },
  };
}

function recordFactoryOpen(openCounts: Map<string, number>, databasePath: string): void {
  openCounts.set(databasePath, (openCounts.get(databasePath) ?? 0) + 1);
}

describe('M10 bounded resource handle load', () => {
  test('bounds KV handles across many inactive resources, evicts LRU handles, and idle-closes to zero', async () => {
    expect(RESOURCE_KEY_VALUE_DEFAULT_MAX_OPEN_HANDLES).toBe(MAX_OPEN_HANDLES);
    expect(RESOURCE_KEY_VALUE_DEFAULT_IDLE_HANDLE_TIMEOUT_MS).toBe(IDLE_HANDLE_TIMEOUT_MS);
    const dataRoot = await temporaryRoot('kv-handle-load');
    const resourceIds = Array.from({ length: RESOURCE_COUNT }, (_, index) => `kv-${index}`);
    const openCounts = new Map<string, number>();
    const clock = createManualIdleClock();
    const databaseFactory: TResourceKeyValueDatabaseFactory = (databasePath, options) => {
      recordFactoryOpen(openCounts, databasePath);
      return new Database(databasePath, options as ConstructorParameters<typeof Database>[1]);
    };
    const store = new ResourceKeyValueStore({
      dataRoot,
      kind: 'kv',
      databaseFactory,
      nowMs: clock.nowMs,
      scheduleIdleSweep: clock.scheduleIdleSweep,
    });

    try {
      for (const resourceId of resourceIds) {
        await store.provision({ resourceId, kind: 'kv' });
        expect(store.openHandleCount).toBe(0);
      }

      let peakOpenHandleCount = 0;
      for (const resourceId of resourceIds) {
        await expect(store.get({ resourceId, key: 'missing' })).resolves.toBeNull();
        peakOpenHandleCount = Math.max(peakOpenHandleCount, store.openHandleCount);
        expect(store.openHandleCount).toBeLessThanOrEqual(MAX_OPEN_HANDLES);
      }
      expect(peakOpenHandleCount).toBe(MAX_OPEN_HANDLES);
      expect(store.openHandleCount).toBe(MAX_OPEN_HANDLES);

      const newestPath = join(dataRoot, resourceIds.at(-1)!, 'data.db');
      const oldestPath = join(dataRoot, resourceIds[0]!, 'data.db');
      const newestOpenCount = openCounts.get(newestPath);
      const oldestOpenCount = openCounts.get(oldestPath) ?? 0;
      await store.get({ resourceId: resourceIds.at(-1)!, key: 'cached' });
      expect(openCounts.get(newestPath)).toBe(newestOpenCount);
      await store.get({ resourceId: resourceIds[0]!, key: 'reopened' });
      expect(openCounts.get(oldestPath)).toBe(oldestOpenCount + 1);
      expect(store.openHandleCount).toBe(MAX_OPEN_HANDLES);
      expect(clock.scheduledDueAtMs()).toBe(IDLE_HANDLE_TIMEOUT_MS);

      await clock.advanceTo(IDLE_HANDLE_TIMEOUT_MS);
      expect(store.openHandleCount).toBe(0);
      await store.get({ resourceId: resourceIds[0]!, key: 'after-idle' });
      expect(store.openHandleCount).toBe(1);
    } finally {
      await store.close();
    }
    expect(store.openHandleCount).toBe(0);
  }, 30_000);

  test('bounds DbResource handles across many inactive resources, evicts LRU handles, and idle-closes to zero', async () => {
    expect(DB_RESOURCE_DEFAULT_MAX_OPEN_HANDLES).toBe(MAX_OPEN_HANDLES);
    expect(DB_RESOURCE_DEFAULT_IDLE_HANDLE_TIMEOUT_MS).toBe(IDLE_HANDLE_TIMEOUT_MS);
    const dataRoot = await temporaryRoot('db-handle-load');
    const resourceIds = Array.from({ length: RESOURCE_COUNT }, (_, index) => `db-${index}`);
    const openCounts = new Map<string, number>();
    const clock = createManualIdleClock();
    const databaseFactory: TDatabaseFactory = (databasePath, options) => {
      recordFactoryOpen(openCounts, databasePath);
      return new Database(databasePath, options);
    };
    const provider = new DbResource({
      db: { dbResource: { draft: { list: async () => [] } } },
      dataRoot,
      databaseFactory,
      nowMs: clock.nowMs,
      scheduleIdleSweep: clock.scheduleIdleSweep,
    });
    const context = (resourceId: string) => ({
      tenant,
      resource: { id: resourceId, kind: 'db' as const },
      requirement: {
        kind: 'db' as const,
        required: true,
        scope: ['read', 'write'] as const,
        arbitrarySql: true,
      },
      canRead: true,
      canWrite: true,
    });

    try {
      for (const resourceId of resourceIds) {
        await provider.provision({ id: resourceId, kind: 'db' }, {});
        expect(provider.openHandleCount).toBe(0);
      }

      let peakOpenHandleCount = 0;
      for (const resourceId of resourceIds) {
        await provider.dispatch(context(resourceId), 'execute', {
          sql: 'CREATE TABLE IF NOT EXISTS load_probe (value INTEGER) STRICT',
        });
        peakOpenHandleCount = Math.max(peakOpenHandleCount, provider.openHandleCount);
        expect(provider.openHandleCount).toBeLessThanOrEqual(MAX_OPEN_HANDLES);
      }
      expect(peakOpenHandleCount).toBe(MAX_OPEN_HANDLES);
      expect(provider.openHandleCount).toBe(MAX_OPEN_HANDLES);

      const newestPath = join(dataRoot, resourceIds.at(-1)!, 'data.db');
      const oldestPath = join(dataRoot, resourceIds[0]!, 'data.db');
      const newestOpenCount = openCounts.get(newestPath);
      const oldestOpenCount = openCounts.get(oldestPath) ?? 0;
      await provider.dispatch(context(resourceIds.at(-1)!), 'execute', {
        sql: 'CREATE TABLE IF NOT EXISTS load_probe (value INTEGER) STRICT',
      });
      expect(openCounts.get(newestPath)).toBe(newestOpenCount);
      await provider.dispatch(context(resourceIds[0]!), 'execute', {
        sql: 'CREATE TABLE IF NOT EXISTS load_probe (value INTEGER) STRICT',
      });
      expect(openCounts.get(oldestPath)).toBe(oldestOpenCount + 1);
      expect(provider.openHandleCount).toBe(MAX_OPEN_HANDLES);
      expect(clock.scheduledDueAtMs()).toBe(IDLE_HANDLE_TIMEOUT_MS);

      await clock.advanceTo(IDLE_HANDLE_TIMEOUT_MS);
      expect(provider.openHandleCount).toBe(0);
      await provider.dispatch(context(resourceIds[0]!), 'execute', {
        sql: 'CREATE TABLE IF NOT EXISTS load_probe (value INTEGER) STRICT',
      });
      expect(provider.openHandleCount).toBe(1);
    } finally {
      await provider.close();
    }
    expect(provider.openHandleCount).toBe(0);
  }, 30_000);
});
