import type { TCliSubcommandOptions } from './parse-argv';
import type { TVibecanvasHome } from '@vibecanvas/shared-functions/vibecanvas-config/fn.resolve-vibecanvas-home';

export interface ICliConfig {
  cwd: string;
  dev: boolean;
  compiled: boolean;
  version: string;
  command: 'serve' | 'upgrade' | 'uninstall' | 'unknown';
  subcommand?: string;
  rawArgv: string[];
  argv: string[];
  port: number;
  home: TVibecanvasHome;
  helpRequested: boolean;
  versionRequested: boolean;
  upgradeTarget?: string;
  subcommandOptions?: TCliSubcommandOptions;
}
