/* eslint-disable functional-core/fx-tx-params -- legacy command executor takes command input directly as its second parameter */
import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { TCanvasDoc } from '@vibecanvas/service-automerge/types/canvas-doc';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import { fnNormalizeCanvas, fnResolveCanvasSelection, fnSortIds, type TCanvasSummary } from '../core/fn.canvas';
import { fxLoadCanvasHandleDoc } from '../core/fx.canvas';
import { fnCollectGroupCascade } from '../core/fn.group';
import type { TCanvasCmdErrorDetails } from '../types';

export type TCanvasDeleteInput = {
  canvasId?: string | null;
  canvasNameQuery?: string | null;
  dryRun?: boolean;
  ids?: string[];
};

export type TCanvasDeleteSuccess = {
  ok: true;
  command: 'canvas.delete';
  dryRun: boolean;
  canvas: TCanvasSummary;
  matchedCount: number;
  matchedIds: string[];
  deletedElementIds: string[];
  deletedGroupIds: string[];
};

export type TPortal = {
  dbService: IDbService;
  automergeService: IAutomergeService;
};

function parseDeleteIds(input: TCanvasDeleteInput): string[] {
  const ids = fnSortIds([...new Set((input.ids ?? []).map((value) => value.trim()).filter(Boolean))]);
  if (ids.length > 0) return ids;
  throw { ok: false, command: 'canvas.delete', code: 'CANVAS_DELETE_ID_REQUIRED', message: 'Delete requires at least one id.', canvasId: input.canvasId ?? null, canvasNameQuery: input.canvasNameQuery ?? null } satisfies TCanvasCmdErrorDetails;
}

function resolveDeletionPlan(doc: TCanvasDoc, ids: string[], canvasId: string, canvasNameQuery: string | null): { matchedIds: string[]; deletedElementIds: string[]; deletedGroupIds: string[] } {
  const missingIds = ids.filter((id) => !doc.elements[id] && !doc.groups[id]);
  if (missingIds.length > 0) {
    throw {
      ok: false,
      command: 'canvas.delete',
      code: 'CANVAS_DELETE_TARGET_NOT_FOUND',
      message: `Target ids were not found in canvas '${doc.name}': ${fnSortIds(missingIds).join(', ')}.`,
      canvasId,
      canvasNameQuery,
    } satisfies TCanvasCmdErrorDetails;
  }

  const deletedElementIds = new Set<string>();
  const deletedGroupIds = new Set<string>();

  for (const id of ids) {
    if (doc.elements[id]) {
      deletedElementIds.add(id);
      continue;
    }

    if (doc.groups[id]) {
      const cascade = fnCollectGroupCascade(doc, id);
      for (const groupId of cascade.groupIds) deletedGroupIds.add(groupId);
      for (const elementId of cascade.elementIds) deletedElementIds.add(elementId);
    }
  }

  return {
    matchedIds: fnSortIds(ids),
    deletedElementIds: fnSortIds([...deletedElementIds]),
    deletedGroupIds: fnSortIds([...deletedGroupIds]),
  };
}

export async function txExecuteCanvasDelete(portal: TPortal, input: TCanvasDeleteInput): Promise<TCanvasDeleteSuccess> {
  try {
    const dryRun = input.dryRun === true;
    const ids = parseDeleteIds(input);
    const selectedCanvas = fnResolveCanvasSelection({ rows: await portal.dbService.canvas.listAll(), selector: input, command: 'canvas.delete', actionLabel: 'Delete' });
    const { handle, doc } = await fxLoadCanvasHandleDoc(portal, selectedCanvas);
    const plan = resolveDeletionPlan(doc, ids, selectedCanvas.id, input.canvasNameQuery ?? null);

    if (!dryRun) {
      handle.change((nextDoc) => {
        for (const elementId of plan.deletedElementIds) delete nextDoc.elements[elementId];
        for (const groupId of plan.deletedGroupIds) delete nextDoc.groups[groupId];
      });
      await portal.automergeService.repo.flush([handle.documentId]);
    }

    return {
      ok: true,
      command: 'canvas.delete',
      dryRun,
      canvas: fnNormalizeCanvas(selectedCanvas),
      matchedCount: plan.matchedIds.length,
      matchedIds: plan.matchedIds,
      deletedElementIds: plan.deletedElementIds,
      deletedGroupIds: plan.deletedGroupIds,
    };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'ok' in error && 'code' in error) throw error;
    throw {
      ok: false,
      command: 'canvas.delete',
      code: 'CANVAS_DELETE_FAILED',
      message: error instanceof Error ? error.message : String(error),
      canvasId: input.canvasId,
      canvasNameQuery: input.canvasNameQuery ?? null,
    } satisfies TCanvasCmdErrorDetails;
  }
}
