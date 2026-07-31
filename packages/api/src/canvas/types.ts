import type { ICanvasService } from '@omnidraw/service-canvas';
import type { TTenantContext } from '@omnidraw/tenant-core';
import type { TCanvasDatabaseCapability } from '../interface';

type TCanvasApiContext = {
  canvas: ICanvasService;
  db: TCanvasDatabaseCapability;
  tenant: TTenantContext;
};

export type { TCanvasApiContext };
