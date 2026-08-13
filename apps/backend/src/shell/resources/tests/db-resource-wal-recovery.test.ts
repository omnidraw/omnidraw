import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from '@tursodatabase/database';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DbResource, type TDatabaseFactory } from '../local';

const REPO_ROOT = resolve(import.meta.dir, '../../../../../..');
const RESOURCE_ID = 'wal-recovery-resource';
const temporaryRoots: string[] = [];
const children = new Set<ReturnType<typeof Bun.spawn>>();

type TWalCrashCheckpoint = Readonly<{
  type: 'wal-crash-checkpoint';
  pid: number;
  journalMode: Record<string, unknown>;
  checkpointResult: Record<string, unknown>;
  committedWalBytes: number;
  committedWalFrames: number;
  interruptedWalBytes: number;
  interruptedWalFrames: number;
  writerRows: readonly Record<string, unknown>[];
  observerRows: readonly Record<string, unknown>[];
  dbResourceExperimental: readonly string[];
}>;

const resource = { id: RESOURCE_ID, kind: 'db' as const };
const requirement = {
  kind: 'db' as const,
  required: true,
  scope: ['read', 'write'] as const,
  arbitrarySql: true,
};
const context = {
  resource,
  requirement,
  canRead: true,
  canWrite: true,
};
const controlStore = {
  dbResource: {
    draft: {
      list: async () => [],
    },
  },
};
const databaseFactory: TDatabaseFactory = (databasePath, options) => new Database(databasePath, options);
const scheduleIdleSweep = (callback: () => void | Promise<void>, delayMs: number) => {
  const handle = setTimeout(() => void callback(), delayMs);
  return () => clearTimeout(handle);
};

async function readLine(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let value = '';
  while (true) {
    const next = await reader.read();
    if (next.done) throw new Error('Interrupted WAL writer exited before reaching its crash checkpoint.');
    value += decoder.decode(next.value, { stream: true });
    const newline = value.indexOf('\n');
    if (newline >= 0) return value.slice(0, newline);
  }
}

async function waitForCheckpoint(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<TWalCrashCheckpoint> {
  return Promise.race([
    readLine(reader).then((line) => JSON.parse(line) as TWalCrashCheckpoint),
    Bun.sleep(10_000).then(() => {
      throw new Error('Timed out waiting for the resource WAL crash checkpoint.');
    }),
  ]);
}

afterEach(async () => {
  for (const child of children) {
    child.kill(9);
    await child.exited;
  }
  children.clear();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local DbResource WAL recovery', () => {
  test('recovers committed frames and discards a killed transaction after restart', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'omnidraw-resource-wal-'));
    temporaryRoots.push(dataRoot);
    const fixturePath = join(import.meta.dir, 'fixtures', 'db-resource-wal-interrupted-writer.ts');
    const bunExecutable = Bun.which('bun') ?? process.execPath;
    const writer = Bun.spawn([bunExecutable, fixturePath, dataRoot, RESOURCE_ID], {
      cwd: REPO_ROOT,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    children.add(writer);
    const reader = writer.stdout.getReader();

    let checkpoint: TWalCrashCheckpoint;
    try {
      checkpoint = await waitForCheckpoint(reader);
    } catch (error) {
      writer.kill(9);
      await writer.exited;
      children.delete(writer);
      const stderr = await new Response(writer.stderr).text();
      throw new Error(`WAL writer failed before checkpoint: ${stderr}`, { cause: error });
    } finally {
      reader.releaseLock();
    }

    expect(checkpoint.type).toBe('wal-crash-checkpoint');
    expect(checkpoint.pid).toBe(writer.pid);
    expect(Object.values(checkpoint.journalMode)).toContain('wal');
    expect(Object.values(checkpoint.checkpointResult).every((value) => Number(value) === 0)).toBe(true);
    expect(checkpoint.committedWalBytes).toBeGreaterThan(32);
    expect(checkpoint.committedWalFrames).toBeGreaterThan(0);
    expect(Number.isInteger(checkpoint.committedWalFrames)).toBe(true);
    expect(checkpoint.interruptedWalBytes).toBeGreaterThanOrEqual(checkpoint.committedWalBytes);
    expect(checkpoint.interruptedWalFrames).toBeGreaterThanOrEqual(checkpoint.committedWalFrames);
    expect(Number.isInteger(checkpoint.interruptedWalFrames)).toBe(true);
    expect(checkpoint.writerRows).toEqual([
      { id: '1', label: 'committed' },
      { id: '2', label: 'uncommitted' },
    ]);
    expect(checkpoint.observerRows).toEqual([
      { id: '1', label: 'committed' },
    ]);
    expect(checkpoint.dbResourceExperimental).toContain('multiprocess_wal');

    writer.kill(9);
    const exitCode = await writer.exited;
    children.delete(writer);
    expect(exitCode).not.toBe(0);

    const recovered = new DbResource({
      db: controlStore,
      dataRoot,
      databaseFactory,
      nowMs: Date.now,
      scheduleIdleSweep,
    });
    try {
      await expect(recovered.reconcile(resource)).resolves.toEqual({ status: 'ready' });
      await expect(recovered.dispatch(context, 'query', {
        sql: 'PRAGMA integrity_check',
      })).resolves.toEqual([{ integrity_check: 'ok' }]);
      await expect(recovered.dispatch(context, 'query', {
        sql: 'SELECT id, label, hex(payload) AS payload FROM recovery_rows ORDER BY id',
      })).resolves.toEqual([{
        id: 1n,
        label: 'committed',
        payload: '636F6D6D6974746564',
      }]);
    } finally {
      await recovered.close();
    }
  }, 20_000);
});
