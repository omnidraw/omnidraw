import type { dirname, join, resolve } from 'path';

type TUninstallPathKind =
  | 'binary'
  | 'install-dir'
  | 'native-dir'
  | 'migrations-dir'
  | 'home-dir';

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
  vibecanvasHomeDir: string;
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

  const vibecanvasHomeDir = fnNormalizePath(portal, args.vibecanvasHomeDir);
  if (fnIsVibecanvasOwnedDir(vibecanvasHomeDir)) {
    fnPushUniqueTarget(removeTargets, { kind: 'home-dir', path: vibecanvasHomeDir, missingOk: true });
  } else {
    fnPushUniqueSkip(skippedTargets, {
      kind: 'home-dir',
      path: vibecanvasHomeDir,
      reason: 'path does not look Vibecanvas-owned',
    });
  }

  return { installRoot, removeTargets, skippedTargets };
}

export { fnBuildUninstallPlan };
export type { TUninstallPathKind, TUninstallPlan, TUninstallRemoveTarget, TUninstallSkippedTarget };
