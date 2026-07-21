import { oc, populateContractRouterPaths } from '@orpc/contract';
import { actorsContract } from './actor/contract';
import { agentContract } from './agent/contract';
import { canvasContract } from './canvas/contract';
import { dbContract } from './db/contract';
import { fileContract } from './file/contract';
import { filesystemContract } from './filesystem/contract';
import { notificationContract } from './notification/contract';
import { ptyContract } from './pty/contract';
import { toolContract } from './tool/contract';

const contract = oc.router({
  actors: actorsContract,
  agent: agentContract,
  canvas: canvasContract,
  db: dbContract,
  file: fileContract,
  filesystem: filesystemContract,
  notification: notificationContract,
  pty: ptyContract,
  tool: toolContract,
});

const apiContract = populateContractRouterPaths(
  oc.router({ api: contract }),
);

export {
  actorsContract,
  agentContract,
  apiContract,
  canvasContract,
  contract,
  dbContract,
  fileContract,
  filesystemContract,
  notificationContract,
  ptyContract,
  toolContract,
};
