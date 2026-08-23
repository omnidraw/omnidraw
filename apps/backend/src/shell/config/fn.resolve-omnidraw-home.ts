import type { join, resolve } from 'path';

type TOmnidrawHome = Readonly<{
  homeDir: string;
  mainDbPath: string;
  configFilePath: string;
  agentRoot: string;
  resourcesRoot: string;
  tempRoot: string;
  cacheRoot: string;
  logsRoot: string;
  keysRoot: string;
  widgetsRoot: string;
  widgetDraftsRoot: string;
  widgetPublishedRoot: string;
  widgetStagingRoot: string;
  widgetPreviewRoot: string;
  widgetTrashRoot: string;
  widgetQuarantineRoot: string;
}>;

type TEffectsResolveOmnidrawHome = {
  join: typeof join;
  resolve: typeof resolve;
};

type TArgsResolveOmnidrawHome = {
  cwd: string;
  homedir: string;
  env: Readonly<Record<string, string | undefined>>;
  dataDir?: string;
};

function fnValidateOverride(value: string, source: '--data-dir' | 'OMNIDRAW_HOME'): string {
  if (value.trim().length === 0) {
    throw new Error(`${source} requires a non-empty path.`);
  }
  if (value.startsWith('~')) {
    throw new Error(`${source} does not expand '~'. Pass an absolute path or a path relative to the process working directory.`);
  }
  return value;
}

function fnResolveOmnidrawHome(
  effects: TEffectsResolveOmnidrawHome,
  args: TArgsResolveOmnidrawHome,
): TOmnidrawHome {
  const envOverride = args.env.OMNIDRAW_HOME;
  const selectedHome = args.dataDir !== undefined
    ? fnValidateOverride(args.dataDir, '--data-dir')
    : envOverride !== undefined
      ? fnValidateOverride(envOverride, 'OMNIDRAW_HOME')
      : effects.join(args.homedir, '.omnidraw');
  const homeDir = effects.resolve(args.cwd, selectedHome);
  const widgetsRoot = effects.join(homeDir, 'widgets');

  return Object.freeze({
    homeDir,
    mainDbPath: effects.join(homeDir, 'main.db'),
    configFilePath: effects.join(homeDir, 'config.json'),
    agentRoot: effects.join(homeDir, 'agent'),
    resourcesRoot: effects.join(homeDir, 'resources'),
    tempRoot: effects.join(homeDir, 'temp'),
    cacheRoot: effects.join(homeDir, 'cache'),
    logsRoot: effects.join(homeDir, 'logs'),
    keysRoot: effects.join(homeDir, 'keys'),
    widgetsRoot,
    widgetDraftsRoot: effects.join(widgetsRoot, 'drafts'),
    widgetPublishedRoot: effects.join(widgetsRoot, 'published'),
    widgetStagingRoot: effects.join(widgetsRoot, '.staging'),
    widgetPreviewRoot: effects.join(widgetsRoot, '.preview'),
    widgetTrashRoot: effects.join(widgetsRoot, '.trash'),
    widgetQuarantineRoot: effects.join(widgetsRoot, '.quarantine'),
  });
}

export { fnResolveOmnidrawHome };
export type { TArgsResolveOmnidrawHome, TEffectsResolveOmnidrawHome, TOmnidrawHome };
