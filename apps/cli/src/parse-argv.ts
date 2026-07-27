import { parseArgs } from 'util';

type TCliCommand = 'serve' | 'canvas' | 'upgrade' | 'uninstall' | 'unknown';

type TCliSubcommandOptions = {
  dryRun?: boolean;
  json?: boolean;
};

class CliArgvError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CliArgvError';
    this.code = code;
  }
}

type TCliParsedArgv = {
  rawArgv: string[];
  argv: string[];
  command: TCliCommand;
  subcommand?: string;
  port?: number;
  dataDir?: string;
  helpRequested: boolean;
  versionRequested: boolean;
  upgradeTarget?: string;
  subcommandOptions?: TCliSubcommandOptions;
};

function getDefaultCommand(commandToken: string | undefined): TCliCommand {
  if (commandToken === 'canvas') return 'canvas';
  if (commandToken === 'upgrade') return 'upgrade';
  if (commandToken === 'uninstall') return 'uninstall';
  if (commandToken === undefined || /^\d+$/.test(commandToken)) return 'serve';
  if (commandToken === 'serve') return 'serve';
  if (commandToken.startsWith('-')) return 'serve';
  return 'unknown';
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number.parseInt(value, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function validateOptionValue(flag: string, value: string | undefined, missingValueCode: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.trim().length === 0) {
    throw new CliArgvError('CLI_FLAG_EMPTY_VALUE', `${flag} requires a non-empty value.`);
  }
  if (value.startsWith('-')) {
    throw new CliArgvError(missingValueCode, `${flag} requires a path value. Received option token '${value}' instead.`);
  }
  return value;
}

function parseCliArgv(rawArgv: readonly string[] = Bun.argv): TCliParsedArgv {
  const argv = [...rawArgv];
  const removedDbFlag = argv.find((value) => value === '--db' || value.startsWith('--db='));
  if (removedDbFlag !== undefined) {
    throw new CliArgvError('CLI_FLAG_REMOVED', '--db is no longer supported. Use --data-dir to select the Vibecanvas home.');
  }
  if (argv.at(-1) === '--data-dir') {
    throw new CliArgvError('DATA_DIR_FLAG_MISSING_VALUE', '--data-dir requires a path value.');
  }
  const { values, positionals } = parseArgs({
    args: argv,
    strict: false,
    allowPositionals: true,
    options: {
      version: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      port: { type: 'string' },
      'data-dir': { type: 'string' },
      upgrade: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });

  const commandToken = positionals[2];
  const command = getDefaultCommand(commandToken);

  return {
    rawArgv: [...rawArgv],
    argv,
    command,
    subcommand: command === 'canvas' ? positionals[3] : command === 'unknown' ? commandToken : undefined,
    port: parsePort(typeof values.port === 'string' ? values.port : /^\d+$/.test(commandToken ?? '') ? commandToken : undefined),
    dataDir: validateOptionValue(
      '--data-dir',
      typeof values['data-dir'] === 'string' ? values['data-dir'] : undefined,
      'DATA_DIR_FLAG_MISSING_VALUE',
    ),
    helpRequested: values.help === true,
    versionRequested: values.version === true,
    upgradeTarget: typeof values.upgrade === 'string' ? values.upgrade : undefined,
    subcommandOptions: {
      dryRun: values['dry-run'] === true,
      json: values.json === true,
    },
  };
}

export { CliArgvError, parseCliArgv };
export type { TCliCommand, TCliParsedArgv, TCliSubcommandOptions };
