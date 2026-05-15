import { oc, populateContractRouterPaths } from '@orpc/contract';
import { implement, onError } from '@orpc/server';
import { actorsContract } from '@vibecanvas/api-actors/contract';
import { canvasContract } from '@vibecanvas/api-canvas/contract';
import { dbContract } from '@vibecanvas/api-db/contract';
import { fileContract } from '@vibecanvas/api-file/contract';
import { filesystemContract } from '@vibecanvas/api-filesystem/contract';
import { notificationContract } from '@vibecanvas/api-notification/contract';
import { ptyContract } from '@vibecanvas/api-pty/contract';
import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type { IFilesystemService } from '@vibecanvas/service-filesystem/IFilesystemService';
import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';

const contract = oc.router({
  actors: actorsContract,
  canvas: canvasContract,
  db: dbContract,
  file: fileContract,
  filesystem: filesystemContract,
  notification: notificationContract,
  pty: ptyContract,
});

const apiContract = populateContractRouterPaths(
  oc.router({ api: contract }),
);

const baseOs = implement(apiContract)
  .$context<{ accountId?: string; automerge: IAutomergeService; db: IDbService; eventPublisher: IEventPublisherService; filesystem: IFilesystemService; pty: IPtyService; requestId?: string }>()
  .use(onError((error) => {
    console.error(error);
  }));

export { apiContract, baseOs, contract };
