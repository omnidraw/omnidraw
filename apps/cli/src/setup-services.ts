import { createServiceRegistry } from '@vibecanvas/runtime';
import { AutomergeService } from '@vibecanvas/service-automerge/AutomergeServer';
import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import { DbServiceBunSqlite } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { FilesystemServiceNode } from '@vibecanvas/service-filesystem/FilesystemServiceNode';
import type { IFilesystemService } from '@vibecanvas/service-filesystem/IFilesystemService';
import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';
import { PtyServiceBunPty } from '@vibecanvas/service-pty/PtyServiceBunPty';
import type { Database } from 'bun:sqlite';
import type { ICliConfig } from './config';

declare module '@vibecanvas/runtime' {
  interface IServiceMap {
    automerge: IAutomergeService;
    db: IDbService;
    eventPublisher: IEventPublisherService;
    filesystem: IFilesystemService;
    pty: IPtyService;
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

  return { services, automergeService, dbService, eventPublisher, filesystemService, ptyService };
}

export { setupServices };

