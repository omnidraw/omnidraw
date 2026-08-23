import { describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'path';
import { fnResolveOmnidrawHome } from '#backend/shell/config/fn.resolve-omnidraw-home';
import { ensureOmnidrawHome } from '#backend/shell/config/ensure-omnidraw-home';

describe('ensureOmnidrawHome', () => {
  test('creates every directory with restrictive permissions and returns the frozen config', () => {
    const home = fnResolveOmnidrawHome({ join, resolve }, {
      cwd: '/work',
      dataDir: '/var/lib/omnidraw',
      env: {},
      homedir: '/home/tester',
    });
    const mkdirSync = mock(() => undefined);

    const result = ensureOmnidrawHome({ mkdirSync }, { home });
    const mkdirCalls = mkdirSync.mock.calls as unknown as Array<[
      string,
      { recursive: boolean; mode: number },
    ]>;

    expect(result).toBe(home);
    expect(Object.isFrozen(result)).toBe(true);
    expect(mkdirCalls.map(([path]) => path)).toEqual([
      home.homeDir,
      home.agentRoot,
      home.resourcesRoot,
      home.tempRoot,
      home.cacheRoot,
      home.logsRoot,
      home.keysRoot,
      home.widgetsRoot,
      home.widgetDraftsRoot,
      home.widgetPublishedRoot,
      home.widgetStagingRoot,
      home.widgetPreviewRoot,
      home.widgetTrashRoot,
      home.widgetQuarantineRoot,
    ]);
    expect(mkdirCalls.every(([, options]) => (
      options?.recursive === true && options.mode === 0o700
    ))).toBe(true);
  });

  test('creates the resolved layout on disk with owner-only permissions where supported', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'omnidraw-home-'));
    const home = fnResolveOmnidrawHome({ join, resolve }, {
      cwd: tempRoot,
      dataDir: './selected-home',
      env: {},
      homedir: tempRoot,
    });

    try {
      ensureOmnidrawHome({ mkdirSync }, { home });

      const directories = [
        home.homeDir,
        home.agentRoot,
        home.resourcesRoot,
        home.tempRoot,
        home.cacheRoot,
        home.logsRoot,
        home.keysRoot,
        home.widgetsRoot,
        home.widgetDraftsRoot,
        home.widgetPublishedRoot,
        home.widgetStagingRoot,
        home.widgetPreviewRoot,
        home.widgetTrashRoot,
        home.widgetQuarantineRoot,
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
