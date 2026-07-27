import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'path';
import { DEFAULT_OSS_ORGANIZATION_ID } from '../src/vibecanvas-config/CONSTANTS';
import { fnResolveVibecanvasHome } from '../src/vibecanvas-config/fn.resolve-vibecanvas-home';

const FAKE_HOME = '/home/tester';
const FAKE_CWD = '/work/vibecanvas';
const portal = { join, resolve };

function resolveHome(args: Partial<Parameters<typeof fnResolveVibecanvasHome>[1]> = {}) {
  return fnResolveVibecanvasHome(portal, {
    cwd: FAKE_CWD,
    env: {},
    homedir: FAKE_HOME,
    ...args,
  });
}

describe('fnResolveVibecanvasHome', () => {
  test('resolves the default home and complete local organization layout', () => {
    const home = resolveHome();
    const homeDir = join(FAKE_HOME, '.vibecanvas');
    const organizationRoot = join(homeDir, 'organizations', DEFAULT_OSS_ORGANIZATION_ID);

    expect(home).toEqual({
      homeDir,
      mainDbPath: join(homeDir, 'main.db'),
      configFilePath: join(homeDir, 'config.json'),
      organizationsDir: join(homeDir, 'organizations'),
      defaultOrganizationRoot: organizationRoot,
      agentRoot: join(organizationRoot, 'agent'),
      artifactsRoot: join(organizationRoot, 'artifacts'),
      resourcesRoot: join(organizationRoot, 'resources'),
      tempRoot: join(organizationRoot, 'temp'),
      cacheRoot: join(homeDir, 'cache'),
      logsRoot: join(homeDir, 'logs'),
    });
    expect(Object.isFrozen(home)).toBe(true);
  });

  test('--data-dir wins over VIBECANVAS_HOME and resolves once against cwd', () => {
    const home = resolveHome({
      dataDir: './explicit-home',
      env: { VIBECANVAS_HOME: '../environment-home' },
    });

    expect(home.homeDir).toBe(join(FAKE_CWD, 'explicit-home'));
    expect(home.mainDbPath).toBe(join(FAKE_CWD, 'explicit-home', 'main.db'));
  });

  test('resolves a relative VIBECANVAS_HOME against the captured cwd', () => {
    const home = resolveHome({ env: { VIBECANVAS_HOME: '../environment-home' } });

    expect(home.homeDir).toBe('/work/environment-home');
  });

  test('ignores legacy XDG and database override variables', () => {
    const home = resolveHome({
      env: {
        VIBECANVAS_DB: '/legacy/custom.db',
        VIBECANVAS_CONFIG: '/legacy/config',
        XDG_DATA_HOME: '/legacy/data',
        XDG_CONFIG_HOME: '/legacy/config',
        XDG_STATE_HOME: '/legacy/state',
        XDG_CACHE_HOME: '/legacy/cache',
      },
    });

    expect(home.homeDir).toBe(join(FAKE_HOME, '.vibecanvas'));
    expect(home.mainDbPath).toBe(join(FAKE_HOME, '.vibecanvas', 'main.db'));
  });

  test('does not perform application-level tilde expansion', () => {
    expect(() => resolveHome({ dataDir: '~/explicit-home' })).toThrow("--data-dir does not expand '~'");
    expect(() => resolveHome({ env: { VIBECANVAS_HOME: '~someone/environment-home' } })).toThrow("VIBECANVAS_HOME does not expand '~'");
  });

  test('rejects an explicitly empty environment override', () => {
    expect(() => resolveHome({ env: { VIBECANVAS_HOME: '' } })).toThrow(
      'VIBECANVAS_HOME requires a non-empty path.',
    );
  });

  test('accepts an injected organization id without embedding a resolver function', () => {
    const home = resolveHome({ organizationId: 'org-for-test' });

    expect(home.defaultOrganizationRoot).toBe(join(FAKE_HOME, '.vibecanvas', 'organizations', 'org-for-test'));
    expect(Object.values(home).every((value) => typeof value === 'string')).toBe(true);
  });

  test('rejects organization ids that could escape the organizations directory', () => {
    expect(() => resolveHome({ organizationId: '../other' })).toThrow('organizationId must be one non-empty path segment.');
    expect(() => resolveHome({ organizationId: '' })).toThrow('organizationId must be one non-empty path segment.');
  });
});
