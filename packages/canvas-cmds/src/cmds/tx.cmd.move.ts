import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { TCanvasDoc, TElement } from '@vibecanvas/service-automerge/types/canvas-doc';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import { fnNormalizeCanvas, fnResolveCanvasSelection, fnSortIds, type TCanvasSummary } from '../core/fn.canvas';
import { fxLoadCanvasHandleDoc } from '../core/fx.canvas';
import { fnCollectGroupCascade } from '../core/fn.group';
import type { TCanvasCmdErrorDetails } from '../types';

export type TMoveMode = 'relative' | 'absolute';

export type TCanvasMoveInput = {
  canvasId?: string | null;
  canvasNameQuery?: string | null;
  dryRun?: boolean;
  ids?: string[];
  mode?: TMoveMode;
  x?: number;
  y?: number;
};

export type TCanvasMoveSuccess = {
  ok: true;
  command: 'canvas.move';
  dryRun: boolean;
  mode: TMoveMode;
  input: { x: number; y: number };
  delta: { dx: number; dy: number };
  canvas: TCanvasSummary;
  matchedCount: number;
  matchedIds: string[];
  changedCount: number;
  changedIds: string[];
};

export type TPortal = {
  dbService: IDbService;
  automergeService: IAutomergeService;
};

type TMoveTarget =
  | { kind: 'element'; element: TElement }
  | { kind: 'group'; groupId: string };

type TSceneBounds = { x: number; y: number; w: number; h: number };

function createTargetFromId(doc: TCanvasDoc, id: string): TMoveTarget | null {
  if (doc.elements[id]) return { kind: 'element', element: doc.elements[id]! };
  if (doc.groups[id]) return { kind: 'group', groupId: id };
  return null;
}

function resolveTargetsByIds(doc: TCanvasDoc, ids: string[], canvasId: string, canvasNameQuery: string | null): TMoveTarget[] {
  const targets = ids.map((id) => createTargetFromId(doc, id));
  const missingIds = ids.filter((_, index) => targets[index] === null);
  if (missingIds.length === 0) return targets.filter((target): target is TMoveTarget => target !== null);
  throw {
    ok: false,
    command: 'canvas.move',
    code: 'CANVAS_MOVE_TARGET_NOT_FOUND',
    message: `Target ids were not found in canvas '${doc.name}': ${fnSortIds(missingIds).join(', ')}.`,
    canvasId,
    canvasNameQuery,
  } satisfies TCanvasCmdErrorDetails;
}

function collectChangedElementIds(doc: TCanvasDoc, targets: readonly TMoveTarget[]): string[] {
  const changedIds = new Set<string>();
  for (const target of targets) {
    if (target.kind === 'element') {
      changedIds.add(target.element.id);
      continue;
    }

    const cascade = fnCollectGroupCascade(doc, target.groupId);
    for (const elementId of cascade.elementIds) changedIds.add(elementId);
  }
  return fnSortIds([...changedIds]);
}

function createBounds(x: number, y: number, w: number, h: number): TSceneBounds {
  return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

function unionBounds(left: TSceneBounds | null, right: TSceneBounds | null): TSceneBounds | null {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  const minX = Math.min(left.x, right.x);
  const minY = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.w, right.x + right.w);
  const maxY = Math.max(left.y + left.h, right.y + right.h);
  return createBounds(minX, minY, maxX - minX, maxY - minY);
}

function getStrokeWidth(element: TElement): number {
  return element.style.strokeWidth ?? 1;
}

function getPolylinePadding(element: TElement): number {
  const strokeWidth = getStrokeWidth(element);
  if (element.data.type === 'arrow') return Math.max(strokeWidth * 4.5, 18, strokeWidth * 1.5, 8);
  return Math.max(strokeWidth * 1.5, 8);
}

function getPointBounds(element: TElement, points: Array<[number, number]>): TSceneBounds {
  if (points.length === 0) {
    const strokeWidth = getStrokeWidth(element);
    return createBounds(element.x - strokeWidth, element.y - strokeWidth, strokeWidth * 2, strokeWidth * 2);
  }
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const pad = getPolylinePadding(element);
  const minX = element.x + Math.min(...xs) - pad;
  const minY = element.y + Math.min(...ys) - pad;
  const maxX = element.x + Math.max(...xs) + pad;
  const maxY = element.y + Math.max(...ys) + pad;
  return createBounds(minX, minY, maxX - minX, maxY - minY);
}

function hasWidthHeight(data: TElement['data']): data is TElement['data'] & { w: number; h: number } {
  return 'w' in data && 'h' in data;
}

