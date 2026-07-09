import { fnXdgPaths } from '@vibecanvas/shared-functions/vibecanvas-config/fn.xdg-paths';
import { txEnsureXdgPaths } from '@vibecanvas/shared-functions/vibecanvas-config/tx.xdg-paths';
import { existsSync, mkdirSync } from 'fs';
import type { ICliConfig } from './config';
import type { TCliParsedArgv } from './parse-argv';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';

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
  const resolved = parsed.command === 'serve'
    ? txEnsureXdgPaths({ fs: { existsSync, mkdirSync }, dirname, join, resolve, process }, { isCompiled: compiled, homedir: homedir() })
    : (() => {
      const paths = fnXdgPaths({ dirname, join, resolve }, {
        env: process.env,
        cwd: process.cwd(),
        homedir: homedir(),
        isCompiled: compiled,
      });
      return { databasePath: paths.databasePath, paths };
    })();

  const dbPath = parsed.dbPath ?? resolved.databasePath;
  if (parsed.command === 'serve') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

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
