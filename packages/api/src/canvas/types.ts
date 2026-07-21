import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { TCanvasDatabaseCapability } from '../interface';

type TCanvasAutomergeCapability = Pick<
  IAutomergeService,
  'createDocument' | 'deleteDocument' | 'failDocumentRegistration' | 'notifyDocumentRegistered'
>;

type TCanvasApiContext = {
  db: TCanvasDatabaseCapability;
  automerge: TCanvasAutomergeCapability;
  tenant: TTenantContext;
};

export type { TCanvasApiContext, TCanvasAutomergeCapability };
