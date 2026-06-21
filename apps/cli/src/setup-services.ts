import { createServiceRegistry } from '@vibecanvas/runtime';
import { ActorService } from '@vibecanvas/service-actor';
import { AutomergeService } from '@vibecanvas/service-automerge/AutomergeService';
import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { FilesystemServiceNode } from '@vibecanvas/service-filesystem/FilesystemServiceNode';
import type { IFilesystemService } from '@vibecanvas/service-filesystem/IFilesystemService';
import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';
import { PtyServiceBunPty } from '@vibecanvas/service-pty/PtyServiceBunPty';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { ICliConfig } from './config';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ACTOR_WORKER_DIST_PATH = resolve(REPO_ROOT, 'apps/worker/dist/worker.mjs');

export interface IRuntimeServices {
  automerge: IAutomergeService;
  db: DbServiceTurso;
  eventPublisher: IEventPublisherService;
  filesystem: IFilesystemService;
  pty: IPtyService;
  actor: ActorService;
}

declare module '@vibecanvas/runtime' {
  interface IServiceMap extends IRuntimeServices { }
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

  const dbService = new DbServiceTurso({
    databasePath: config.dbPath,
    dataDir: config.xdgPaths.dataDirPath,
    cacheDir: config.xdgPaths.cacheDirPath,
    silentMigrations: process.env.VIBECANVAS_SILENT_DB_MIGRATIONS === '1',
  });
  const filesystemService = new FilesystemServiceNode(eventPublisher);
  const ptyService = new PtyServiceBunPty();

  services.provide('db', 20, dbService);
  services.provide('filesystem', 30, filesystemService);
  services.provide('pty', 40, ptyService);

  const automergeService = new AutomergeService(dbService.db, {
    async onElementCreate(canvasId, element) {
      if (element.data.type === 'widget' && element.data.actorDefinitionName) {
        await services.require('actor').createInstance(element.data.actorDefinitionName, canvasId, element.id)
      }
    },
    async onElementDelete(canvasId, element) {
      if (element.data.type === 'widget' && element.data.actorInstanceId) {
        await services.require('actor').removeInstance(element.data.actorInstanceId)
      }
    },
  },
  );
  services.provide('automerge', 50, automergeService);

  if (config.command !== 'serve') {
    // TODO
    // services.provide('widgetSource', 52, createWidgetSourceService({ db: dbService.actor }));
  }

  if (config.command === 'serve') {
    const actorService = new ActorService({
      db: dbService,
      configPath: config.xdgPaths.configDirPath,
      eventPublisherService: eventPublisher
    }
      //   {
      //   db: dbService.actor,
      //   workflowDb,
      //   eventPublisher,
      //   workerDistPath: ACTOR_WORKER_DIST_PATH,
      //   sandboxRunner: createActorSandboxRunner(config, dbService.sandbox),
      //   startSandboxInBackground: config.dev,
      //   workerEnv: {
      //     VIBECANVAS_DATA_DIR: ACTOR_SANDBOX_HOST_DATA_DIR,
      //     VIBECANVAS_DB_PATH: `${ACTOR_SANDBOX_HOST_DATA_DIR}/${basename(config.dbPath)}`,
      //     VIBECANVAS_CACHE_DIR: `${ACTOR_SANDBOX_HOST_DATA_DIR}/cache`,
      //     VIBECANVAS_MIGRATIONS_SILENT: '1',
      //   },
      // }
    );
    services.provide('actor', 60, actorService);
  }

  return { services, automergeService, dbService, eventPublisher, filesystemService, ptyService };
}

export { setupServices };
