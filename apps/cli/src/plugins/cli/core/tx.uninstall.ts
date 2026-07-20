import type { existsSync, lstatSync, readdirSync, rmSync, rmdirSync } from 'fs';

type TPortal = {
  existsSync: typeof existsSync;
  lstatSync: typeof lstatSync;
  readdirSync: typeof readdirSync;
  rmSync: typeof rmSync;
  rmdirSync: typeof rmdirSync;
};

type TArgs = {
  paths: string[];
};

type TRemoveResult = {
  removed: string[];
  missing: string[];
  failed: Array<{ path: string; message: string }>;
};

function txRemoveUninstallTargets(portal: TPortal, args: TArgs): TRemoveResult {
  const removed: string[] = [];
  const missing: string[] = [];
  const failed: Array<{ path: string; message: string }> = [];

  for (const path of args.paths) {
    try {
      portal.lstatSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        missing.push(path);
        continue;
      }
      failed.push({ path, message: error instanceof Error ? error.message : String(error) });
      continue;
    }

    try {
      portal.rmSync(path, { recursive: true, force: true });
      removed.push(path);
    } catch (error) {
      failed.push({ path, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return { removed, missing, failed };
}

function txRemoveEmptyDirs(portal: TPortal, args: TArgs): TRemoveResult {
  const removed: string[] = [];
  const missing: string[] = [];
  const failed: Array<{ path: string; message: string }> = [];

  for (const path of args.paths) {
    if (!portal.existsSync(path)) {
      missing.push(path);
      continue;
    }

    try {
      if (!portal.lstatSync(path).isDirectory()) continue;
      if (portal.readdirSync(path).length > 0) continue;
      portal.rmdirSync(path);
      removed.push(path);
    } catch (error) {
      failed.push({ path, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return { removed, missing, failed };
}

export { txRemoveEmptyDirs, txRemoveUninstallTargets };
export type { TRemoveResult };
