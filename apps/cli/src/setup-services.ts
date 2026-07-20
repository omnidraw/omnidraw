import { createServiceRegistry } from '@vibecanvas/runtime';
import { ActorService, SecretStoreDatabaseKeyProvider } from '@vibecanvas/service-actor';
import { AutomergeService } from '@vibecanvas/service-automerge/AutomergeService';
import { AgentService } from '@vibecanvas/service-agent';
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
  agent: AgentService;
}

declare module '@vibecanvas/runtime' {
  interface IServiceMap extends IRuntimeServices { }
}

function setupServices(config: ICliConfig) {
  const services = createServiceRegistry();
  const eventPublisher = new EventPublisherService();
  services.provide('eventPublisher', 10, eventPublisher);

  const shouldSetupStatefulServices = !config.helpRequested
    && !config.versionRequested
    && config.command === 'serve';

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
    async onElementCreate(event, handle) {
      try {
        const element = event.element;
        if (element.data.type !== 'widget' || !element.data.actorDefinitionName) return;

        const canvases = await dbService.canvas.listAll();
        const canvas = canvases.find(row => row.automerge_url === event.automergeUrl);
        if (!canvas) return;

        const actor = await services.require('actor').createInstance(element.data.actorDefinitionName, canvas.id, element.id)
        if (actor === null) return

        handle.change((doc) => {
          const currentElement = doc.elements[element.id];
          if (!currentElement) return;
          if (currentElement.data.type !== 'widget') return;

          currentElement.data.actorInstanceId = actor.getId();
          currentElement.updatedAt = Date.now();
        });
      } catch (error) {
        eventPublisher.publishNotification({
          type: 'error',
          title: 'Failed to create widget actor',
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    async onElementDelete(event, handle) {
      try {
        const element = event.element;
        if (element.data.type === 'widget') {
          const instance = await dbService.actor.getInstanceByElementId(event.element.id)
          if (!instance) return
          await services.require('actor').removeInstance(instance.id)
        }
      } catch (error) {
        eventPublisher.publishNotification({
          type: 'error',
          title: 'Failed to remove widget actor',
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
  },
  );
  services.provide('automerge', 50, automergeService);

  if (config.command === 'serve') {
    const secretStoreKeyProvider = new SecretStoreDatabaseKeyProvider({
      encryptionKeys: dbService.actorResourceEncryptionKey,
    });
    const actorService = new ActorService({
      db: dbService,
      configPath: config.xdgPaths.configDirPath,
      dataRoot: config.xdgPaths.dataDirPath,
      secretStoreKeyProvider,
      eventPublisherService: eventPublisher
    });
    const agentService = new AgentService({
      dataPath: config.xdgPaths.dataDirPath,
      cachePath: config.xdgPaths.cacheDirPath,
      configPath: config.xdgPaths.configDirPath,
      eventPublisherService: eventPublisher,
      actorService
    })
    services.provide('actor', 60, actorService);
    services.provide('agent', 62, agentService);
  }

  return { services, automergeService, dbService, eventPublisher, filesystemService, ptyService };
}

export { setupServices };
