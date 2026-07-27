import { apiCreateCanvas } from './api.create-canvas';
import { apiGetCanvas } from './api.get-canvas';
import { apiListCanvas } from './api.list-canvas';
import { apiRemoveCanvas } from './api.remove-canvas';
import { apiUpdateCanvas } from './api.update-canvas';
import { baseCanvasOs } from './orpc';

const canvasHandlers = {
  list: apiListCanvas,
  get: apiGetCanvas,
  create: apiCreateCanvas,
  update: apiUpdateCanvas,
  remove: apiRemoveCanvas,
};

export { baseCanvasOs, canvasHandlers };
