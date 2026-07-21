import type { mkdirSync } from 'fs';
import type { TVibecanvasHome } from './fn.resolve-vibecanvas-home';

type TPortalEnsureVibecanvasHome = {
  mkdirSync: typeof mkdirSync;
};

type TArgsEnsureVibecanvasHome = {
  home: TVibecanvasHome;
};

function txEnsureVibecanvasHome(
  portal: TPortalEnsureVibecanvasHome,
  args: TArgsEnsureVibecanvasHome,
): TVibecanvasHome {
  const directories = [
    args.home.homeDir,
    args.home.organizationsDir,
    args.home.defaultOrganizationRoot,
    args.home.agentRoot,
    args.home.artifactsRoot,
    args.home.resourcesRoot,
    args.home.tempRoot,
    args.home.ptyRoot,
    args.home.cacheRoot,
    args.home.logsRoot,
  ];

  for (const directory of directories) {
    portal.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  return args.home;
}

export { txEnsureVibecanvasHome };
export type { TArgsEnsureVibecanvasHome, TPortalEnsureVibecanvasHome };
