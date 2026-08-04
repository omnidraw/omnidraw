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

type TPortalResolveOmnidrawHome = {
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
  portal: TPortalResolveOmnidrawHome,
  args: TArgsResolveOmnidrawHome,
): TOmnidrawHome {
  const envOverride = args.env.OMNIDRAW_HOME;
  const selectedHome = args.dataDir !== undefined
    ? fnValidateOverride(args.dataDir, '--data-dir')
    : envOverride !== undefined
      ? fnValidateOverride(envOverride, 'OMNIDRAW_HOME')
      : portal.join(args.homedir, '.omnidraw');
  const homeDir = portal.resolve(args.cwd, selectedHome);
  const widgetsRoot = portal.join(homeDir, 'widgets');

  return Object.freeze({
    homeDir,
    mainDbPath: portal.join(homeDir, 'main.db'),
    configFilePath: portal.join(homeDir, 'config.json'),
    agentRoot: portal.join(homeDir, 'agent'),
    resourcesRoot: portal.join(homeDir, 'resources'),
    tempRoot: portal.join(homeDir, 'temp'),
    cacheRoot: portal.join(homeDir, 'cache'),
    logsRoot: portal.join(homeDir, 'logs'),
    keysRoot: portal.join(homeDir, 'keys'),
    widgetsRoot,
    widgetDraftsRoot: portal.join(widgetsRoot, 'drafts'),
    widgetPublishedRoot: portal.join(widgetsRoot, 'published'),
    widgetStagingRoot: portal.join(widgetsRoot, '.staging'),
    widgetPreviewRoot: portal.join(widgetsRoot, '.preview'),
    widgetTrashRoot: portal.join(widgetsRoot, '.trash'),
    widgetQuarantineRoot: portal.join(widgetsRoot, '.quarantine'),
  });
}

export { fnResolveOmnidrawHome };
export type { TArgsResolveOmnidrawHome, TPortalResolveOmnidrawHome, TOmnidrawHome };
