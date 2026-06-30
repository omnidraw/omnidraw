import { describe, expect, test } from 'bun:test';
import { dirname, join, resolve } from 'path';
import { fnXdgPaths } from '../src/vibecanvas-config/fn.xdg-paths';

const FAKE_HOME = '/home/testuser';
const FAKE_CWD = '/projects/vibecanvas';
const FAKE_MONOREPO = '/projects/vibecanvas';
const portal = { dirname, join, resolve };
const findRoot = () => FAKE_MONOREPO;
const findRootNull = () => null;

const xdgPaths = (args: Parameters<typeof fnXdgPaths>[1]) => fnXdgPaths(portal, args);

describe('fnXdgPaths', () => {
  describe('VIBECANVAS_DB override (priority 1)', () => {
    test('uses the explicit database file and collapses dirs to its parent', () => {
      const paths = xdgPaths({
        env: { VIBECANVAS_DB: '/custom/dbs/isolated.sqlite' },
        isCompiled: true,
        cwd: FAKE_CWD,
        homedir: FAKE_HOME,
      });

      expect(paths.dataDir).toBe('/custom/dbs');
      expect(paths.configDir).toBe('/custom/dbs');
      expect(paths.stateDir).toBe('/custom/dbs');
      expect(paths.cacheDir).toBe('/custom/dbs');
      expect(paths.databasePath).toBe('/custom/dbs/isolated.sqlite');
    });

    test('wins over VIBECANVAS_CONFIG', () => {
      const paths = xdgPaths({
        env: {
          VIBECANVAS_DB: '/custom/dbs/isolated.sqlite',
          VIBECANVAS_CONFIG: '/custom/config',
        },
        isCompiled: true,
        cwd: FAKE_CWD,
        homedir: FAKE_HOME,
      });

      expect(paths.databasePath).toBe('/custom/dbs/isolated.sqlite');
      expect(paths.dataDir).toBe('/custom/dbs');
    });
  });

  describe('VIBECANVAS_CONFIG override (priority 2)', () => {
    test('all dirs point to the override path', () => {
      const paths = xdgPaths({
        env: { VIBECANVAS_CONFIG: '/custom/path' },
        isCompiled: true,
        cwd: FAKE_CWD,
        homedir: FAKE_HOME,
      });

      expect(paths.dataDir).toBe('/custom/path');
      expect(paths.configDir).toBe('/custom/path');
      expect(paths.stateDir).toBe('/custom/path');
      expect(paths.cacheDir).toBe('/custom/path');
      expect(paths.databasePath).toBe('/custom/path/vibecanvas.turso');
    });

    test('override works in dev mode too', () => {
      const paths = xdgPaths({
        env: { VIBECANVAS_CONFIG: '/override' },
        isCompiled: false,
        homedir: FAKE_HOME,
        cwd: FAKE_CWD,
        findMonorepoRoot: findRoot,
      });

      expect(paths.dataDir).toBe('/override');
    });
  });

  describe('dev mode (priority 3)', () => {
    test('uses local-volume subdirectories under monorepo root', () => {
      const paths = xdgPaths({
        env: {},
        isCompiled: false,
        homedir: FAKE_HOME,
        cwd: FAKE_CWD,
        findMonorepoRoot: findRoot,
      });

      const lv = join(FAKE_MONOREPO, 'local-volume');
      expect(paths.dataDir).toBe(join(lv, 'data'));
      expect(paths.configDir).toBe(join(lv, 'config'));
      expect(paths.stateDir).toBe(join(lv, 'state'));
      expect(paths.cacheDir).toBe(join(lv, 'cache'));
      expect(paths.databasePath).toBe(join(lv, 'data', 'vibecanvas.turso'));
    });

    test('throws when monorepo root not found', () => {
      expect(() =>
        xdgPaths({
          env: {},
          isCompiled: false,
          homedir: FAKE_HOME,
          cwd: '/some/random/dir',
          findMonorepoRoot: findRootNull,
        }),
      ).toThrow('Failed to find monorepo root. Could not locate bun.lock from /some/random/dir');
    });
  });

  describe('production mode - XDG defaults (priority 4)', () => {
    test('uses XDG defaults when no env vars set', () => {
      const paths = xdgPaths({ env: {}, isCompiled: true, cwd: FAKE_CWD, homedir: FAKE_HOME });

      expect(paths.dataDir).toBe(join(FAKE_HOME, '.local', 'share', 'vibecanvas'));
      expect(paths.configDir).toBe(join(FAKE_HOME, '.config', 'vibecanvas'));
      expect(paths.stateDir).toBe(join(FAKE_HOME, '.local', 'state', 'vibecanvas'));
      expect(paths.cacheDir).toBe(join(FAKE_HOME, '.cache', 'vibecanvas'));
      expect(paths.databasePath).toBe(join(FAKE_HOME, '.local', 'share', 'vibecanvas', 'vibecanvas.turso'));
    });

    test('respects XDG_DATA_HOME', () => {
      const paths = xdgPaths({
        env: { XDG_DATA_HOME: '/custom/data' },
        isCompiled: true,
        cwd: FAKE_CWD,
        homedir: FAKE_HOME,
      });

      expect(paths.dataDir).toBe('/custom/data/vibecanvas');
      expect(paths.databasePath).toBe('/custom/data/vibecanvas/vibecanvas.turso');
      expect(paths.configDir).toBe(join(FAKE_HOME, '.config', 'vibecanvas'));
    });

    test('respects XDG_CONFIG_HOME', () => {
      const paths = xdgPaths({
        env: { XDG_CONFIG_HOME: '/custom/config' },
        isCompiled: true,
        cwd: FAKE_CWD,
        homedir: FAKE_HOME,
      });

      expect(paths.configDir).toBe('/custom/config/vibecanvas');
    });

    test('respects XDG_STATE_HOME', () => {
      const paths = xdgPaths({
        env: { XDG_STATE_HOME: '/custom/state' },
        isCompiled: true,
        cwd: FAKE_CWD,
        homedir: FAKE_HOME,
      });

      expect(paths.stateDir).toBe('/custom/state/vibecanvas');
    });

    test('respects XDG_CACHE_HOME', () => {
      const paths = xdgPaths({
        env: { XDG_CACHE_HOME: '/custom/cache' },
        isCompiled: true,
        cwd: FAKE_CWD,
        homedir: FAKE_HOME,
      });

      expect(paths.cacheDir).toBe('/custom/cache/vibecanvas');
    });

    test('respects all XDG vars simultaneously', () => {
      const paths = xdgPaths({
        env: {
          XDG_DATA_HOME: '/xdg/data',
          XDG_CONFIG_HOME: '/xdg/config',
          XDG_STATE_HOME: '/xdg/state',
          XDG_CACHE_HOME: '/xdg/cache',
        },
        isCompiled: true,
        cwd: FAKE_CWD,
        homedir: FAKE_HOME,
      });

      expect(paths.dataDir).toBe('/xdg/data/vibecanvas');
      expect(paths.configDir).toBe('/xdg/config/vibecanvas');
      expect(paths.stateDir).toBe('/xdg/state/vibecanvas');
      expect(paths.cacheDir).toBe('/xdg/cache/vibecanvas');
    });
  });
});
