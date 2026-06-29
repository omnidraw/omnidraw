/* eslint-disable functional-core/fx-tx-params -- legacy command executor takes command input directly as its second parameter */
import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { TCanvasDoc, TElement, TGroup } from '@vibecanvas/service-automerge/types/canvas-doc';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import { fnNormalizeCanvas, fnResolveCanvasSelection, fnSortIds, type TCanvasSummary } from '../core/fn.canvas';
import { fxLoadCanvasHandleDoc } from '../core/fx.canvas';
import type { TCanvasCmdErrorDetails } from '../types';

const REORDER_ACTIONS = ['front', 'back', 'forward', 'backward'] as const;
export type TReorderAction = (typeof REORDER_ACTIONS)[number];

type TReorderTarget = { kind: 'element'; element: TElement } | { kind: 'group'; group: TGroup };
export type TOrderEntry = { id: string; zIndex: string; kind: 'element' | 'group' };

export type TCanvasReorderInput = {
  canvasId?: string | null;
  canvasNameQuery?: string | null;
  ids?: string[];
  action?: TReorderAction;
};

export type TCanvasReorderSuccess = {
  ok: true;
  command: 'canvas.reorder';
  action: TReorderAction;
  canvas: TCanvasSummary;
  matchedCount: number;
  matchedIds: string[];
  parentGroupId: string | null;
  beforeOrder: TOrderEntry[];
  afterOrder: TOrderEntry[];
  changedIds: string[];
};

export type TPortal = {
  dbService: IDbService;
  automergeService: IAutomergeService;
};

function fnCreateOrderedZIndex(index: number): string {
  return `z${String(index).padStart(8, '0')}`;
}

function fnParseReorderIds(input: TCanvasReorderInput): string[] {
  const ids = fnSortIds([...new Set((input.ids ?? []).map((id) => id.trim()).filter(Boolean))]);
  if (ids.length > 0) return ids;
  throw { ok: false, command: 'canvas.reorder', code: 'CANVAS_REORDER_ID_REQUIRED', message: 'Reorder requires at least one id.', canvasId: input.canvasId ?? null, canvasNameQuery: input.canvasNameQuery ?? null } satisfies TCanvasCmdErrorDetails;
}

function fnParseReorderAction(input: TCanvasReorderInput): TReorderAction {
  const action = input.action ?? 'front';
  if (REORDER_ACTIONS.includes(action)) return action;
  throw { ok: false, command: 'canvas.reorder', code: 'CANVAS_REORDER_ACTION_INVALID', message: `Invalid action '${String(input.action)}'.`, canvasId: input.canvasId, canvasNameQuery: input.canvasNameQuery ?? null } satisfies TCanvasCmdErrorDetails;
}

function fnResolveTargetsByIds(doc: TCanvasDoc, ids: string[], canvasId: string, canvasNameQuery: string | null): TReorderTarget[] {
  const targets = ids.map((id) => doc.groups[id] ? { kind: 'group', group: doc.groups[id]! } as TReorderTarget : doc.elements[id] ? { kind: 'element', element: doc.elements[id]! } as TReorderTarget : null);
  const missingIds = ids.filter((_, index) => targets[index] === null);
  if (missingIds.length === 0) return targets.filter((target): target is TReorderTarget => target !== null);
  throw { ok: false, command: 'canvas.reorder', code: 'CANVAS_REORDER_TARGET_NOT_FOUND', message: `Target ids were not found in canvas '${doc.name}': ${fnSortIds(missingIds).join(', ')}.`, canvasId, canvasNameQuery } satisfies TCanvasCmdErrorDetails;
}

function fnGetParentGroupId(target: TReorderTarget): string | null {
  return target.kind === 'element' ? target.element.parentGroupId ?? null : target.group.parentGroupId ?? null;
}

function fnEnsureSameParentGroupId(targets: readonly TReorderTarget[], canvasId: string, canvasNameQuery: string | null): string | null {
  const parentGroupIds = [...new Set(targets.map((target) => fnGetParentGroupId(target)))];
  if (parentGroupIds.length === 1) return parentGroupIds[0] ?? null;
  throw { ok: false, command: 'canvas.reorder', code: 'CANVAS_REORDER_PARENT_MISMATCH', message: 'All reordered ids must share the same direct parentGroupId.', canvasId, canvasNameQuery } satisfies TCanvasCmdErrorDetails;
}

