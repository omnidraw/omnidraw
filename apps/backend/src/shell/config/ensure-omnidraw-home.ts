import type { mkdirSync } from 'fs';
import type { TOmnidrawHome } from './fn.resolve-omnidraw-home';

type TEffectsEnsureOmnidrawHome = {
  mkdirSync: typeof mkdirSync;
};

type TArgsEnsureOmnidrawHome = {
  home: TOmnidrawHome;
};

function ensureOmnidrawHome(
  effects: TEffectsEnsureOmnidrawHome,
  args: TArgsEnsureOmnidrawHome,
): TOmnidrawHome {
  const directories = [
    args.home.homeDir,
    args.home.agentRoot,
    args.home.resourcesRoot,
    args.home.tempRoot,
    args.home.cacheRoot,
    args.home.logsRoot,
    args.home.keysRoot,
    args.home.widgetsRoot,
    args.home.widgetDraftsRoot,
    args.home.widgetPublishedRoot,
    args.home.widgetStagingRoot,
    args.home.widgetPreviewRoot,
    args.home.widgetTrashRoot,
    args.home.widgetQuarantineRoot,
  ];

  for (const directory of directories) {
    effects.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  return args.home;
}

export { ensureOmnidrawHome };
export type { TArgsEnsureOmnidrawHome, TEffectsEnsureOmnidrawHome };
