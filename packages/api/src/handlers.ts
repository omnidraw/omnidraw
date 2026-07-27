import { agentHandlers } from './agent/handlers';
import { canvasHandlers } from './canvas/handlers';
import { dbHandlers } from './db/handlers';
import { fileHandlers } from './file/handlers';
import { functionHandlers } from './function/handlers';
import { notificationHandlers } from './notification/handlers';
import { resourceHandlers } from './resource/handlers';
import { toolHandlers } from './tool/handlers';
import { widgetHandlers } from './widget/handlers';

const handlers = {
  agent: agentHandlers,
  canvas: canvasHandlers,
  db: dbHandlers,
  file: fileHandlers,
  function: functionHandlers,
  notification: notificationHandlers,
  resource: resourceHandlers,
  tool: toolHandlers,
  widget: widgetHandlers,
};

export {
  agentHandlers,
  canvasHandlers,
  dbHandlers,
  fileHandlers,
  functionHandlers,
  handlers,
  notificationHandlers,
  resourceHandlers,
  toolHandlers,
  widgetHandlers,
};
