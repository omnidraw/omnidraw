import type { IDbService } from '@vibecanvas/service-db/IDbService';
import { toIsoString } from '../core/fn.conversion';
import type { TCanvasCmdErrorDetails } from '../types';

export type TCanvasInventoryEntry = {
  id: string;
  name: string;
  createdAt: string;
  automergeUrl: string;
};

export type TCanvasListSuccess = {
  ok: true;
  command: 'canvas';
  subcommand: 'list';
  count: number;
  canvases: TCanvasInventoryEntry[];
};

export type TPortal = {
  dbService: IDbService
}

export async function fxExecuteCanvasList(portal: TPortal): Promise<TCanvasListSuccess> {
  try {

    const canvases = (await portal.dbService.canvas.listAll())
      .sort((left, right) => {
        const leftCreatedAt = Number(left.created_at);
        const rightCreatedAt = Number(right.created_at);
        if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
        if (left.name !== right.name) return left.name.localeCompare(right.name);
        return left.id.localeCompare(right.id);
      })
      .map(row => ({
        id: row.id,
        name: row.name,
        createdAt: toIsoString(row.created_at),
        automergeUrl: row.automerge_url,
      } satisfies TCanvasInventoryEntry))

    return {
      ok: true,
      command: 'canvas',
      subcommand: 'list',
      count: canvases.length,
      canvases,
    };
  } catch (error) {
    const errorDetails: TCanvasCmdErrorDetails = {
      ok: false,
      command: 'canvas',
      code: 'CANVAS_LIST_FAILED',
      message: error instanceof Error ? error.message : String(error),
    };
    throw errorDetails;
  }
}
