/* eslint-disable functional-core/fx-tx-params, functional-core/no-runtime-globals -- legacy command executor takes input directly and still creates ids through crypto */
import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { TCanvasDoc, TElement, TGroup } from '@vibecanvas/service-automerge/types/canvas-doc';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import { fnNormalizeCanvas, fnResolveCanvasSelection, fnSortIds, type TCanvasSummary } from '../core/fn.canvas';
import { fxLoadCanvasHandleDoc } from '../core/fx.canvas';
import type { TCanvasCmdErrorDetails } from '../types';

export type TCanvasGroupInput = {
  canvasId?: string | null;
  canvasNameQuery?: string | null;
  dryRun?: boolean;
  ids?: string[];
};

export type TCanvasGroupSuccess = {
  ok: true;
  command: 'canvas.group';
  dryRun: boolean;
  canvas: TCanvasSummary;
  matchedCount: number;
  matchedIds: string[];
  group: {
    id: string;
    parentGroupId: string | null;
    childIds: string[];
  };
};

export type TPortal = {
  dbService: IDbService;
  automergeService: IAutomergeService;
};

const CANVAS_GROUP_DRY_RUN_PLACEHOLDER_ID = 'PLACEHOLDER-NO';

function parseGroupIds(input: TCanvasGroupInput): string[] {
  const ids = fnSortIds([...new Set((input.ids ?? []).map((value) => value.trim()).filter(Boolean))]);
  if (ids.length >= 2) return ids;
  throw {
    ok: false,
    command: 'canvas.group',
    code: 'CANVAS_GROUP_ID_REQUIRED',
    message: 'Group requires at least two ids.',
    canvasId: input.canvasId,
    canvasNameQuery: input.canvasNameQuery ?? null,
  } satisfies TCanvasCmdErrorDetails;
}

function resolveElementsByIds(doc: TCanvasDoc, ids: string[], canvasId: string, canvasNameQuery: string | null): TElement[] {
  const missingIds = ids.filter((id) => !doc.elements[id] && !doc.groups[id]);
  if (missingIds.length > 0) {
    throw {
      ok: false,
      command: 'canvas.group',
      code: 'CANVAS_GROUP_TARGET_NOT_FOUND',
      message: `Target ids were not found in canvas '${doc.name}': ${fnSortIds(missingIds).join(', ')}.`,
      canvasId,
      canvasNameQuery,
    } satisfies TCanvasCmdErrorDetails;
  }

  const groupIds = ids.filter((id) => Boolean(doc.groups[id]));
  if (groupIds.length > 0) {
    throw {
      ok: false,
      command: 'canvas.group',
      code: 'CANVAS_GROUP_TARGET_KIND_INVALID',
      message: `Grouping currently supports element ids only. Received group ids: ${fnSortIds(groupIds).join(', ')}.`,
      canvasId,
      canvasNameQuery,
    } satisfies TCanvasCmdErrorDetails;
  }

  return ids.map((id) => doc.elements[id]!).filter(Boolean);
}

function ensureSameParentGroupId(elements: readonly TElement[], canvasId: string, canvasNameQuery: string | null): string | null {
  const parentGroupIds = [...new Set(elements.map((element) => element.parentGroupId ?? null))];
  if (parentGroupIds.length === 1) return parentGroupIds[0] ?? null;
  throw {
    ok: false,
    command: 'canvas.group',
    code: 'CANVAS_GROUP_PARENT_MISMATCH',
    message: 'All grouped ids must share the same direct parentGroupId.',
    canvasId,
    canvasNameQuery,
  } satisfies TCanvasCmdErrorDetails;
}

export async function txExecuteCanvasGroup(portal: TPortal, input: TCanvasGroupInput): Promise<TCanvasGroupSuccess> {
  try {
    const dryRun = input.dryRun === true;
    const ids = parseGroupIds(input);
    const selectedCanvas = fnResolveCanvasSelection({ rows: portal.dbService.canvas.listAll(), selector: input, command: 'canvas.group', actionLabel: 'Group' });
    const { handle, doc } = await fxLoadCanvasHandleDoc(portal, selectedCanvas);
    const matchedElements = resolveElementsByIds(doc, ids, selectedCanvas.id, input.canvasNameQuery ?? null);
    const parentGroupId = ensureSameParentGroupId(matchedElements, selectedCanvas.id, input.canvasNameQuery ?? null);
    const groupId = dryRun ? CANVAS_GROUP_DRY_RUN_PLACEHOLDER_ID : crypto.randomUUID();
    const childIds = fnSortIds(matchedElements.map((element) => element.id));
    const maxCreatedAt = matchedElements.reduce((max, element) => Math.max(max, element.createdAt ?? 0, element.updatedAt ?? 0), 0);
    const createdAt = Math.max(Date.now(), maxCreatedAt + 1);
    const zIndex = matchedElements.map((element) => element.zIndex).sort((left, right) => left.localeCompare(right))[0] ?? 'a0';
    const newGroup: TGroup = { id: groupId, parentGroupId, zIndex, locked: false, createdAt };
    const now = Date.now();

    if (!dryRun) {
      handle.change((nextDoc) => {
        nextDoc.groups[groupId] = structuredClone(newGroup);
        for (const childId of childIds) {
          const element = nextDoc.elements[childId];
          if (!element) continue;
          element.parentGroupId = groupId;
          element.updatedAt = now;
        }
      });
      await portal.automergeService.repo.flush([handle.documentId]);
    }

    return {
      ok: true,
      command: 'canvas.group',
      dryRun,
      canvas: fnNormalizeCanvas(selectedCanvas),
      matchedCount: childIds.length,
      matchedIds: childIds,
      group: {
        id: groupId,
        parentGroupId,
        childIds,
      },
    };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'ok' in error && 'code' in error) throw error;
    throw {
      ok: false,
      command: 'canvas.group',
      code: 'CANVAS_GROUP_FAILED',
      message: error instanceof Error ? error.message : String(error),
      canvasId: input.canvasId,
      canvasNameQuery: input.canvasNameQuery ?? null,
    } satisfies TCanvasCmdErrorDetails;
  }
}
