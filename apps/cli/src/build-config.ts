import { fnResolveVibecanvasHome } from '@vibecanvas/shared-functions/vibecanvas-config/fn.resolve-vibecanvas-home';
import type { ICliConfig } from './config';
import type { TCliParsedArgv } from './parse-argv';
import { join, resolve } from 'path';
import { homedir } from 'os';

function getDefaultPort(compiled: boolean): number {
  return compiled ? 7496 : 3000;
}

function resolveLegacyActorEnabled(value: string | undefined): boolean {
  if (value === undefined || value === '0' || value === 'false') return false;
  if (value === '1' || value === 'true') return true;
  throw new Error('VIBECANVAS_LEGACY_ACTOR_ENABLED must be one of: 0, 1, false, true.');
}

function buildCliConfig(parsed: TCliParsedArgv): ICliConfig {
  const cwd = process.cwd();
  const compiled =
    (typeof VIBECANVAS_COMPILED !== 'undefined' && VIBECANVAS_COMPILED) ||
    process.env.VIBECANVAS_COMPILED === 'true';
  const dev = !compiled;
  const version =
    (typeof VIBECANVAS_VERSION !== 'undefined' && VIBECANVAS_VERSION) ||
    process.env.VIBECANVAS_VERSION ||
    '0.0.0';
  const home = fnResolveVibecanvasHome({ join, resolve }, {
    cwd,
    dataDir: parsed.dataDir,
    env: process.env,
    homedir: homedir(),
  });

  return {
    cwd,
    dev,
    compiled,
    legacyActorEnabled: resolveLegacyActorEnabled(process.env.VIBECANVAS_LEGACY_ACTOR_ENABLED),
    version,
    command: parsed.command,
    subcommand: parsed.subcommand,
    rawArgv: parsed.rawArgv,
    argv: parsed.argv,
    port: parsed.port ?? getDefaultPort(compiled),
    home,
    helpRequested: parsed.helpRequested,
    versionRequested: parsed.versionRequested,
    upgradeTarget: parsed.upgradeTarget,
    subcommandOptions: parsed.subcommandOptions,
  };
}

export { buildCliConfig, resolveLegacyActorEnabled };
