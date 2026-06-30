import type { existsSync, mkdirSync } from 'fs';
import { fnXdgPaths, type TVibecanvasPaths, type TArgsXdgPaths } from './fn.xdg-paths';
import type { dirname, join, resolve } from 'path';

type TPortal = {
  fs: { existsSync: typeof existsSync; mkdirSync: typeof mkdirSync };
  resolve: typeof resolve,
  dirname: typeof dirname,
  join: typeof join,
  process: NodeJS.Process
};

type TArgs = {
  env?: NodeJS.ProcessEnv;
  isCompiled?: boolean;
  homedir: string;
};

type TResult = {
  databasePath: string;
  created: boolean;
  paths: TVibecanvasPaths;
};

export function txEnsureXdgPaths(portal: TPortal, args: TArgs): TResult {
  const xdgArgs: TArgsXdgPaths = {
    env: args.env ?? portal.process.env,
    cwd: portal.process.cwd(),
    homedir: args.homedir,
    isCompiled: args.isCompiled,
    findMonorepoRoot: (startDir: string) => {
      const { dirname, join } = require('path');
      let current = startDir;
      while (current !== dirname(current)) {
        if (portal.fs.existsSync(join(current, 'bun.lock'))) return current;
        current = dirname(current);
      }
      if (portal.fs.existsSync(join(current, 'bun.lock'))) return current;
      return null;
    },
  };

  const paths = fnXdgPaths(portal, xdgArgs);

  const dirs = [paths.dataDir, paths.configDir, paths.stateDir, paths.cacheDir];
  let created = false;

  for (const dir of dirs) {
    if (!portal.fs.existsSync(dir)) {
      portal.fs.mkdirSync(dir, { recursive: true });
      created = true;
    }
  }

  return {
    databasePath: paths.databasePath,
    created,
    paths,
  }
}