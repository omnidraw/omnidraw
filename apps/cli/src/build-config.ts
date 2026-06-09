import { txEnsureXdgPaths } from '@vibecanvas/shared-functions/vibecanvas-config/tx.xdg-paths';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { ICliConfig } from './config';
import type { TCliParsedArgv } from './parse-argv';

function getDefaultPort(compiled: boolean): number {
  return compiled ? 7496 : 3000;
}

function buildCliConfig(parsed: TCliParsedArgv): ICliConfig {
  const compiled =
    (typeof VIBECANVAS_COMPILED !== 'undefined' && VIBECANVAS_COMPILED) ||
    process.env.VIBECANVAS_COMPILED === 'true';
  const dev = !compiled;
  const version =
    (typeof VIBECANVAS_VERSION !== 'undefined' && VIBECANVAS_VERSION) ||
    process.env.VIBECANVAS_VERSION ||
    '0.0.0';
  const resolved = txEnsureXdgPaths({ fs: { existsSync, mkdirSync } }, { isCompiled: compiled });

  const dbPath = parsed.dbPath ?? resolved.databasePath;
  mkdirSync(dirname(dbPath), { recursive: true });

  return {
    cwd: process.cwd(),
    dev,
    compiled,
    version,
    command: parsed.command,
    subcommand: parsed.subcommand,
    rawArgv: parsed.rawArgv,
    argv: parsed.argv,
    port: parsed.port ?? getDefaultPort(compiled),
    dbPath,
    xdgPaths: {
      cacheDirPath: resolved.paths.cacheDir,
      configDirPath: resolved.paths.configDir,
      dataDirPath: resolved.paths.dataDir,
      stateDirPath: resolved.paths.stateDir
    },
    helpRequested: parsed.helpRequested,
    versionRequested: parsed.versionRequested,
    upgradeTarget: parsed.upgradeTarget,
    subcommandOptions: parsed.subcommandOptions,
  };
}

export { buildCliConfig };
