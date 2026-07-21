import { describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'path';
import { fnResolveVibecanvasHome } from '../src/vibecanvas-config/fn.resolve-vibecanvas-home';
import { txEnsureVibecanvasHome } from '../src/vibecanvas-config/tx.ensure-vibecanvas-home';

describe('txEnsureVibecanvasHome', () => {
  test('creates every directory with restrictive permissions and returns the frozen config', () => {
    const home = fnResolveVibecanvasHome({ join, resolve }, {
      cwd: '/work',
      dataDir: '/var/lib/vibecanvas',
      env: {},
      homedir: '/home/tester',
    });
    const mkdirSync = mock(() => undefined);

    const result = txEnsureVibecanvasHome({ mkdirSync }, { home });
    const mkdirCalls = mkdirSync.mock.calls as unknown as Array<[
      string,
      { recursive: boolean; mode: number },
    ]>;

    expect(result).toBe(home);
    expect(Object.isFrozen(result)).toBe(true);
    expect(mkdirCalls.map(([path]) => path)).toEqual([
      home.homeDir,
      home.organizationsDir,
      home.defaultOrganizationRoot,
      home.agentRoot,
      home.artifactsRoot,
      home.resourcesRoot,
      home.tempRoot,
      home.ptyRoot,
      home.cacheRoot,
      home.logsRoot,
    ]);
    expect(mkdirCalls.every(([, options]) => (
      options?.recursive === true && options.mode === 0o700
    ))).toBe(true);
  });

  test('creates the resolved layout on disk with owner-only permissions where supported', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'vibecanvas-home-'));
    const home = fnResolveVibecanvasHome({ join, resolve }, {
      cwd: tempRoot,
      dataDir: './selected-home',
      env: {},
      homedir: tempRoot,
    });

    try {
      txEnsureVibecanvasHome({ mkdirSync }, { home });

      const directories = [
        home.homeDir,
        home.organizationsDir,
        home.defaultOrganizationRoot,
        home.agentRoot,
        home.artifactsRoot,
        home.resourcesRoot,
        home.tempRoot,
        home.ptyRoot,
        home.cacheRoot,
        home.logsRoot,
      ];
      expect(directories.every((directory) => statSync(directory).isDirectory())).toBe(true);
      if (process.platform !== 'win32') {
        expect(directories.every((directory) => (statSync(directory).mode & 0o777) === 0o700)).toBe(true);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
