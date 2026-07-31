import { DEFAULT_OSS_ORGANIZATION_ID } from './CONSTANTS';
import type { join, resolve } from 'path';

type TOmnidrawHome = Readonly<{
  homeDir: string;
  mainDbPath: string;
  configFilePath: string;
  organizationsDir: string;
  defaultOrganizationRoot: string;
  agentRoot: string;
  artifactsRoot: string;
  resourcesRoot: string;
  tempRoot: string;
  cacheRoot: string;
  logsRoot: string;
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
  organizationId?: string;
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

function fnValidateOrganizationId(organizationId: string): string {
  if (
    organizationId.length === 0
    || organizationId === '.'
    || organizationId === '..'
    || organizationId.includes('/')
    || organizationId.includes('\\')
  ) {
    throw new Error('organizationId must be one non-empty path segment.');
  }
  return organizationId;
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
  const organizationsDir = portal.join(homeDir, 'organizations');
  const organizationId = fnValidateOrganizationId(args.organizationId ?? DEFAULT_OSS_ORGANIZATION_ID);
  const defaultOrganizationRoot = portal.join(organizationsDir, organizationId);

  return Object.freeze({
    homeDir,
    mainDbPath: portal.join(homeDir, 'main.db'),
    configFilePath: portal.join(homeDir, 'config.json'),
    organizationsDir,
    defaultOrganizationRoot,
    agentRoot: portal.join(defaultOrganizationRoot, 'agent'),
    artifactsRoot: portal.join(defaultOrganizationRoot, 'artifacts'),
    resourcesRoot: portal.join(defaultOrganizationRoot, 'resources'),
    tempRoot: portal.join(defaultOrganizationRoot, 'temp'),
    cacheRoot: portal.join(homeDir, 'cache'),
    logsRoot: portal.join(homeDir, 'logs'),
  });
}

export { fnResolveOmnidrawHome };
export type { TArgsResolveOmnidrawHome, TPortalResolveOmnidrawHome, TOmnidrawHome };
