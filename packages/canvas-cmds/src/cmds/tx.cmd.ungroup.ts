/* eslint-disable functional-core/fx-tx-params -- legacy command executor takes command input directly as its second parameter */
import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { TCanvasDoc } from '@vibecanvas/service-automerge/types/canvas-doc';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import { fnNormalizeCanvas, fnResolveCanvasSelection, fnSortIds, type TCanvasSummary } from '../core/fn.canvas';
import { fxLoadCanvasHandleDoc } from '../core/fx.canvas';
import { fnCollectDirectChildIds } from '../core/fn.group';
import type { TCanvasCmdErrorDetails } from '../types';

export type TCanvasUngroupInput = {
  canvasId?: string | null;
  canvasNameQuery?: string | null;
  dryRun?: boolean;
  ids?: string[];
};

export type TCanvasUngroupSuccess = {
  ok: true;
  command: 'canvas.ungroup';
  dryRun: boolean;
  canvas: TCanvasSummary;
  matchedCount: number;
  matchedIds: string[];
  removedGroupCount: number;
  removedGroupIds: string[];
  releasedChildCount: number;
  releasedChildIds: string[];
};

export type TPortal = {
  dbService: IDbService;
  automergeService: IAutomergeService;
};

function parseUngroupIds(input: TCanvasUngroupInput): string[] {
  const ids = fnSortIds([...new Set((input.ids ?? []).map((value) => value.trim()).filter(Boolean))]);
  if (ids.length > 0) return ids;
  throw {
    ok: false,
    command: 'canvas.ungroup',
    code: 'CANVAS_UNGROUP_ID_REQUIRED',
    message: 'Ungroup requires at least one id.',
    canvasId: input.canvasId,
    canvasNameQuery: input.canvasNameQuery ?? null,
  } satisfies TCanvasCmdErrorDetails;
}

function resolveGroupsByIds(doc: TCanvasDoc, ids: string[], canvasId: string, canvasNameQuery: string | null) {
  const missingIds = ids.filter((id) => !doc.elements[id] && !doc.groups[id]);
  if (missingIds.length > 0) {
    throw {
      ok: false,
      command: 'canvas.ungroup',
      code: 'CANVAS_UNGROUP_TARGET_NOT_FOUND',
      message: `Target ids were not found in canvas '${doc.name}': ${fnSortIds(missingIds).join(', ')}.`,
      canvasId,
      canvasNameQuery,
    } satisfies TCanvasCmdErrorDetails;
  }

  const elementIds = ids.filter((id) => Boolean(doc.elements[id]));
  if (elementIds.length > 0) {
    throw {
      ok: false,
      command: 'canvas.ungroup',
      code: 'CANVAS_UNGROUP_TARGET_KIND_INVALID',
      message: `Ungroup currently supports group ids only. Received element ids: ${fnSortIds(elementIds).join(', ')}.`,
      canvasId,
      canvasNameQuery,
    } satisfies TCanvasCmdErrorDetails;
  }

  return ids.map((id) => doc.groups[id]!).filter(Boolean);
}

function resolveSurvivingParentGroupId(doc: TCanvasDoc, removedGroupIds: Set<string>, groupId: string): string | null {
  let parentGroupId = doc.groups[groupId]?.parentGroupId ?? null;
  const visited = new Set<string>();

  while (parentGroupId && removedGroupIds.has(parentGroupId)) {
    if (visited.has(parentGroupId)) break;
    visited.add(parentGroupId);
    parentGroupId = doc.groups[parentGroupId]?.parentGroupId ?? null;
  }

  return parentGroupId;
}

export async function txExecuteCanvasUngroup(portal: TPortal, input: TCanvasUngroupInput): Promise<TCanvasUngroupSuccess> {
  try {
    const dryRun = input.dryRun === true;
    const ids = parseUngroupIds(input);
    const selectedCanvas = fnResolveCanvasSelection({ rows: portal.dbService.canvas.listAll(), selector: input, command: 'canvas.ungroup', actionLabel: 'Ungroup' });
    const { handle, doc } = await fxLoadCanvasHandleDoc(portal, selectedCanvas);
    const matchedGroups = resolveGroupsByIds(doc, ids, selectedCanvas.id, input.canvasNameQuery ?? null);
    const removedGroupIds = fnSortIds(matchedGroups.map((group) => group.id));
    const removedGroupIdSet = new Set(removedGroupIds);
    const groupParentMap = new Map(removedGroupIds.map((groupId) => [groupId, resolveSurvivingParentGroupId(doc, removedGroupIdSet, groupId)]));
    const { releasedElementIds } = fnCollectDirectChildIds(doc, removedGroupIds);
    const now = Date.now();

    if (!dryRun) {
      handle.change((nextDoc) => {
        for (const removedGroupId of removedGroupIds) {
          const parentGroupId = groupParentMap.get(removedGroupId) ?? null;

          for (const element of Object.values(nextDoc.elements)) {
            if (element.parentGroupId !== removedGroupId) continue;
            element.parentGroupId = parentGroupId;
            element.updatedAt = now;
          }

          for (const group of Object.values(nextDoc.groups)) {
            if (group.id === removedGroupId) continue;
            if (group.parentGroupId !== removedGroupId) continue;
            if (groupParentMap.has(group.id)) continue;
            group.parentGroupId = parentGroupId;
          }

          delete nextDoc.groups[removedGroupId];
        }
      });
      await portal.automergeService.repo.flush([handle.documentId]);
    }

    return {
      ok: true,
      command: 'canvas.ungroup',
      dryRun,
      canvas: fnNormalizeCanvas(selectedCanvas),
      matchedCount: removedGroupIds.length,
      matchedIds: removedGroupIds,
      removedGroupCount: removedGroupIds.length,
      removedGroupIds,
      releasedChildCount: releasedElementIds.length,
      releasedChildIds: releasedElementIds,
    };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'ok' in error && 'code' in error) throw error;
    throw {
      ok: false,
      command: 'canvas.ungroup',
      code: 'CANVAS_UNGROUP_FAILED',
      message: error instanceof Error ? error.message : String(error),
      canvasId: input.canvasId,
      canvasNameQuery: input.canvasNameQuery ?? null,
    } satisfies TCanvasCmdErrorDetails;
  }
}
