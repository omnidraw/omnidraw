import { describe, expect, test } from 'bun:test';
import { dirname, join, resolve } from 'path';
import { fnBuildUninstallPlan } from '../../../../src/plugins/cli/core/fn.uninstall-plan';

const portal = { dirname, join, resolve };

describe('fnBuildUninstallPlan', () => {
  test('selects curl install files and XDG Vibecanvas directories', () => {
    const plan = fnBuildUninstallPlan(portal, {
      homedir: '/home/tester',
      env: {},
      execPath: '/home/tester/.vibecanvas/bin/vibecanvas',
      dbPath: '/home/tester/.local/share/vibecanvas/vibecanvas.turso',
      xdgPaths: {
        dataDirPath: '/home/tester/.local/share/vibecanvas',
        configDirPath: '/home/tester/.config/vibecanvas',
        stateDirPath: '/home/tester/.local/state/vibecanvas',
        cacheDirPath: '/home/tester/.cache/vibecanvas',
      },
    });

    expect(plan.removeTargets.map((target) => [target.kind, target.path])).toEqual([
      ['binary', '/home/tester/.vibecanvas/bin/vibecanvas'],
      ['native-dir', '/home/tester/.vibecanvas/native'],
      ['migrations-dir', '/home/tester/.vibecanvas/database-migrations'],
      ['install-dir', '/home/tester/.vibecanvas/bin'],
      ['data-dir', '/home/tester/.local/share/vibecanvas'],
      ['config-dir', '/home/tester/.config/vibecanvas'],
      ['state-dir', '/home/tester/.local/state/vibecanvas'],
      ['cache-dir', '/home/tester/.cache/vibecanvas'],
      ['database-file', '/home/tester/.local/share/vibecanvas/vibecanvas.turso'],
    ]);
    expect(plan.skippedTargets).toEqual([]);
  });

  test('skips arbitrary config and database override parent directories', () => {
    const plan = fnBuildUninstallPlan(portal, {
      homedir: '/home/tester',
      env: {},
      execPath: '/usr/local/bin/node',
      dbPath: '/projects/demo/dev.sqlite',
      xdgPaths: {
        dataDirPath: '/projects/demo',
        configDirPath: '/projects/demo',
        stateDirPath: '/projects/demo',
        cacheDirPath: '/projects/demo',
      },
    });

    expect(plan.removeTargets.some((target) => target.path === '/projects/demo')).toBe(false);
    expect(plan.removeTargets.some((target) => target.path === '/projects/demo/dev.sqlite')).toBe(false);
    expect(plan.skippedTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'data-dir', path: '/projects/demo' }),
      expect.objectContaining({ kind: 'database-file', path: '/projects/demo/dev.sqlite' }),
    ]));
  });

  test('honors installer environment overrides', () => {
    const plan = fnBuildUninstallPlan(portal, {
      homedir: '/home/tester',
      env: {
        VIBECANVAS_INSTALL_DIR: '/opt/vibecanvas/bin',
        VIBECANVAS_NATIVE_DIR: '/opt/vibecanvas/native-addons',
        VIBECANVAS_MIGRATIONS_DIR: '/opt/vibecanvas/migrations',
      },
      execPath: '/opt/vibecanvas/bin/vibecanvas',
      dbPath: '/home/tester/.local/share/vibecanvas/vibecanvas.turso',
      xdgPaths: {
        dataDirPath: '/home/tester/.local/share/vibecanvas',
        configDirPath: '/home/tester/.config/vibecanvas',
        stateDirPath: '/home/tester/.local/state/vibecanvas',
        cacheDirPath: '/home/tester/.cache/vibecanvas',
      },
    });

    expect(plan.removeTargets).toEqual(expect.arrayContaining([
      { kind: 'binary', path: '/opt/vibecanvas/bin/vibecanvas', missingOk: true },
      { kind: 'native-dir', path: '/opt/vibecanvas/native-addons', missingOk: true },
      { kind: 'migrations-dir', path: '/opt/vibecanvas/migrations', missingOk: true },
    ]));
  });

  test('evaluates configuration and data roots independently', () => {
    const unsafeDataPlan = fnBuildUninstallPlan(portal, {
      homedir: '/home/tester',
      env: {},
      execPath: '/home/tester/.vibecanvas/bin/vibecanvas',
      dbPath: '/projects/custom-data/vibecanvas.turso',
      xdgPaths: {
        dataDirPath: '/projects/custom-data',
        configDirPath: '/home/tester/.config/vibecanvas',
        stateDirPath: '/home/tester/.local/state/vibecanvas',
        cacheDirPath: '/home/tester/.cache/vibecanvas',
      },
    });

    expect(unsafeDataPlan.removeTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'config-dir', path: '/home/tester/.config/vibecanvas' }),
    ]));
    expect(unsafeDataPlan.removeTargets.some((target) => target.kind === 'data-dir')).toBe(false);
    expect(unsafeDataPlan.skippedTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'data-dir', path: '/projects/custom-data' }),
      expect.objectContaining({ kind: 'database-file', path: '/projects/custom-data/vibecanvas.turso' }),
    ]));

    const unsafeConfigPlan = fnBuildUninstallPlan(portal, {
      homedir: '/home/tester',
      env: {},
      execPath: '/home/tester/.vibecanvas/bin/vibecanvas',
      dbPath: '/home/tester/.local/share/vibecanvas/vibecanvas.turso',
      xdgPaths: {
        dataDirPath: '/home/tester/.local/share/vibecanvas',
        configDirPath: '/projects/custom-config',
        stateDirPath: '/home/tester/.local/state/vibecanvas',
        cacheDirPath: '/home/tester/.cache/vibecanvas',
      },
    });

    expect(unsafeConfigPlan.removeTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'data-dir', path: '/home/tester/.local/share/vibecanvas' }),
      expect.objectContaining({ kind: 'database-file', path: '/home/tester/.local/share/vibecanvas/vibecanvas.turso' }),
    ]));
    expect(unsafeConfigPlan.removeTargets.some((target) => target.kind === 'config-dir')).toBe(false);
    expect(unsafeConfigPlan.skippedTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'config-dir', path: '/projects/custom-config' }),
    ]));
  });
});
