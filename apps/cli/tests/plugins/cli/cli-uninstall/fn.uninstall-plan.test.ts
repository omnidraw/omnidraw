import { describe, expect, test } from 'bun:test';
import { dirname, join, resolve } from 'path';
import { fnBuildUninstallPlan } from '../../../../src/plugins/cli/core/fn.uninstall-plan';

const portal = { dirname, join, resolve };

describe('fnBuildUninstallPlan', () => {
  test('selects curl install files and the unified Vibecanvas home', () => {
    const plan = fnBuildUninstallPlan(portal, {
      homedir: '/home/tester',
      env: {},
      execPath: '/home/tester/.vibecanvas/bin/vibecanvas',
      vibecanvasHomeDir: '/home/tester/.vibecanvas',
    });

    expect(plan.removeTargets.map((target) => [target.kind, target.path])).toEqual([
      ['binary', '/home/tester/.vibecanvas/bin/vibecanvas'],
      ['native-dir', '/home/tester/.vibecanvas/native'],
      ['migrations-dir', '/home/tester/.vibecanvas/database-migrations'],
      ['install-dir', '/home/tester/.vibecanvas/bin'],
      ['home-dir', '/home/tester/.vibecanvas'],
    ]);
    expect(plan.skippedTargets).toEqual([]);
  });

  test('does not recursively remove an arbitrary custom override', () => {
    const plan = fnBuildUninstallPlan(portal, {
      homedir: '/home/tester',
      env: {},
      execPath: '/usr/local/bin/node',
      vibecanvasHomeDir: '/projects/demo',
    });

    expect(plan.removeTargets.some((target) => target.path === '/projects/demo')).toBe(false);
    expect(plan.skippedTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'home-dir', path: '/projects/demo' }),
    ]));
  });

  test('honors installer environment overrides independently of the home', () => {
    const plan = fnBuildUninstallPlan(portal, {
      homedir: '/home/tester',
      env: {
        VIBECANVAS_INSTALL_DIR: '/opt/vibecanvas/bin',
        VIBECANVAS_NATIVE_DIR: '/opt/vibecanvas/native-addons',
        VIBECANVAS_MIGRATIONS_DIR: '/opt/vibecanvas/migrations',
      },
      execPath: '/opt/vibecanvas/bin/vibecanvas',
      vibecanvasHomeDir: '/home/tester/.vibecanvas',
    });

    expect(plan.removeTargets).toEqual(expect.arrayContaining([
      { kind: 'binary', path: '/opt/vibecanvas/bin/vibecanvas', missingOk: true },
      { kind: 'native-dir', path: '/opt/vibecanvas/native-addons', missingOk: true },
      { kind: 'migrations-dir', path: '/opt/vibecanvas/migrations', missingOk: true },
      { kind: 'home-dir', path: '/home/tester/.vibecanvas', missingOk: true },
    ]));
  });

  test('accepts an explicitly named Vibecanvas home outside the user home', () => {
    const plan = fnBuildUninstallPlan(portal, {
      homedir: '/home/tester',
      env: {},
      execPath: '/home/tester/.vibecanvas/bin/vibecanvas',
      vibecanvasHomeDir: '/projects/custom/vibecanvas',
    });

    expect(plan.removeTargets).toEqual(expect.arrayContaining([
      { kind: 'home-dir', path: '/projects/custom/vibecanvas', missingOk: true },
    ]));
  });
});
