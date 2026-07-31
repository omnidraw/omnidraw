import { describe, expect, test } from 'bun:test';
import { dirname, join, resolve } from 'path';
import { fnBuildUninstallPlan } from '../../../../src/plugins/cli/core/fn.uninstall-plan';

const portal = { dirname, join, resolve };

describe('fnBuildUninstallPlan', () => {
  test('selects curl install files and the unified Omnidraw home', () => {
    const plan = fnBuildUninstallPlan(portal, {
      homedir: '/home/tester',
      env: {},
      execPath: '/home/tester/.omnidraw/bin/omnidraw',
      omnidrawHomeDir: '/home/tester/.omnidraw',
    });

    expect(plan.removeTargets.map((target) => [target.kind, target.path])).toEqual([
      ['binary', '/home/tester/.omnidraw/bin/omnidraw'],
      ['native-dir', '/home/tester/.omnidraw/native'],
      ['migrations-dir', '/home/tester/.omnidraw/database-migrations'],
      ['install-dir', '/home/tester/.omnidraw/bin'],
      ['home-dir', '/home/tester/.omnidraw'],
    ]);
    expect(plan.skippedTargets).toEqual([]);
  });

  test('does not recursively remove an arbitrary custom override', () => {
    const plan = fnBuildUninstallPlan(portal, {
      homedir: '/home/tester',
      env: {},
      execPath: '/usr/local/bin/node',
      omnidrawHomeDir: '/projects/demo',
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
        OMNIDRAW_INSTALL_DIR: '/opt/omnidraw/bin',
        OMNIDRAW_NATIVE_DIR: '/opt/omnidraw/native-addons',
        OMNIDRAW_MIGRATIONS_DIR: '/opt/omnidraw/migrations',
      },
      execPath: '/opt/omnidraw/bin/omnidraw',
      omnidrawHomeDir: '/home/tester/.omnidraw',
    });

    expect(plan.removeTargets).toEqual(expect.arrayContaining([
      { kind: 'binary', path: '/opt/omnidraw/bin/omnidraw', missingOk: true },
      { kind: 'native-dir', path: '/opt/omnidraw/native-addons', missingOk: true },
      { kind: 'migrations-dir', path: '/opt/omnidraw/migrations', missingOk: true },
      { kind: 'home-dir', path: '/home/tester/.omnidraw', missingOk: true },
    ]));
  });

  test('accepts an explicitly named Omnidraw home outside the user home', () => {
    const plan = fnBuildUninstallPlan(portal, {
      homedir: '/home/tester',
      env: {},
      execPath: '/home/tester/.omnidraw/bin/omnidraw',
      omnidrawHomeDir: '/projects/custom/omnidraw',
    });

    expect(plan.removeTargets).toEqual(expect.arrayContaining([
      { kind: 'home-dir', path: '/projects/custom/omnidraw', missingOk: true },
    ]));
  });
});
