import { apiCanvasEvents } from './api.canvas-events';
import { apiCreateCanvas } from './api.create-canvas';
import { apiExecuteCanvasCommand } from './api.execute-canvas-command';
import { apiGetCanvas } from './api.get-canvas';
import { apiGetCanvasSnapshot } from './api.get-canvas-snapshot';
import { apiListCanvas } from './api.list-canvas';
import { apiQueryCanvasItems } from './api.query-canvas-items';
import { apiRemoveCanvas } from './api.remove-canvas';
import { apiUpdateCanvas } from './api.update-canvas';
import { baseCanvasOs } from './procedure-builder';

const canvasHandlers = {
  list: apiListCanvas,
  get: apiGetCanvas,
  create: apiCreateCanvas,
  update: apiUpdateCanvas,
  deletionPlan: baseCanvasOs.deletionPlan.handler(() => {
    throw new Error('Canvas deletion planning is owned by the semantic transport adapter.');
  }),
  remove: apiRemoveCanvas,
  snapshot: apiGetCanvasSnapshot,
  query: apiQueryCanvasItems,
  execute: apiExecuteCanvasCommand,
  events: apiCanvasEvents,
};

export { baseCanvasOs, canvasHandlers };