function getElementBounds(element: TElement): TSceneBounds {
  if (hasWidthHeight(element.data)) return createBounds(element.x, element.y, element.data.w, element.data.h);
  if (element.data.type === 'ellipse') return createBounds(element.x, element.y, element.data.rx * 2, element.data.ry * 2);
  if (element.data.type === 'line' || element.data.type === 'arrow' || element.data.type === 'pen') return getPointBounds(element, element.data.points);
  return createBounds(element.x, element.y, 0, 0);
}

function getGroupBounds(doc: TCanvasDoc, groupId: string): TSceneBounds | null {
  const cascade = fnCollectGroupCascade(doc, groupId);
  let bounds: TSceneBounds | null = null;
  for (const elementId of cascade.elementIds) {
    const element = doc.elements[elementId];
    if (!element) continue;
    bounds = unionBounds(bounds, getElementBounds(element));
  }
  return bounds;
}

function resolveAbsoluteDelta(doc: TCanvasDoc, target: TMoveTarget, x: number, y: number, canvasId: string, canvasNameQuery: string | null): { dx: number; dy: number } {
  if (target.kind === 'element') return { dx: x - target.element.x, dy: y - target.element.y };
  const bounds = getGroupBounds(doc, target.groupId);
  if (bounds) return { dx: x - bounds.x, dy: y - bounds.y };
  throw {
    ok: false,
    command: 'canvas.move',
    code: 'CANVAS_MOVE_TARGET_NOT_POSITIONABLE',
    message: `Group '${target.groupId}' cannot be moved absolutely because it has no descendant element bounds.`,
    canvasId,
    canvasNameQuery,
  } satisfies TCanvasCmdErrorDetails;
}

type TArgs = TCanvasMoveInput;

export async function txExecuteCanvasMove(portal: TPortal, args: TArgs): Promise<TCanvasMoveSuccess> {
  try {
    const dryRun = args.dryRun === true;
    const matchedIds = fnSortIds([...new Set((args.ids ?? []).map((id) => id.trim()).filter(Boolean))]);
    if (matchedIds.length === 0) throw { ok: false, command: 'canvas.move', code: 'CANVAS_MOVE_ID_REQUIRED', message: 'Move requires at least one id.', canvasId: args.canvasId ?? null, canvasNameQuery: args.canvasNameQuery ?? null } satisfies TCanvasCmdErrorDetails;
    const x = Number(args.x);
    const y = Number(args.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw { ok: false, command: 'canvas.move', code: 'CANVAS_MOVE_COORDINATE_INVALID', message: 'Move coordinates must be finite numbers.', canvasId: args.canvasId ?? null, canvasNameQuery: args.canvasNameQuery ?? null } satisfies TCanvasCmdErrorDetails;
    const mode = args.mode ?? 'relative';

    const selectedCanvas = fnResolveCanvasSelection({ rows: portal.dbService.canvas.listAll(), selector: args, command: 'canvas.move', actionLabel: 'Move' });
    const { handle, doc } = await fxLoadCanvasHandleDoc(portal, selectedCanvas);
    const matchedTargets = resolveTargetsByIds(doc, matchedIds, selectedCanvas.id, args.canvasNameQuery ?? null);

    if (mode === 'absolute' && matchedTargets.length !== 1) {
      throw {
        ok: false,
        command: 'canvas.move',
        code: 'CANVAS_MOVE_ABSOLUTE_REQUIRES_SINGLE_TARGET',
        message: 'Absolute move currently requires exactly one target id.',
        canvasId: selectedCanvas.id,
        canvasNameQuery: args.canvasNameQuery ?? null,
      } satisfies TCanvasCmdErrorDetails;
    }

    const delta = mode === 'relative'
      ? { dx: x, dy: y }
      : resolveAbsoluteDelta(doc, matchedTargets[0]!, x, y, selectedCanvas.id, args.canvasNameQuery ?? null);

    const changedIds = collectChangedElementIds(doc, matchedTargets);
    const now = Date.now();

    if (!dryRun) {
      handle.change((nextDoc) => {
        for (const changedId of changedIds) {
          const element = nextDoc.elements[changedId];
          if (!element) continue;
          element.x += delta.dx;
          element.y += delta.dy;
          element.updatedAt = now;
        }
      });
      await portal.automergeService.repo.flush([handle.documentId]);
    }

    return {
      ok: true,
      command: 'canvas.move',
      dryRun,
      mode,
      input: { x, y },
      delta,
      canvas: fnNormalizeCanvas(selectedCanvas),
      matchedCount: matchedIds.length,
      matchedIds,
      changedCount: changedIds.length,
      changedIds,
    };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'ok' in error && 'code' in error) throw error;
    throw {
      ok: false,
      command: 'canvas.move',
      code: 'CANVAS_MOVE_FAILED',
      message: error instanceof Error ? error.message : String(error),
      canvasId: args.canvasId,
      canvasNameQuery: args.canvasNameQuery ?? null,
    } satisfies TCanvasCmdErrorDetails;
  }
}
