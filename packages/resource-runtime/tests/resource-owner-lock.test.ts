import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ResourceError } from '../src';
import { claimResourceOwner } from '../src/local/ResourceOwnerLock';

async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let value = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) throw new Error('Owner contender exited without a result.');
      value += decoder.decode(next.value, { stream: true });
      const newline = value.indexOf('\n');
      if (newline >= 0) return value.slice(0, newline);
    }
  } finally {
    reader.releaseLock();
  }
}

type TContenderChild = Readonly<{
  process: ReturnType<typeof Bun.spawn>;
  stdin: { write(value: string): unknown; flush(): unknown };
  stdout: ReadableStream<Uint8Array>;
}>;

describe('local Resource Store ownership', () => {
  test('admits one owner and rejects a second live owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-owner-'));
    try {
      const first = await claimResourceOwner({ root, ownerId: 'store-a' });
      await expect(claimResourceOwner({ root, ownerId: 'store-b' })).rejects.toMatchObject({
        code: 'RESOURCE_OWNER_CONFLICT',
      });
      await first.release();
      const second = await claimResourceOwner({ root, ownerId: 'store-b' });
      await second.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('takes over a fenced stale owner and does not let its old lease unlink the winner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-owner-'));
    let nowMs = 20_000;
    try {
      const first = await claimResourceOwner({
        root,
        ownerId: 'store-a',
        portal: {
          randomUUID: () => crypto.randomUUID(),
          pid: 101,
          nowMs: () => nowMs,
          isProcessAlive: () => false,
          mkdir: (path, options) => import('node:fs/promises').then((fs) => fs.mkdir(path, options)),
          openExclusive: async (path, content) => {
            const handle = await import('node:fs/promises').then((fs) => fs.open(path, 'wx', 0o600));
            try { await handle.writeFile(content); } finally { await handle.close(); }
          },
          readText: (path) => readFile(path, 'utf8'),
          modifiedAtMs: async (path) => (await import('node:fs/promises').then((fs) => fs.stat(path))).mtimeMs,
          rename: (from, to) => import('node:fs/promises').then((fs) => fs.rename(from, to)),
          remove: (path) => rm(path, { force: true }),
        },
      });
      nowMs += 20_000;
      const second = await claimResourceOwner({
        root,
        ownerId: 'store-b',
        portal: {
          randomUUID: () => crypto.randomUUID(),
          pid: 202,
          nowMs: () => nowMs,
          isProcessAlive: () => false,
          mkdir: (path, options) => import('node:fs/promises').then((fs) => fs.mkdir(path, options)),
          openExclusive: async (path, content) => {
            const handle = await import('node:fs/promises').then((fs) => fs.open(path, 'wx', 0o600));
            try { await handle.writeFile(content); } finally { await handle.close(); }
          },
          readText: (path) => readFile(path, 'utf8'),
          modifiedAtMs: async (path) => (await import('node:fs/promises').then((fs) => fs.stat(path))).mtimeMs,
          rename: (from, to) => import('node:fs/promises').then((fs) => fs.rename(from, to)),
          remove: (path) => rm(path, { force: true }),
        },
      });

      await first.release();
      const stored = JSON.parse(await readFile(second.path, 'utf8')) as { ownerId: string };
      expect(stored.ownerId).toBe('store-b');
      await second.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('fails closed for a recent malformed lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-owner-'));
    try {
      await writeFile(join(root, '.vibecanvas-resource-owner'), 'incomplete', { mode: 0o600 });
      await expect(claimResourceOwner({ root, ownerId: 'store-a' })).rejects.toBeInstanceOf(ResourceError);
      await expect(claimResourceOwner({ root, ownerId: 'store-a' })).rejects.toMatchObject({
        code: 'RESOURCE_OWNER_CONFLICT',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('serializes simultaneous stale-owner takeovers so exactly one contender wins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-owner-'));
    try {
      await writeFile(join(root, '.vibecanvas-resource-owner'), JSON.stringify({
        version: 1,
        ownerId: 'dead-store',
        pid: 2_147_483_647,
        token: 'dead-token',
        claimedAtMs: 1,
      }));

      const results = await Promise.allSettled([
        claimResourceOwner({ root, ownerId: 'store-a' }),
        claimResourceOwner({ root, ownerId: 'store-b' }),
      ]);
      const winners = results.filter((result) => result.status === 'fulfilled');
      const losers = results.filter((result) => result.status === 'rejected');

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      const winner = winners[0];
      if (winner?.status !== 'fulfilled') throw new Error('Expected one Resource Store owner.');
      await winner.value.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('fences simultaneous stale takeover across independent processes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-owner-'));
    const children: TContenderChild[] = [];
    try {
      await writeFile(join(root, '.vibecanvas-resource-owner'), JSON.stringify({
        version: 1,
        ownerId: 'dead-store',
        pid: 2_147_483_647,
        token: 'dead-token',
        claimedAtMs: 1,
      }));
      for (const ownerId of ['process-a', 'process-b']) {
        const process = Bun.spawn([
          'bun',
          'run',
          'packages/resource-runtime/tests/fixtures/resource-owner-contender.ts',
          root,
          ownerId,
        ], {
          cwd: join(import.meta.dir, '../../..'),
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        });
        children.push({
          process,
          stdin: process.stdin as TContenderChild['stdin'],
          stdout: process.stdout as TContenderChild['stdout'],
        });
      }

      const results = await Promise.all(children.map(async (child) => (
        JSON.parse(await readLine(child.stdout)) as {
          readonly status: string;
          readonly ownerId: string;
          readonly code?: string;
        }
      )));
      expect(results.filter((result) => result.status === 'won')).toHaveLength(1);
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.code).toBe('RESOURCE_OWNER_CONFLICT');

      const winnerIndex = results.findIndex((result) => result.status === 'won');
      children[winnerIndex]?.stdin.write('release\n');
      children[winnerIndex]?.stdin.flush();
      await Promise.all(children.map((child) => child.process.exited));
    } finally {
      for (const child of children) {
        child.process.kill();
        await child.process.exited;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});
