import type { TCliSubcommandOptions } from './parse-argv';
import type { TOmnidrawHome } from '@omnidraw/shared-functions/omnidraw-config/fn.resolve-omnidraw-home';

export interface ICliConfig {
  cwd: string;
  dev: boolean;
  compiled: boolean;
  version: string;
  command: 'serve' | 'canvas' | 'upgrade' | 'uninstall' | 'unknown';
  subcommand?: string;
  rawArgv: string[];
  argv: string[];
  port: number;
  home: TOmnidrawHome;
  helpRequested: boolean;
  versionRequested: boolean;
  upgradeTarget?: string;
  subcommandOptions?: TCliSubcommandOptions;
}
