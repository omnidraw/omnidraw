import { fnResolveOmnidrawHome } from '@omnidraw/shared-functions/omnidraw-config/fn.resolve-omnidraw-home';
import type { ICliConfig } from './config';
import type { TCliParsedArgv } from './parse-argv';
import { join, resolve } from 'path';
import { homedir } from 'os';

function getDefaultPort(compiled: boolean): number {
  return compiled ? 7496 : 3000;
}

function buildCliConfig(parsed: TCliParsedArgv): ICliConfig {
  const cwd = process.cwd();
  const compiled =
    (typeof OMNIDRAW_COMPILED !== 'undefined' && OMNIDRAW_COMPILED) ||
    process.env.OMNIDRAW_COMPILED === 'true';
  const dev = !compiled;
  const version =
    (typeof OMNIDRAW_VERSION !== 'undefined' && OMNIDRAW_VERSION) ||
    process.env.OMNIDRAW_VERSION ||
    '0.0.0';
  const home = fnResolveOmnidrawHome({ join, resolve }, {
    cwd,
    dataDir: parsed.dataDir,
    env: process.env,
    homedir: homedir(),
  });

  return {
    cwd,
    dev,
    compiled,
    version,
    command: parsed.command,
    subcommand: parsed.subcommand,
    rawArgv: parsed.rawArgv,
    argv: parsed.argv,
    port: parsed.port ?? getDefaultPort(compiled),
    home,
    helpRequested: parsed.helpRequested,
    versionRequested: parsed.versionRequested,
    subcommandOptions: parsed.subcommandOptions,
  };
}

export { buildCliConfig };
