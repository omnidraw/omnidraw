import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { txRemoveEmptyDirs, txRemoveUninstallTargets } from '../../../../src/plugins/cli/core/tx.uninstall';

const tempRoots = new Set<string>();
const portal = { existsSync, lstatSync, readdirSync, rmSync, rmdirSync };

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vibecanvas-uninstall-test-'));
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
    const ownedDir = join(root, 'vibecanvas');
    const keptDir = join(root, 'project');
    const ownedFile = join(ownedDir, 'vibecanvas.turso');
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
    const installRoot = join(root, '.vibecanvas');
    const binDir = join(installRoot, 'bin');
    const binary = join(binDir, 'vibecanvas');

    mkdirSync(binDir, { recursive: true });
    writeFileSync(binary, 'bin');

    txRemoveUninstallTargets(portal, { paths: [binary, binDir] });
    const result = txRemoveEmptyDirs(portal, { paths: [installRoot] });

    expect(result.removed).toEqual([installRoot]);
    expect(existsSync(installRoot)).toBe(false);
  });
});
