import { actorsHandlers } from './actor/handlers';
import { agentHandlers } from './agent/handlers';
import { canvasHandlers } from './canvas/handlers';
import { dbHandlers } from './db/handlers';
import { fileHandlers } from './file/handlers';
import { filesystemHandlers } from './filesystem/handlers';
import { functionHandlers } from './function/handlers';
import { notificationHandlers } from './notification/handlers';
import { ptyHandlers } from './pty/handlers';
import { resourceHandlers } from './resource/handlers';
import { toolHandlers } from './tool/handlers';

const handlers = {
  actors: actorsHandlers,
  agent: agentHandlers,
  canvas: canvasHandlers,
  db: dbHandlers,
  file: fileHandlers,
  filesystem: filesystemHandlers,
  function: functionHandlers,
  notification: notificationHandlers,
  pty: ptyHandlers,
  resource: resourceHandlers,
  tool: toolHandlers,
};

export {
  actorsHandlers,
  agentHandlers,
  canvasHandlers,
  dbHandlers,
  fileHandlers,
  filesystemHandlers,
  functionHandlers,
  handlers,
  notificationHandlers,
  ptyHandlers,
  resourceHandlers,
  toolHandlers,
};
