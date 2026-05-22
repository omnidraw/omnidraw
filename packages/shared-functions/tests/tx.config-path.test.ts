import { describe, expect, test } from 'bun:test';
import { txConfigPath } from '../src/vibecanvas-config/tx.config-path';

describe('txConfigPath', () => {
  test('returns monorepo lookup error in dev mode when path probing cannot find bun.lock', () => {
    const portal = {
      fs: {
        existsSync() {
          return false;
        },
        mkdirSync() {
          throw new Error('should not be called');
        },
      },
    };

    const [result, err, rollbacks] = txConfigPath(portal as any, {
      env: {},
      isCompiled: false,
    });

    expect(result).toBeNull();
    expect(rollbacks).toEqual([]);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('FN.CONFIG.XDG_PATHS.MONOREPO_NOT_FOUND');
  });

  test('uses explicit config override and creates only that directory once', () => {
    const existing = new Set<string>();
    const createdDirs: string[] = [];

    const portal = {
      fs: {
        existsSync(path: string) {
          return existing.has(path);
        },
        mkdirSync(path: string) {
          createdDirs.push(path);
          existing.add(path);
        },
      },
    };

    const [result, err, rollbacks] = txConfigPath(portal as any, {
      env: { VIBECANVAS_CONFIG: '/custom/config' },
      isCompiled: true,
    });

    expect(err).toBeNull();
    expect(rollbacks).toEqual([]);
    expect(result!.created).toBe(true);
    expect(result!.configDir).toBe('/custom/config');
    expect(result!.databasePath).toBe('/custom/config/vibecanvas.turso');
    expect(result!.paths).toEqual({
      dataDir: '/custom/config',
      configDir: '/custom/config',
      stateDir: '/custom/config',
      cacheDir: '/custom/config',
      databasePath: '/custom/config/vibecanvas.turso',
    });
    expect(createdDirs).toEqual(['/custom/config']);
  });

  test('uses explicit db override and creates only the parent directory once', () => {
    const existing = new Set<string>();
    const createdDirs: string[] = [];

    const portal = {
      fs: {
        existsSync(path: string) {
          return existing.has(path);
        },
        mkdirSync(path: string) {
          createdDirs.push(path);
          existing.add(path);
        },
      },
    };

    const [result, err] = txConfigPath(portal as any, {
      env: { VIBECANVAS_DB: '/custom/db/vibecanvas.turso' },
      isCompiled: true,
    });

    expect(err).toBeNull();
    expect(result!.created).toBe(true);
    expect(result!.configDir).toBe('/custom/db');
    expect(result!.databasePath).toBe('/custom/db/vibecanvas.turso');
    expect(result!.paths).toEqual({
      dataDir: '/custom/db',
      configDir: '/custom/db',
      stateDir: '/custom/db',
      cacheDir: '/custom/db',
      databasePath: '/custom/db/vibecanvas.turso',
    });
    expect(createdDirs).toEqual(['/custom/db']);
  });

  test('returns error when directory creation throws for override path', () => {
    const portal = {
      fs: {
        existsSync() {
          return false;
        },
        mkdirSync() {
          throw new Error('disk full');
        },
      },
    };

    const [result, err, rollbacks] = txConfigPath(portal as any, {
      env: { VIBECANVAS_CONFIG: '/custom/config' },
      isCompiled: true,
    });

    expect(result).toBeNull();
    expect(rollbacks).toEqual([]);
    expect(err).not.toBeNull();
    expect(err!.code).toBe('TX.CONFIG.ENSURE_DIRS.FAILED');
    expect(err!.internalMessage).toBe('disk full');
  });
});
