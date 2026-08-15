import type { ICliConfig } from './config';
import { DEFAULT_CANVAS_CLI_SHELL, runCanvasCommand } from './cmds/cmd.canvas';
import { runWidgetCommand } from './cmds/cmd.widget';
import { fnBuildUnknownCommandError, fnPrintCommandError } from './runtime/print-command-result';

export function printHelp(): void {
  console.log(`omnidraw - Run your agents in an infinite canvas

Usage:
  omnidraw [command] [options]

Commands:
  serve     Start the omnidraw runtime (default when no command given)
  canvas    Query and mutate a running canvas server
  widget    Verify widget drafts through the running server

Options:
  --port <number>      Port for the source-run server (default: 3000)
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
  omnidraw widget validate --widget-key little-pomodoro --json
  omnidraw --version
  omnidraw --help
`);
}

async function runCliCommand(config: ICliConfig): Promise<void> {
  const wantsJson = config.subcommandOptions?.json === true;
  if (config.command === 'unknown') {
    fnPrintCommandError(fnBuildUnknownCommandError('root', config.subcommand), wantsJson);
    if (!wantsJson) printHelp();
    process.exitCode = 1;
    return;
  }
  if (config.command === 'canvas') {
    await runCanvasCommand({ config, shell: DEFAULT_CANVAS_CLI_SHELL });
    return;
  }
  if (config.command === 'widget') {
    await runWidgetCommand({ config });
    return;
  }
  if (config.helpRequested) {
    printHelp();
    process.exitCode = 0;
  }
}

export { runCliCommand };
