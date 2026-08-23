import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'path';
import { fnResolveOmnidrawHome } from '#backend/shell/config/fn.resolve-omnidraw-home';

const FAKE_HOME = '/home/tester';
const FAKE_CWD = '/work/omnidraw';
const effects = { join, resolve };

function resolveHome(args: Partial<Parameters<typeof fnResolveOmnidrawHome>[1]> = {}) {
  return fnResolveOmnidrawHome(effects, {
    cwd: FAKE_CWD,
    env: {},
    homedir: FAKE_HOME,
    ...args,
  });
}

describe('fnResolveOmnidrawHome', () => {
  test('resolves the default home and complete single-user layout', () => {
    const home = resolveHome();
    const homeDir = join(FAKE_HOME, '.omnidraw');

    expect(home).toEqual({
      homeDir,
      mainDbPath: join(homeDir, 'main.db'),
      configFilePath: join(homeDir, 'config.json'),
      agentRoot: join(homeDir, 'agent'),
      resourcesRoot: join(homeDir, 'resources'),
      tempRoot: join(homeDir, 'temp'),
      cacheRoot: join(homeDir, 'cache'),
      logsRoot: join(homeDir, 'logs'),
      keysRoot: join(homeDir, 'keys'),
      widgetsRoot: join(homeDir, 'widgets'),
      widgetDraftsRoot: join(homeDir, 'widgets', 'drafts'),
      widgetPublishedRoot: join(homeDir, 'widgets', 'published'),
      widgetStagingRoot: join(homeDir, 'widgets', '.staging'),
      widgetPreviewRoot: join(homeDir, 'widgets', '.preview'),
      widgetTrashRoot: join(homeDir, 'widgets', '.trash'),
      widgetQuarantineRoot: join(homeDir, 'widgets', '.quarantine'),
    });
    expect(Object.isFrozen(home)).toBe(true);
  });

  test('--data-dir wins over OMNIDRAW_HOME and resolves once against cwd', () => {
    const home = resolveHome({
      dataDir: './explicit-home',
      env: { OMNIDRAW_HOME: '../environment-home' },
    });

    expect(home.homeDir).toBe(join(FAKE_CWD, 'explicit-home'));
    expect(home.mainDbPath).toBe(join(FAKE_CWD, 'explicit-home', 'main.db'));
  });

  test('resolves a relative OMNIDRAW_HOME against the captured cwd', () => {
    const home = resolveHome({ env: { OMNIDRAW_HOME: '../environment-home' } });

    expect(home.homeDir).toBe('/work/environment-home');
  });

  test('ignores legacy XDG and database override variables', () => {
    const home = resolveHome({
      env: {
        OMNIDRAW_DB: '/legacy/custom.db',
        OMNIDRAW_CONFIG: '/legacy/config',
        XDG_DATA_HOME: '/legacy/data',
        XDG_CONFIG_HOME: '/legacy/config',
        XDG_STATE_HOME: '/legacy/state',
        XDG_CACHE_HOME: '/legacy/cache',
      },
    });

    expect(home.homeDir).toBe(join(FAKE_HOME, '.omnidraw'));
    expect(home.mainDbPath).toBe(join(FAKE_HOME, '.omnidraw', 'main.db'));
  });

  test('does not perform application-level tilde expansion', () => {
    expect(() => resolveHome({ dataDir: '~/explicit-home' })).toThrow("--data-dir does not expand '~'");
    expect(() => resolveHome({ env: { OMNIDRAW_HOME: '~someone/environment-home' } })).toThrow("OMNIDRAW_HOME does not expand '~'");
  });

  test('rejects an explicitly empty environment override', () => {
    expect(() => resolveHome({ env: { OMNIDRAW_HOME: '' } })).toThrow(
      'OMNIDRAW_HOME requires a non-empty path.',
    );
  });

});
