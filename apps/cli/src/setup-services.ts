import { createServiceRegistry } from '@vibecanvas/runtime';
import { AutomergeService } from '@vibecanvas/service-automerge/AutomergeServer';
import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import { DbServiceBunSqlite, type TDrizzleDb } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { FilesystemServiceNode } from '@vibecanvas/service-filesystem/FilesystemServiceNode';
import type { IFilesystemService } from '@vibecanvas/service-filesystem/IFilesystemService';
import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';
import { PtyServiceBunPty } from '@vibecanvas/service-pty/PtyServiceBunPty';
import { ActorService, type TActorSandboxRunner } from '@vibecanvas/service-actor';
import { SANDBOX_WORKER_DIR, SANDBOX_WORKER_FILE } from '@vibecanvas/service-actor/core/CONSTANTS';
import { ServiceSandbox } from '@vibecanvas/service-sandbox';
import { SqliteWorkflowDb, WorkflowSuperviserService } from '@vibecanvas/service-workflow';
import type { Database } from 'bun:sqlite';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { basename, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { ICliConfig } from './config';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ACTOR_WORKER_DIST_PATH = resolve(REPO_ROOT, 'apps/worker/dist/worker.mjs');
const ACTOR_SANDBOX_HOST_DATA_DIR = '/home/vibecanvas/host-data';

declare module '@vibecanvas/runtime' {
  interface IServiceMap {
    automerge: IAutomergeService;
    db: IDbService;
    eventPublisher: IEventPublisherService;
    filesystem: IFilesystemService;
    pty: IPtyService;
    workflowSuperviser: WorkflowSuperviserService;
    actor: ActorService;
  }
}

function isCanvasSchemaOnlyRequest(config: ICliConfig): boolean {
  return config.command === 'canvas'
    && Boolean(config.subcommandOptions?.schema)
    && (config.subcommand === 'add' || config.subcommand === 'patch');
}

function setupServices(config: ICliConfig) {
  const services = createServiceRegistry();
  const eventPublisher = new EventPublisherService();
  services.provide('eventPublisher', 10, eventPublisher);

  const shouldSetupStatefulServices = !config.helpRequested
    && !config.versionRequested
    && (config.command === 'serve' || (config.command === 'canvas' && !isCanvasSchemaOnlyRequest(config)));

  if (!shouldSetupStatefulServices) {
    return { services, eventPublisher };
  }

  const dbService = new DbServiceBunSqlite({
    databasePath: config.dbPath,
    dataDir: config.dataPath,
    cacheDir: config.cachePath,
    silentMigrations: process.env.VIBECANVAS_SILENT_DB_MIGRATIONS === '1',
  });
  const filesystemService = new FilesystemServiceNode(eventPublisher);
  const ptyService = new PtyServiceBunPty();

  services.provide('db', 20, dbService);
  services.provide('filesystem', 30, filesystemService);
  services.provide('pty', 40, ptyService);

  const automergeService = new AutomergeService(dbService.sqlite as Database);
  services.provide('automerge', 50, automergeService);

  if (config.command === 'serve') {
    ensureActorWorkerBundle(config);
    const workflowDb = new SqliteWorkflowDb({ db: dbService.drizzle });
    const workflowSuperviserService = new WorkflowSuperviserService({ db: workflowDb });
    const actorService = new ActorService({
      db: dbService.drizzle,
      workflowDb,
      workerDistPath: ACTOR_WORKER_DIST_PATH,
      sandboxRunner: createActorSandboxRunner(config, dbService.drizzle),
      workerEnv: {
        VIBECANVAS_DATA_DIR: ACTOR_SANDBOX_HOST_DATA_DIR,
        VIBECANVAS_DB_PATH: `${ACTOR_SANDBOX_HOST_DATA_DIR}/${basename(config.dbPath)}`,
        VIBECANVAS_CACHE_DIR: `${ACTOR_SANDBOX_HOST_DATA_DIR}/cache`,
        VIBECANVAS_MIGRATIONS_SILENT: '1',
      },
    });
    services.provide('workflowSuperviser', 55, workflowSuperviserService);
    services.provide('actor', 60, actorService);
  }

  return { services, automergeService, dbService, eventPublisher, filesystemService, ptyService };
}

function ensureActorWorkerBundle(config: ICliConfig): void {
  if (existsSync(ACTOR_WORKER_DIST_PATH)) return;
  if (!config.dev || config.compiled) return;

  const result = spawnSync('bun', ['--filter', '@vibecanvas/worker', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Failed to build actor worker bundle');
}

function createActorSandboxRunner(config: ICliConfig, db: TDrizzleDb): TActorSandboxRunner {
  return createServiceSandboxActorWorkerRunner(config, db);
}

function createServiceSandboxActorWorkerRunner(config: ICliConfig, db: TDrizzleDb): TActorSandboxRunner {
  return {
    start: async (args) => {
      const sandbox = new ServiceSandbox({
        db,
        namespace: 'actor',
        sandboxName: args.sandboxName,
        workdir: SANDBOX_WORKER_DIR,
        workerFiles: [{ hostPath: args.workerDistPath, sandboxPath: SANDBOX_WORKER_FILE, kind: 'file' }],
        bindMounts: [{ hostPath: config.dataPath, guestPath: ACTOR_SANDBOX_HOST_DATA_DIR }],
        startCommand: { cmd: 'bun', args: [SANDBOX_WORKER_FILE], cwd: SANDBOX_WORKER_DIR },
        env: args.workerEnv,
        replaceSandbox: true,
      });
      await sandbox.start();
      return {
        isHealthy: async () => {
          const script = `const r = await fetch("http://127.0.0.1:${args.controlPort}/health").catch(() => null); if (!r?.ok) process.exit(1); const b = await r.json().catch(() => null); if (!b?.ok) process.exit(1);`;
          const output = await sandbox.shell(`bun -e ${JSON.stringify(script)}`).catch(() => null);
          return Boolean(output?.success);
        },
        stop: async () => {
          await sandbox.stop();
        },
      };
    },
  };
}

export { setupServices };