function fnGetSiblingOrder(doc: TCanvasDoc, parentGroupId: string | null): TOrderEntry[] {
  return [
    ...Object.values(doc.groups).filter((group) => (group.parentGroupId ?? null) === parentGroupId).map((group) => ({ id: group.id, zIndex: group.zIndex, kind: 'group' as const })),
    ...Object.values(doc.elements).filter((element) => (element.parentGroupId ?? null) === parentGroupId).map((element) => ({ id: element.id, zIndex: element.zIndex, kind: 'element' as const })),
  ].sort((left, right) => {
    const zCompare = left.zIndex.localeCompare(right.zIndex);
    if (zCompare !== 0) return zCompare;
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    return left.id.localeCompare(right.id);
  });
}

function fnApplyReorderAction(order: readonly TOrderEntry[], selectedIds: readonly string[], action: TReorderAction): TOrderEntry[] {
  const selected = new Set(selectedIds);
  const units = order.map((entry) => ({ entries: [entry], selected: selected.has(entry.id) }));

  if (action === 'front') return [...units.filter((unit) => !unit.selected), ...units.filter((unit) => unit.selected)].flatMap((unit) => unit.entries);
  if (action === 'back') return [...units.filter((unit) => unit.selected), ...units.filter((unit) => !unit.selected)].flatMap((unit) => unit.entries);

  const next = [...units];
  if (action === 'forward') {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (next[index].selected && !next[index + 1].selected) [next[index], next[index + 1]] = [next[index + 1], next[index]];
    }
    return next.flatMap((unit) => unit.entries);
  }

  for (let index = 1; index < next.length; index += 1) {
    if (next[index].selected && !next[index - 1].selected) [next[index], next[index - 1]] = [next[index - 1], next[index]];
  }
  return next.flatMap((unit) => unit.entries);
}

export async function txExecuteCanvasReorder(portal: TPortal, input: TCanvasReorderInput): Promise<TCanvasReorderSuccess> {
  try {
    const matchedIds = fnParseReorderIds(input);
    const action = fnParseReorderAction(input);
    const selectedCanvas = fnResolveCanvasSelection({ rows: portal.dbService.canvas.listAll(), selector: input, command: 'canvas.reorder', actionLabel: 'Reorder' });
    const { handle, doc } = await fxLoadCanvasHandleDoc(portal, selectedCanvas);
    const matchedTargets = fnResolveTargetsByIds(doc, matchedIds, selectedCanvas.id, input.canvasNameQuery ?? null);
    const parentGroupId = fnEnsureSameParentGroupId(matchedTargets, selectedCanvas.id, input.canvasNameQuery ?? null);
    const beforeOrder = fnGetSiblingOrder(doc, parentGroupId);
    const afterOrderUnindexed = fnApplyReorderAction(beforeOrder, matchedIds, action);

    if (beforeOrder.map((entry) => entry.id).join('|') === afterOrderUnindexed.map((entry) => entry.id).join('|')) {
      throw { ok: false, command: 'canvas.reorder', code: 'CANVAS_REORDER_NO_OP', message: 'Reorder would not change sibling order for the requested action.', canvasId: selectedCanvas.id, canvasNameQuery: input.canvasNameQuery ?? null } satisfies TCanvasCmdErrorDetails;
    }

    const afterOrder = afterOrderUnindexed.map((entry, index) => ({ ...entry, zIndex: fnCreateOrderedZIndex(index) }));
    const changedIds = fnSortIds(afterOrder.filter((entry, index) => beforeOrder[index]?.id !== entry.id || beforeOrder[index]?.zIndex !== entry.zIndex).map((entry) => entry.id));

    handle.change((nextDoc) => {
      for (const entry of afterOrder) {
        if (entry.kind === 'group') {
          const group = nextDoc.groups[entry.id];
          if (group) group.zIndex = entry.zIndex;
          continue;
        }
        const element = nextDoc.elements[entry.id];
        if (element) element.zIndex = entry.zIndex;
      }
    });
    await portal.automergeService.repo.flush([handle.documentId]);

    return {
      ok: true,
      command: 'canvas.reorder',
      action,
      canvas: fnNormalizeCanvas(selectedCanvas),
      matchedCount: matchedIds.length,
      matchedIds,
      parentGroupId,
      beforeOrder,
      afterOrder,
      changedIds,
    };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'ok' in error && 'code' in error) throw error;
    throw {
      ok: false,
      command: 'canvas.reorder',
      code: 'CANVAS_REORDER_FAILED',
      message: error instanceof Error ? error.message : String(error),
      canvasId: input.canvasId,
      canvasNameQuery: input.canvasNameQuery ?? null,
    } satisfies TCanvasCmdErrorDetails;
  }
}
