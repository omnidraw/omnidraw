import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { txRemoveEmptyDirs, txRemoveUninstallTargets } from '../../../../src/plugins/cli/core/tx.uninstall';

const tempRoots = new Set<string>();
const portal = { existsSync, lstatSync, readdirSync, rmSync, rmdirSync };

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-uninstall-test-'));
  tempRoots.add(root);
  return root;
}

afterEach(async () => {
  await Promise.all([...tempRoots].map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.clear();
});

describe('txRemoveUninstallTargets', () => {
  test('removes requested files and directories only', async () => {
    const root = await createTempRoot();
    const ownedDir = join(root, 'omnidraw');
    const keptDir = join(root, 'project');
    const ownedFile = join(ownedDir, 'omnidraw.turso');
    const keptFile = join(keptDir, 'notes.txt');

    mkdirSync(ownedDir, { recursive: true });
    mkdirSync(keptDir, { recursive: true });
    writeFileSync(ownedFile, 'db');
    writeFileSync(keptFile, 'keep');

    const result = txRemoveUninstallTargets(portal, { paths: [ownedDir] });

    expect(result.failed).toEqual([]);
    expect(result.removed).toEqual([ownedDir]);
    expect(existsSync(ownedDir)).toBe(false);
    expect(existsSync(keptFile)).toBe(true);
  });

  test('removes empty directories after target deletion', async () => {
    const root = await createTempRoot();
    const installRoot = join(root, '.omnidraw');
    const binDir = join(installRoot, 'bin');
    const binary = join(binDir, 'omnidraw');

    mkdirSync(binDir, { recursive: true });
    writeFileSync(binary, 'bin');

    txRemoveUninstallTargets(portal, { paths: [binary, binDir] });
    const result = txRemoveEmptyDirs(portal, { paths: [installRoot] });

    expect(result.removed).toEqual([installRoot]);
    expect(existsSync(installRoot)).toBe(false);
  });

  test('continues removing safe targets after one target fails', async () => {
    const root = await createTempRoot();
    const failingDir = join(root, 'failing', 'omnidraw');
    const removableDir = join(root, 'removable', 'omnidraw');
    mkdirSync(failingDir, { recursive: true });
    mkdirSync(removableDir, { recursive: true });
    writeFileSync(join(failingDir, 'data.db'), 'keep');
    writeFileSync(join(removableDir, 'cache.txt'), 'remove');
    const attempted: string[] = [];
    const failingPortal = {
      ...portal,
      rmSync(path: string, options: Parameters<typeof rmSync>[1]) {
        attempted.push(path);
        if (path === failingDir) throw new Error('injected removal failure');
        rmSync(path, options);
      },
    };

    const result = txRemoveUninstallTargets(failingPortal, {
      paths: [failingDir, removableDir],
    });

    expect(result.failed).toEqual([{ path: failingDir, message: 'injected removal failure' }]);
    expect(result.removed).toEqual([removableDir]);
    expect(attempted).toEqual([failingDir, removableDir]);
    expect(existsSync(join(failingDir, 'data.db'))).toBe(true);
    expect(existsSync(removableDir)).toBe(false);
  });
});
