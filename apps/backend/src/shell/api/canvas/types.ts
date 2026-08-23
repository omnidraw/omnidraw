import type { ICanvasService } from '#backend/shell/canvas/authority';
import type { TCanvasDatabaseCapability } from '../interface';

type TCanvasApiContext = {
  canvas: ICanvasService;
  db: TCanvasDatabaseCapability;
};

export type { TCanvasApiContext };
