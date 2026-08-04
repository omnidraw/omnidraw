import { oc, populateContractRouterPaths } from '@orpc/contract';
import { agentContract } from './agent/contract';
import { canvasContract } from './canvas/contract';
import { dbContract } from './db/contract';
import { fileContract } from './file/contract';
import { functionContract } from './function/contract';
import { notificationContract } from './notification/contract';
import { resourceContract } from './resource/contract';
import { widgetContract } from './widget/contract';

const contract = oc.router({
  agent: agentContract,
  canvas: canvasContract,
  db: dbContract,
  file: fileContract,
  function: functionContract,
  notification: notificationContract,
  resource: resourceContract,
  widget: widgetContract,
});

const apiContract = populateContractRouterPaths(
  oc.router({ api: contract }),
);

export {
  agentContract,
  apiContract,
  canvasContract,
  contract,
  dbContract,
  fileContract,
  functionContract,
  notificationContract,
  resourceContract,
  widgetContract,
};
