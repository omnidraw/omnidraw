import type { ICanvasService } from '@omnidraw/service-canvas';
import type { TCanvasDatabaseCapability } from '../interface';

type TCanvasApiContext = {
  canvas: ICanvasService;
  db: TCanvasDatabaseCapability;
};

export type { TCanvasApiContext };
