import type { TCliSubcommandOptions } from './parse-argv';

export interface ICliConfig {
  cwd: string;
  dev: boolean;
  compiled: boolean;
  version: string;
  command: 'serve' | 'upgrade' | 'unknown';
  subcommand?: string;
  rawArgv: string[];
  argv: string[];
  port: number;
  dbPath: string;
  xdgPaths: {
    configDirPath: string;
    dataDirPath: string;
    cacheDirPath: string;
    stateDirPath: string;
  };
  helpRequested: boolean;
  versionRequested: boolean;
  upgradeTarget?: string;
  subcommandOptions?: TCliSubcommandOptions;
}
