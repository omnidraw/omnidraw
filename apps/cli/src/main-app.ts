import { createRuntime } from '@vibecanvas/runtime';
import { execFile } from 'node:child_process';
import { buildCliConfig } from './build-config';
import type { ICliConfig } from './config';
import { bootCliRuntime, createCliHooks, shutdownCliRuntime } from './hooks';
import { CliArgvError, parseCliArgv } from './parse-argv';
import { createAuthPlugin } from './plugins/auth/AuthPlugin';
import { createAutomergePlugin } from './plugins/automerge/AutomergePlugin';
import { createCliPlugin } from './plugins/cli/CliPlugin';
import { fnPrintCommandError } from './plugins/cli/core/fn.print-command-result';
import { createFilesystemPlugin } from './plugins/filesystem/FilesystemPlugin';
import { createOrpcPlugin } from './plugins/orpc/OrpcPlugin';
import { createPtyPlugin } from './plugins/pty/PtyPlugin';
import { createServerPlugin } from './plugins/server/ServerPlugin';
import { setupSignals } from './setup-signals';
import { txCheckWidgetPrerequisites } from './widget-prerequisites/tx.check-widget-prerequisites';

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
    config = buildCliConfig(parsedArgv);
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

  const { setupServices } = await import('./setup-services');
  const { services, eventPublisher } = setupServices(config);

  void txCheckWidgetPrerequisites({
    execFile: (file, args, options, callback) => {
      execFile(file, [...args], { ...options, encoding: 'utf8' }, callback);
    },
    warn: (message) => console.warn(message),
    publishNotification: (event) => eventPublisher.publishNotification(event),
  }, config);

  const runtime = createRuntime<any, ICliConfig>({
    plugins: [createAuthPlugin(), createFilesystemPlugin(), createCliPlugin(), createOrpcPlugin(), createPtyPlugin(), createAutomergePlugin(), createServerPlugin()],
    services,
    hooks: createCliHooks(),
    config,
    boot: bootCliRuntime,
    shutdown: async (ctx) => {
      await shutdownCliRuntime(ctx);
    },
  });

  setupSignals(async () => {
    await runtime.shutdown();
    process.exit(0);
  });

  await runtime.boot();

  if (config.command !== 'serve') {
    await runtime.shutdown();
    process.exit(process.exitCode ?? 0);
  }
}
