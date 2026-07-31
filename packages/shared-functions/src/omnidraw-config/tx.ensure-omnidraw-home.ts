import type { mkdirSync } from 'fs';
import type { TOmnidrawHome } from './fn.resolve-omnidraw-home';

type TPortalEnsureOmnidrawHome = {
  mkdirSync: typeof mkdirSync;
};

type TArgsEnsureOmnidrawHome = {
  home: TOmnidrawHome;
};

function txEnsureOmnidrawHome(
  portal: TPortalEnsureOmnidrawHome,
  args: TArgsEnsureOmnidrawHome,
): TOmnidrawHome {
  const directories = [
    args.home.homeDir,
    args.home.organizationsDir,
    args.home.defaultOrganizationRoot,
    args.home.agentRoot,
    args.home.artifactsRoot,
    args.home.resourcesRoot,
    args.home.tempRoot,
    args.home.cacheRoot,
    args.home.logsRoot,
  ];

  for (const directory of directories) {
    portal.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  return args.home;
}

export { txEnsureOmnidrawHome };
export type { TArgsEnsureOmnidrawHome, TPortalEnsureOmnidrawHome };
