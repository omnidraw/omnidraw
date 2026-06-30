import type { IRuntimeServices } from '@vibecanvas/cli/setup-services';
import type { IPlugin } from '@vibecanvas/runtime';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';
import { txCmdUpgrade } from './cmds/cmd.upgrade';
import { fnBuildUnknownCommandError, fnPrintCommandError } from './core/fn.print-command-result';

export function printHelp(): void {
  console.log(`vibecanvas - Run your agents in an infinite canvas

Usage:
  vibecanvas [command] [options]

Commands:
  serve     Start the vibecanvas runtime (default when no command given)
  upgrade   Check for and install updates

Options:
  --port <number>      Port for server/runtime (default: 3000 dev, 7496 compiled)
  --db <path>          Explicit SQLite file path override
  --upgrade <version>  Upgrade to a specific version
  --version, -v        Print version and exit
  --help, -h           Show this help message

Examples:
  vibecanvas
  vibecanvas serve --port 3001
  vibecanvas serve --db ./tmp/dev.sqlite
  vibecanvas upgrade
  vibecanvas upgrade --check
  vibecanvas --version
  vibecanvas --help
`);
}

function createCliPlugin(): IPlugin<IRuntimeServices, ICliHooks, ICliConfig> {
  return {
    name: 'cli',
    apply(ctx) {
      ctx.hooks.boot.tapPromise(async () => {
        if (ctx.config.command === 'upgrade' || ctx.config.upgradeTarget !== undefined) {
          await txCmdUpgrade({ config: ctx.config });
        }
      });

      ctx.hooks.ready.tapPromise(async () => {
        const wantsJson = ctx.config.subcommandOptions?.json === true;

        if (ctx.config.versionRequested) {
          console.log(ctx.config.version);
          process.exitCode = 0;
          return;
        }

        if (ctx.config.command === 'unknown') {
          fnPrintCommandError(fnBuildUnknownCommandError('root', ctx.config.subcommand), wantsJson);
          if (!wantsJson) printHelp();
          process.exitCode = 1;
          return;
        }

        if (ctx.config.helpRequested) {
          printHelp();
          process.exitCode = 0;
        }
      });
    },
  };
}

export { createCliPlugin };
