import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { txRestoreNpmPackageLock } from '../src/tools/tx.npm-install';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(
    (root) => rm(root, { recursive: true, force: true }),
  ));
});

describe('npm package-lock rollback', () => {
  test('restores the exact previous lockfile bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-npm-lock-rollback-'));
    roots.push(root);
    const path = join(root, 'package-lock.json');
    const previous = new TextEncoder().encode('{"lockfileVersion":3}\n');
    await writeFile(path, '{"changed":true}\n');

    await txRestoreNpmPackageLock({ writeFile, rename, rm }, {
      state: { path, bytes: previous },
    });

    expect(await readFile(path, 'utf8')).toBe('{"lockfileVersion":3}\n');
  });

  test('removes a lockfile that did not exist before installation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-npm-lock-rollback-'));
    roots.push(root);
    const path = join(root, 'package-lock.json');
    await writeFile(path, '{"created":true}\n');

    await txRestoreNpmPackageLock({ writeFile, rename, rm }, {
      state: { path, bytes: null },
    });

    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
