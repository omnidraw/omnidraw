import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

declare const VIBECANVAS_COMPILED: boolean;

const APP_NAME = 'vibecanvas';

export type TArgsXdgPaths = {
  env?: NodeJS.ProcessEnv;
  isCompiled?: boolean;
  cwd?: string;
  homedir?: string;
  findMonorepoRoot?: (startDir: string) => string | null;
};

export type TVibecanvasPaths = {
  dataDir: string;
  configDir: string;
  stateDir: string;
  cacheDir: string;
  databasePath: string;
};

function defaultFindMonorepoRoot(startDir: string): string | null {
  let existsSync: (path: string) => boolean;
  try {
    existsSync = require('fs').existsSync;
  } catch {
    return null;
  }

  let current = startDir;
  while (current !== dirname(current)) {
    if (existsSync(join(current, 'bun.lock'))) return current;
    current = dirname(current);
  }

  if (existsSync(join(current, 'bun.lock'))) return current;
  return null;
}

export function fnXdgPaths(args: TArgsXdgPaths): TVibecanvasPaths {
  const env = args.env ?? process.env;
  const home = args.homedir ?? homedir();
  const isCompiled = args.isCompiled ?? (typeof VIBECANVAS_COMPILED !== 'undefined' && VIBECANVAS_COMPILED);
  const cwd = args.cwd ?? process.cwd();
  const findRoot = args.findMonorepoRoot ?? defaultFindMonorepoRoot;

  const dbOverride = env.VIBECANVAS_DB;
  if (dbOverride) {
    const databasePath = resolve(cwd, dbOverride);
    const baseDir = dirname(databasePath);
    return {
      dataDir: baseDir,
      configDir: baseDir,
      stateDir: baseDir,
      cacheDir: baseDir,
      databasePath,
    }
  }

  const envOverride = env.VIBECANVAS_CONFIG;
  if (envOverride) {
    return {
      dataDir: envOverride,
      configDir: envOverride,
      stateDir: envOverride,
      cacheDir: envOverride,
      databasePath: join(envOverride, 'vibecanvas.turso'),
    }
  }

  if (!isCompiled) {
    const monorepoRoot = findRoot(cwd);
    if (!monorepoRoot) {
      throw `Failed to find monorepo root. Could not locate bun.lock from ${cwd}`
    }

    const localVolume = join(monorepoRoot, 'local-volume');
    return {
      dataDir: join(localVolume, 'data'),
      configDir: join(localVolume, 'config'),
      stateDir: join(localVolume, 'state'),
      cacheDir: join(localVolume, 'cache'),
      databasePath: join(localVolume, 'data', 'vibecanvas.turso'),
    }
  }

  const dataDir = join(env.XDG_DATA_HOME || join(home, '.local', 'share'), APP_NAME);
  const configDir = join(env.XDG_CONFIG_HOME || join(home, '.config'), APP_NAME);
  const stateDir = join(env.XDG_STATE_HOME || join(home, '.local', 'state'), APP_NAME);
  const cacheDir = join(env.XDG_CACHE_HOME || join(home, '.cache'), APP_NAME);

  return {
    dataDir,
    configDir,
    stateDir,
    cacheDir,
    databasePath: join(dataDir, 'vibecanvas.turso'),
  }
}