import type { ICanvasService } from '@vibecanvas/service-canvas';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { TCanvasDatabaseCapability } from '../interface';

type TCanvasApiContext = {
  canvas: ICanvasService;
  db: TCanvasDatabaseCapability;
  tenant: TTenantContext;
};

export type { TCanvasApiContext };
