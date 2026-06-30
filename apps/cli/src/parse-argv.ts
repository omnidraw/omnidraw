import { parseArgs } from 'util';

type TCliCommand = 'serve' | 'upgrade' | 'unknown';

type TCliSubcommandOptions = {
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
  dbPath?: string;
  helpRequested: boolean;
  versionRequested: boolean;
  upgradeTarget?: string;
  subcommandOptions?: TCliSubcommandOptions;
};

function getDefaultCommand(commandToken: string | undefined): TCliCommand {
  if (commandToken === 'upgrade') return 'upgrade';
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

function validateOptionValue(flag: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.trim().length === 0) {
    throw new CliArgvError('CLI_FLAG_EMPTY_VALUE', `${flag} requires a non-empty value.`);
  }
  if (value.startsWith('-')) {
    throw new CliArgvError('DB_FLAG_MISSING_VALUE', `${flag} requires a path value. Received option token '${value}' instead.`);
  }
  return value;
}

function parseCliArgv(rawArgv: readonly string[] = Bun.argv): TCliParsedArgv {
  const argv = [...rawArgv];
  const { values, positionals } = parseArgs({
    args: argv,
    strict: false,
    allowPositionals: true,
    options: {
      version: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      port: { type: 'string' },
      db: { type: 'string' },
      upgrade: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });

  const commandToken = positionals[2];
  const command = getDefaultCommand(commandToken);

  return {
    rawArgv: [...rawArgv],
    argv,
    command,
    subcommand: command === 'unknown' ? commandToken : undefined,
    port: parsePort(typeof values.port === 'string' ? values.port : /^\d+$/.test(commandToken ?? '') ? commandToken : undefined),
    dbPath: validateOptionValue('--db', typeof values.db === 'string' ? values.db : undefined),
    helpRequested: values.help === true,
    versionRequested: values.version === true,
    upgradeTarget: typeof values.upgrade === 'string' ? values.upgrade : undefined,
    subcommandOptions: {
      json: values.json === true,
    },
  };
}

export { CliArgvError, parseCliArgv };
export type { TCliCommand, TCliParsedArgv, TCliSubcommandOptions };
