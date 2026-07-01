import { oc, populateContractRouterPaths } from '@orpc/contract';
import { implement, onError } from '@orpc/server';
import { actorsContract } from '@vibecanvas/api-actors/contract';
import { agentContract } from '@vibecanvas/api-agent/contract';
import { canvasContract } from '@vibecanvas/api-canvas/contract';
import { dbContract } from '@vibecanvas/api-db/contract';
import { fileContract } from '@vibecanvas/api-file/contract';
import { filesystemContract } from '@vibecanvas/api-filesystem/contract';
import { notificationContract } from '@vibecanvas/api-notification/contract';
import { ptyContract } from '@vibecanvas/api-pty/contract';
import type { ActorService } from '@vibecanvas/service-actor';
import type { AgentService } from '@vibecanvas/service-agent';
import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type { IFilesystemService } from '@vibecanvas/service-filesystem/IFilesystemService';
import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';

const contract = oc.router({
  actors: actorsContract,
  agent: agentContract,
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

type TOrpcContext = {
  accountId?: string;
  automerge: IAutomergeService;
  db: DbServiceTurso; eventPublisher:
  IEventPublisherService;
  filesystem: IFilesystemService;
  pty: IPtyService;
  actor: ActorService;
  agent: AgentService;
  requestId?: string
}

const baseOs = implement(apiContract)
  .$context<TOrpcContext>()
  .use(onError((error) => {
    console.error(error);
  }));

export { apiContract, baseOs, contract };
