import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { TCanvasDatabaseCapability } from '../interface';

type TCanvasAutomergeCapability = Pick<
  IAutomergeService,
  'failDocumentRegistration' | 'notifyDocumentRegistered'
> & {
  repo: Pick<IAutomergeService['repo'], 'create' | 'delete'>;
};

type TCanvasApiContext = {
  accountId?: string;
  db: TCanvasDatabaseCapability;
  automerge: TCanvasAutomergeCapability;
  requestId?: string;
};

export type { TCanvasApiContext, TCanvasAutomergeCapability };
