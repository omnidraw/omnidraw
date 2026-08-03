import type { IRuntimeServices } from '@omnidraw/cli/setup-services';
import type { IPlugin } from '@omnidraw/runtime';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';
import { DEFAULT_CANVAS_CLI_PORTAL, txCmdCanvas } from './cmds/cmd.canvas';
import { fnBuildUnknownCommandError, fnPrintCommandError } from './core/fn.print-command-result';

export function printHelp(): void {
  console.log(`omnidraw - Run your agents in an infinite canvas

Usage:
  omnidraw [command] [options]

Commands:
  serve     Start the omnidraw runtime (default when no command given)
  canvas    Query and mutate a running canvas server

Options:
  --port <number>      Port for server/runtime (default: 3000 dev, 7496 compiled)
  --data-dir <path>    Omnidraw home (default: ~/.omnidraw; env: OMNIDRAW_HOME)
  --dry-run           Preview supported canvas mutations without applying them
  --version, -v        Print version and exit
  --help, -h           Show this help message

Examples:
  omnidraw
  omnidraw serve --port 3001
  omnidraw serve --data-dir ./tmp/omnidraw-home
  omnidraw canvas list --json
  omnidraw canvas query --canvas <id> --kind rect --json
  omnidraw --version
  omnidraw --help
`);
}

function createCliPlugin(): IPlugin<IRuntimeServices, ICliHooks, ICliConfig> {
  return {
    name: 'cli',
    apply(ctx) {
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

        if (ctx.config.command === 'canvas') {
          await txCmdCanvas(DEFAULT_CANVAS_CLI_PORTAL, { config: ctx.config });
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
