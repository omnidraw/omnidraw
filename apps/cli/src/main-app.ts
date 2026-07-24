import { createRuntime } from '@vibecanvas/runtime';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildCliConfig } from './build-config';
import type { ICliConfig } from './config';
import { fnBuildHomePreflightError } from './fn.home-preflight-error';
import { bootCliRuntime, createCliHooks, shutdownCliRuntime } from './hooks';
import { CliArgvError, parseCliArgv } from './parse-argv';
import { createAuthPlugin, OSS_FAKE_SESSION, OSS_TENANT_CONTEXT_PROVIDER } from './plugins/auth/AuthPlugin';
import { createAutomergePlugin } from './plugins/automerge/AutomergePlugin';
import { createCliPlugin } from './plugins/cli/CliPlugin';
import { fnPrintCommandError } from './plugins/cli/core/fn.print-command-result';
import { createOrpcPlugin } from './plugins/orpc/OrpcPlugin';
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

  if (config.command === 'serve' && !config.helpRequested) {
    const [{ existsSync }, { join }, { preflightDbServiceDatabase }] = await Promise.all([
      import('node:fs'),
      import('node:path'),
      import('@vibecanvas/service-db/DbServiceTurso/DbServiceTurso'),
    ]);
    try {
      const actorEraDatabasePath = join(config.home.homeDir, 'vibecanvas.turso');
      if (existsSync(actorEraDatabasePath)) {
        throw new Error(`Actor-era database found at ${actorEraDatabasePath}`);
      }
      await preflightDbServiceDatabase({
        homeDir: config.home.homeDir,
        databasePath: config.home.mainDbPath,
      });
    } catch (error) {
      fnPrintCommandError(fnBuildHomePreflightError({ homeDir: config.home.homeDir, error }), wantsJson);
      return;
    }
    const [{ mkdirSync }, { txEnsureVibecanvasHome }] = await Promise.all([
      import('node:fs'),
      import('@vibecanvas/shared-functions/vibecanvas-config/tx.ensure-vibecanvas-home'),
    ]);
    txEnsureVibecanvasHome({ mkdirSync }, { home: config.home });
  }

  const { setupServices } = await import('./setup-services');
  const { services, eventPublisher } = setupServices(config);

  if (config.command === 'serve' && !config.helpRequested) {
    void OSS_TENANT_CONTEXT_PROVIDER.resolveTenantContext({
      requestId: crypto.randomUUID(),
      session: OSS_FAKE_SESSION,
    }).then((tenant) => txCheckWidgetPrerequisites({
        execFile: (file, args, options, callback) => {
          execFile(file, [...args], { ...options, encoding: 'utf8' }, callback);
        },
        readFileSha256: async (path) => (
          `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`
        ),
        warn: (message) => console.warn(message),
        publishNotification: (event) => eventPublisher.publishNotification(tenant, event),
    }, {
      ...config,
      environment: process.env,
      platform: process.platform,
    }));
  }

  const runtime = createRuntime<any, ICliConfig>({
    plugins: [
      createAuthPlugin(),
      createCliPlugin(),
      createOrpcPlugin(),
      createAutomergePlugin(),
      createServerPlugin(),
    ],
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
