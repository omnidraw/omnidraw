import { execFile } from 'node:child_process';
import { buildCliConfig, SOURCE_APPLICATION_VERSION } from './build-config';
import { fnBuildHomePreflightError } from '../../core/cli/fn.home-preflight-error';
import { CliArgvError, parseCliArgv } from './parse-argv';
import { runCliCommand } from './CliPlugin';
import { fnPrintCommandError } from './runtime/print-command-result';
import { createBackendRuntime } from '../runtime/managed-runtime';
import { LiveEventPublisher } from '../runtime/service.live-mechanics';
import { setupSignals } from '../runtime/setup-signals';
import { checkWidgetPrerequisites } from './widget-prerequisites/check-widget-prerequisites';

export async function runCliMain() {
  const rawArgv = Bun.argv
  const wantsJson = rawArgv.includes('--json')

  function exitArgvError(error: CliArgvError): never {
    fnPrintCommandError({ ok: false, command: null, code: error.code, message: error.message }, wantsJson)
    process.exit(1)
  }

  let parsedArgv
  let config

  try {
    parsedArgv = parseCliArgv(rawArgv);
    config = buildCliConfig(parsedArgv, { version: SOURCE_APPLICATION_VERSION });
  } catch (error) {
    if (error instanceof CliArgvError) {
      exitArgvError(error)
    }
    throw error
  }

  if (config.versionRequested) {
    console.log(config.version);
    return;
  }

  if (config.command !== 'serve' || config.helpRequested) {
    await runCliCommand(config);
    return;
  }

  const { preflightDbServiceDatabase } = await import(
    '#backend/shell/database/DbServiceTurso/DbServiceTurso'
  );
  try {
    await preflightDbServiceDatabase({
      homeDir: config.home.homeDir,
      databasePath: config.home.mainDbPath,
    });
  } catch (error) {
    fnPrintCommandError(fnBuildHomePreflightError({ homeDir: config.home.homeDir, error }), wantsJson);
    return;
  }
  const [{ mkdirSync }, { ensureOmnidrawHome }] = await Promise.all([
    import('node:fs'),
    import('#backend/shell/config/ensure-omnidraw-home'),
  ]);
  ensureOmnidrawHome({ mkdirSync }, { home: config.home });

  const runtime = createBackendRuntime({ config });
  const eventPublisher = await runtime.runPromise(LiveEventPublisher);

  void checkWidgetPrerequisites({
    execFile: (file, args, options, callback) => {
      execFile(file, [...args], { ...options, encoding: 'utf8' }, callback);
    },
    warn: (message) => console.warn(message),
    publishNotification: (event) => eventPublisher.publishNotification(event),
  }, config);

  setupSignals(async () => {
    await runtime.dispose();
    process.exit(0);
  });

  await runtime.context();
}
