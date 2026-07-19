import type { dirname, join, resolve } from 'path';

type TUninstallPathKind =
  | 'binary'
  | 'install-dir'
  | 'native-dir'
  | 'migrations-dir'
  | 'data-dir'
  | 'config-dir'
  | 'state-dir'
  | 'cache-dir'
  | 'database-file';

type TUninstallRemoveTarget = {
  kind: TUninstallPathKind;
  path: string;
  missingOk: boolean;
};

type TUninstallSkippedTarget = {
  kind: TUninstallPathKind;
  path: string;
  reason: string;
};

type TUninstallPlan = {
  installRoot: string;
  removeTargets: TUninstallRemoveTarget[];
  skippedTargets: TUninstallSkippedTarget[];
};

type TPortal = {
  dirname: typeof dirname;
  join: typeof join;
  resolve: typeof resolve;
};

type TArgs = {
  homedir: string;
  env: Record<string, string | undefined>;
  execPath: string;
  dbPath: string;
  xdgPaths: {
    configDirPath: string;
    dataDirPath: string;
    cacheDirPath: string;
    stateDirPath: string;
  };
};

function fnNormalizePath(portal: TPortal, path: string): string {
  return portal.resolve(path);
}

function fnIsWithin(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function fnIsVibecanvasOwnedDir(path: string): boolean {
  return /(^|[/\\])vibecanvas($|[/\\])/.test(path) || /(^|[/\\])\.vibecanvas($|[/\\])/.test(path);
}

function fnPushUniqueTarget(targets: TUninstallRemoveTarget[], target: TUninstallRemoveTarget): void {
  if (targets.some((existing) => existing.path === target.path && existing.kind === target.kind)) return;
  targets.push(target);
}

function fnPushUniqueSkip(targets: TUninstallSkippedTarget[], target: TUninstallSkippedTarget): void {
  if (targets.some((existing) => existing.path === target.path && existing.kind === target.kind)) return;
  targets.push(target);
}

function fnBuildUninstallPlan(portal: TPortal, args: TArgs): TUninstallPlan {
  const installDir = fnNormalizePath(portal, args.env.VIBECANVAS_INSTALL_DIR ?? portal.join(args.homedir, '.vibecanvas', 'bin'));
  const installRoot = fnNormalizePath(portal, portal.dirname(installDir));
  const nativeDir = fnNormalizePath(portal, args.env.VIBECANVAS_NATIVE_DIR ?? portal.join(installRoot, 'native'));
  const migrationsDir = fnNormalizePath(portal, args.env.VIBECANVAS_MIGRATIONS_DIR ?? portal.join(installRoot, 'database-migrations'));
  const binaryPath = portal.join(installDir, 'vibecanvas');
  const execPath = fnNormalizePath(portal, args.execPath);
  const removeTargets: TUninstallRemoveTarget[] = [];
  const skippedTargets: TUninstallSkippedTarget[] = [];

  fnPushUniqueTarget(removeTargets, { kind: 'binary', path: binaryPath, missingOk: true });
  fnPushUniqueTarget(removeTargets, { kind: 'native-dir', path: nativeDir, missingOk: true });
  fnPushUniqueTarget(removeTargets, { kind: 'migrations-dir', path: migrationsDir, missingOk: true });

  if (fnIsWithin(installRoot, execPath)) {
    fnPushUniqueTarget(removeTargets, { kind: 'install-dir', path: installDir, missingOk: true });
  } else {
    fnPushUniqueSkip(skippedTargets, {
      kind: 'install-dir',
      path: installDir,
      reason: `current executable is outside ${installRoot}`,
    });
  }

  const xdgTargets: Array<{ kind: TUninstallPathKind; path: string }> = [
    { kind: 'data-dir', path: args.xdgPaths.dataDirPath },
    { kind: 'config-dir', path: args.xdgPaths.configDirPath },
    { kind: 'state-dir', path: args.xdgPaths.stateDirPath },
    { kind: 'cache-dir', path: args.xdgPaths.cacheDirPath },
  ];

  for (const target of xdgTargets) {
    const path = fnNormalizePath(portal, target.path);
    if (!fnIsVibecanvasOwnedDir(path)) {
      fnPushUniqueSkip(skippedTargets, {
        kind: target.kind,
        path,
        reason: 'path does not look Vibecanvas-owned',
      });
      continue;
    }

    fnPushUniqueTarget(removeTargets, { kind: target.kind, path, missingOk: true });
  }

  const configTarget = removeTargets.find((target) => target.kind === 'config-dir');
  const dataTarget = removeTargets.find((target) => target.kind === 'data-dir');
  if (Boolean(configTarget) !== Boolean(dataTarget)) {
    const retainedTarget = configTarget ?? dataTarget!;
    removeTargets.splice(removeTargets.indexOf(retainedTarget), 1);
    fnPushUniqueSkip(skippedTargets, {
      kind: retainedTarget.kind,
      path: retainedTarget.path,
      reason: 'configuration and data roots must be removed together',
    });
  }

  const dbPath = fnNormalizePath(portal, args.dbPath);
  const removableDataDirs = removeTargets
    .filter((target) => target.kind === 'data-dir')
    .map((target) => target.path);

  if (removableDataDirs.some((dir) => fnIsWithin(dir, dbPath))) {
    fnPushUniqueTarget(removeTargets, { kind: 'database-file', path: dbPath, missingOk: true });
  } else {
    fnPushUniqueSkip(skippedTargets, {
      kind: 'database-file',
      path: dbPath,
      reason: 'database is outside removable Vibecanvas data directories',
    });
  }

  return { installRoot, removeTargets, skippedTargets };
}

export { fnBuildUninstallPlan };
export type { TUninstallPathKind, TUninstallPlan, TUninstallRemoveTarget, TUninstallSkippedTarget };
