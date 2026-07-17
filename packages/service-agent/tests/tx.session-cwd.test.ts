import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { txNormalizeSessionCwd } from '../src/core/tx.session-cwd';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('txNormalizeSessionCwd', () => {
  test('updates only transcript headers and preserves historical entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-session-cwd-'));
    roots.push(root);
    const sessionDir = join(root, 'sessions', 'chat-a');
    await mkdir(sessionDir, { recursive: true });
    const path = join(sessionDir, 'history.jsonl');
    const message = { type: 'message', id: 'message-1', parentId: null, timestamp: 'now', message: { role: 'user', content: 'hello' } };
    await writeFile(path, [
      JSON.stringify({ type: 'session', version: 3, id: 'provider-a', timestamp: 'now', cwd: '/legacy/widget-cwd/session' }),
      JSON.stringify(message),
      '',
    ].join('\n'), 'utf8');

    expect(await txNormalizeSessionCwd({ readdir, readFile, writeFile, rename, rm, join }, {
      sessionDir,
      cwd: join(root, 'chat-cwd', 'chat-a'),
    })).toBe(1);
    const lines = (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines[0].cwd).toBe(join(root, 'chat-cwd', 'chat-a'));
    expect(lines[1]).toEqual(message);
  });
});
