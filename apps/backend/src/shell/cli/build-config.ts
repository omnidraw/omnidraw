import { fnResolveOmnidrawHome } from '#backend/shell/config/fn.resolve-omnidraw-home';
import type { ICliConfig } from './config';
import type { TCliParsedArgv } from './parse-argv';
import { join, resolve } from 'path';
import { homedir } from 'os';

export const SOURCE_SERVER_HOST = '127.0.0.1';
export const SOURCE_SERVER_DEFAULT_PORT = 7496;
export const SOURCE_APPLICATION_VERSION = '0.0.0-dev';

export function sourceApplicationUrl(port: number): string {
  return `http://${SOURCE_SERVER_HOST}:${port}/`;
}

export type TBackendBuildIdentity = Readonly<{
  version: string;
}>;

function buildCliConfig(parsed: TCliParsedArgv, build: TBackendBuildIdentity): ICliConfig {
  const cwd = process.cwd();
  const home = fnResolveOmnidrawHome({ join, resolve }, {
    cwd,
    dataDir: parsed.dataDir,
    env: process.env,
    homedir: homedir(),
  });

  return {
    cwd,
    dev: process.env.NODE_ENV !== 'production',
    version: build.version,
    command: parsed.command,
    subcommand: parsed.subcommand,
    rawArgv: parsed.rawArgv,
    argv: parsed.argv,
    port: parsed.port ?? SOURCE_SERVER_DEFAULT_PORT,
    home,
    helpRequested: parsed.helpRequested,
    versionRequested: parsed.versionRequested,
    subcommandOptions: parsed.subcommandOptions,
  };
}

export { buildCliConfig };
