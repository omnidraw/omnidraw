import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { TCanvasDoc, TElement, TElementType, TGroup } from '@vibecanvas/service-automerge/types/canvas-doc';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import { fnNormalizeCanvas, fnResolveCanvasSelection, fnSortIds, type TCanvasSummary } from '../core/fn.canvas';
import { fxLoadCanvasHandleDoc } from '../core/fx.canvas';
import type { TCanvasCmdErrorDetails } from '../types';

export type TSceneSelectorSource = 'none' | 'flags' | 'where' | 'query';
export type TSceneSelectorScalar = string | number | boolean | null;
export type TSceneStyleFilter = Record<string, TSceneSelectorScalar>;

export type TSceneBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TSceneSelector = {
  ids?: string[];
  kinds?: Array<'element' | 'group'>;
  types?: string[];
  style?: TSceneStyleFilter;
  group?: string | null;
  subtree?: string | null;
  bounds?: TSceneBounds | null;
  boundsMode?: 'intersects' | 'contains';
};

export type TSceneSelectorEnvelope = {
  source?: TSceneSelectorSource;
  canvasId?: string | null;
  canvasNameQuery?: string | null;
  filters?: TSceneSelector;
};

export type TSceneOutputMode = 'summary' | 'focused' | 'full';


export type TSceneMatchMetadata = {
  kind: 'element' | 'group';
  id: string;
  type: TElementType | null;
  parentGroupId: string | null;
  zIndex: string;
  locked: boolean;
  bounds: TSceneBounds | null;
};

export type TSceneTarget =
  | { kind: 'element'; element: TElement }
  | { kind: 'group'; group: TGroup };

export type TCanvasQuerySuccess = {
  ok: true;
  command: 'canvas.query';
  mode: TSceneOutputMode;
  selector: TSceneSelectorEnvelope;
  canvas: TCanvasSummary;
  count: number;
  matches: Array<{
    metadata: TSceneMatchMetadata;
    payload: Record<string, unknown>;
  }>;
};

export type TCanvasQueryInput = {
  selector?: TSceneSelectorEnvelope;
  output?: TSceneOutputMode;
  omitData?: boolean;
  omitStyle?: boolean;
};

export type TPortal = {
  dbService: IDbService;
  automergeService: IAutomergeService;
};

type TResolvedSceneSelector = {
  ids: string[];
  kinds: Array<'element' | 'group'>;
  types: string[];
  style: TSceneStyleFilter;
  group: string | null;
  subtree: string | null;
  bounds: TSceneBounds | null;
  boundsMode: 'intersects' | 'contains';
};

type TResolvedSceneSelectorEnvelope = {
  source: TSceneSelectorSource;
  canvasId: string | null;
  canvasNameQuery: string | null;
  filters: TResolvedSceneSelector;
};

function normalizeSceneSelector(input?: TSceneSelectorEnvelope): TResolvedSceneSelectorEnvelope {
  const filters = input?.filters;
  return {
    source: input?.source ?? 'query',
    canvasId: input?.canvasId ?? null,
    canvasNameQuery: input?.canvasNameQuery ?? null,
    filters: {
      ids: filters?.ids ?? [],
      kinds: filters?.kinds ?? [],
      types: filters?.types ?? [],
      style: filters?.style ?? {},
      group: filters?.group ?? null,
      subtree: filters?.subtree ?? null,
      bounds: filters?.bounds ?? null,
      boundsMode: filters?.boundsMode ?? 'intersects',
    },
  };
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
  if (hasWidthHeight(element.data)) {
    return createBounds(element.x, element.y, element.data.w, element.data.h);
  }

  if (element.data.type === 'ellipse') {
    return createBounds(element.x, element.y, element.data.rx * 2, element.data.ry * 2);
  }

  if (element.data.type === 'line' || element.data.type === 'arrow' || element.data.type === 'pen') {
    return getPointBounds(element, element.data.points);
  }

  return createBounds(element.x, element.y, 0, 0);
}

function getGroupBounds(doc: TCanvasDoc, groupId: string): TSceneBounds | null {
  const pending = [groupId];
  const visited = new Set<string>();
  let bounds: TSceneBounds | null = null;

  while (pending.length > 0) {
    const currentGroupId = pending.shift();
    if (!currentGroupId || visited.has(currentGroupId)) continue;
    visited.add(currentGroupId);

    for (const element of Object.values(doc.elements)) {
      if (element.parentGroupId !== currentGroupId) continue;
      bounds = unionBounds(bounds, getElementBounds(element));
    }

    for (const group of Object.values(doc.groups)) {
      if (group.parentGroupId !== currentGroupId) continue;
      pending.push(group.id);
    }
  }

  return bounds;
}

function getTargetBounds(doc: TCanvasDoc, target: TSceneTarget): TSceneBounds | null {
  return target.kind === 'element' ? getElementBounds(target.element) : getGroupBounds(doc, target.group.id);
}

function getGroupAncestry(doc: TCanvasDoc, groupId: string | null): string[] {
  if (!groupId) return [];
  const ancestry: string[] = [];
  const visited = new Set<string>();
  let currentGroupId: string | null = groupId;

  while (currentGroupId) {
    if (visited.has(currentGroupId)) break;
    visited.add(currentGroupId);
    ancestry.unshift(currentGroupId);
    currentGroupId = doc.groups[currentGroupId]?.parentGroupId ?? null;
  }

  return ancestry;
}

function isGroupInSubtree(doc: TCanvasDoc, candidateGroupId: string, rootGroupId: string): boolean {
  if (candidateGroupId === rootGroupId) return true;
  return getGroupAncestry(doc, candidateGroupId).includes(rootGroupId);
}

function sortSceneTargets(doc: TCanvasDoc, targets: readonly TSceneTarget[]): TSceneTarget[] {
  return [...targets].sort((left, right) => {
    const leftParentGroupId = left.kind === 'element' ? left.element.parentGroupId : left.group.parentGroupId;
    const rightParentGroupId = right.kind === 'element' ? right.element.parentGroupId : right.group.parentGroupId;
    const leftAncestry = getGroupAncestry(doc, leftParentGroupId);
    const rightAncestry = getGroupAncestry(doc, rightParentGroupId);
    if (leftAncestry.length !== rightAncestry.length) return leftAncestry.length - rightAncestry.length;

    const leftPath = `${leftAncestry.join('/')}|${leftParentGroupId ?? '~root'}`;
    const rightPath = `${rightAncestry.join('/')}|${rightParentGroupId ?? '~root'}`;
    if (leftPath !== rightPath) return leftPath.localeCompare(rightPath);

    const leftZIndex = left.kind === 'element' ? left.element.zIndex : left.group.zIndex;
    const rightZIndex = right.kind === 'element' ? right.element.zIndex : right.group.zIndex;
    if (leftZIndex !== rightZIndex) return leftZIndex.localeCompare(rightZIndex);

    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);

    const leftId = left.kind === 'element' ? left.element.id : left.group.id;
    const rightId = right.kind === 'element' ? right.element.id : right.group.id;
    return leftId.localeCompare(rightId);
  });
}

function createSceneTargets(doc: TCanvasDoc): TSceneTarget[] {
  return sortSceneTargets(doc, [
    ...Object.values(doc.groups).map((group) => ({ kind: 'group', group }) satisfies TSceneTarget),
    ...Object.values(doc.elements).map((element) => ({ kind: 'element', element }) satisfies TSceneTarget),
  ]);
}

function validateSelector(doc: TCanvasDoc, selector: TResolvedSceneSelectorEnvelope): void {
  if (selector.filters.group && !doc.groups[selector.filters.group]) {
    throw {
      ok: false,
      command: 'canvas.query',
      code: 'CANVAS_QUERY_GROUP_NOT_FOUND',
      message: `Group '${selector.filters.group}' was not found in canvas '${doc.name}'.`,
      canvasId: selector.canvasId,
      canvasNameQuery: selector.canvasNameQuery,
    } satisfies TCanvasCmdErrorDetails;
  }

  if (selector.filters.subtree && !doc.groups[selector.filters.subtree]) {
    throw {
      ok: false,
      command: 'canvas.query',
      code: 'CANVAS_QUERY_SUBTREE_NOT_FOUND',
      message: `Subtree root '${selector.filters.subtree}' was not found in canvas '${doc.name}'.`,
      canvasId: selector.canvasId,
      canvasNameQuery: selector.canvasNameQuery,
    } satisfies TCanvasCmdErrorDetails;
  }
}

function intersectsBounds(filter: TSceneBounds, candidate: TSceneBounds): boolean {
  return filter.x < candidate.x + candidate.w && filter.x + filter.w > candidate.x && filter.y < candidate.y + candidate.h && filter.y + filter.h > candidate.y;
}

function containsBounds(filter: TSceneBounds, candidate: TSceneBounds): boolean {
  return candidate.x >= filter.x && candidate.y >= filter.y && candidate.x + candidate.w <= filter.x + filter.w && candidate.y + candidate.h <= filter.y + filter.h;
}

function matchesStyleSelector(target: TSceneTarget, styleFilter: TSceneStyleFilter): boolean {
  const styleEntries = Object.entries(styleFilter);
  if (styleEntries.length === 0) return true;
  if (target.kind !== 'element') return false;
  return styleEntries.every(([key, value]) => target.element.style[key as keyof typeof target.element.style] === value);
}

function matchesSceneSelector(target: TSceneTarget, doc: TCanvasDoc, selector: TResolvedSceneSelector): boolean {
  const id = target.kind === 'element' ? target.element.id : target.group.id;
  const kind = target.kind;
  const type = target.kind === 'element' ? target.element.data.type : null;
  const parentGroupId = target.kind === 'element' ? target.element.parentGroupId : target.group.parentGroupId;
  const bounds = getTargetBounds(doc, target);

  if (selector.ids.length > 0 && !selector.ids.includes(id)) return false;
  if (selector.kinds.length > 0 && !selector.kinds.includes(kind)) return false;
  if (selector.types.length > 0 && (type === null || !selector.types.includes(type))) return false;
  if (!matchesStyleSelector(target, selector.style)) return false;
  if (selector.group !== null && parentGroupId !== selector.group) return false;

  if (selector.subtree !== null) {
    if (target.kind === 'group') {
      if (!isGroupInSubtree(doc, target.group.id, selector.subtree)) return false;
    } else if (!parentGroupId || !isGroupInSubtree(doc, parentGroupId, selector.subtree)) {
      return false;
    }
  }

  if (selector.bounds !== null) {
    if (!bounds) return false;
    if (selector.boundsMode === 'intersects' && !intersectsBounds(selector.bounds, bounds)) return false;
    if (selector.boundsMode === 'contains' && !containsBounds(selector.bounds, bounds)) return false;
  }

  return true;
}

function buildGroupRelations(doc: TCanvasDoc, groupId: string): {
  directChildElementIds: string[];
  directChildGroupIds: string[];
  descendantElementCount: number;
  descendantGroupCount: number;
} {
  const directChildElementIds = fnSortIds(Object.values(doc.elements).filter((element) => element.parentGroupId === groupId).map((element) => element.id));
  const directChildGroupIds = fnSortIds(Object.values(doc.groups).filter((group) => group.parentGroupId === groupId).map((group) => group.id));
  const pending = [...directChildGroupIds];
  const visited = new Set<string>();
  let descendantElementCount = directChildElementIds.length;
  let descendantGroupCount = directChildGroupIds.length;

  while (pending.length > 0) {
    const currentGroupId = pending.shift();
    if (!currentGroupId || visited.has(currentGroupId)) continue;
    visited.add(currentGroupId);
    descendantElementCount += Object.values(doc.elements).filter((element) => element.parentGroupId === currentGroupId).length;
    for (const nestedGroupId of Object.values(doc.groups).filter((group) => group.parentGroupId === currentGroupId).map((group) => group.id)) {
      if (visited.has(nestedGroupId)) continue;
      descendantGroupCount += 1;
      pending.push(nestedGroupId);
    }
  }

  return {
    directChildElementIds,
    directChildGroupIds,
    descendantElementCount,
    descendantGroupCount,
  };
}

function buildElementPayload(element: TElement, mode: TSceneOutputMode): Record<string, unknown> {
  const summary = {
    kind: 'element',
    id: element.id,
    type: element.data.type,
    parentGroupId: element.parentGroupId,
    zIndex: element.zIndex,
    locked: element.locked,
    position: { x: element.x, y: element.y },
    createdAt: element.createdAt,
    updatedAt: element.updatedAt,
  };

  if (mode === 'summary') return summary;
  if (mode === 'focused') return { ...summary, bindingCount: element.bindings.length, data: structuredClone(element.data), style: structuredClone(element.style) };
  return { kind: 'element', id: element.id, record: structuredClone(element) };
}

function buildGroupPayload(group: TGroup, doc: TCanvasDoc, mode: TSceneOutputMode): Record<string, unknown> {
  const relations = buildGroupRelations(doc, group.id);
  const summary = {
    kind: 'group',
    id: group.id,
    parentGroupId: group.parentGroupId,
    zIndex: group.zIndex,
    locked: group.locked,
    createdAt: group.createdAt,
    directChildElementIds: relations.directChildElementIds,
    directChildGroupIds: relations.directChildGroupIds,
    directChildElementCount: relations.directChildElementIds.length,
    directChildGroupCount: relations.directChildGroupIds.length,
  };

  if (mode === 'summary') return summary;
  if (mode === 'focused') return { ...summary, ...relations };
  return { kind: 'group', id: group.id, record: structuredClone(group), ...relations };
}

function buildTargetPayload(target: TSceneTarget, doc: TCanvasDoc, mode: TSceneOutputMode): Record<string, unknown> {
  return target.kind === 'element' ? buildElementPayload(target.element, mode) : buildGroupPayload(target.group, doc, mode);
}

function buildMatchMetadata(target: TSceneTarget, doc: TCanvasDoc): TSceneMatchMetadata {
  if (target.kind === 'element') {
    return {
      kind: 'element',
      id: target.element.id,
      type: target.element.data.type,
      parentGroupId: target.element.parentGroupId,
      zIndex: target.element.zIndex,
      locked: target.element.locked,
      bounds: getElementBounds(target.element),
    };
  }

  return {
    kind: 'group',
    id: target.group.id,
    type: null,
    parentGroupId: target.group.parentGroupId,
    zIndex: target.group.zIndex,
    locked: target.group.locked,
    bounds: getGroupBounds(doc, target.group.id),
  };
}

function buildQueryPayload(target: TSceneTarget, doc: TCanvasDoc, mode: TSceneOutputMode, options: { omitData: boolean; omitStyle: boolean }): Record<string, unknown> {
  const payload = buildTargetPayload(target, doc, mode);
  if (target.kind === 'element') {
    return {
      ...payload,
      ...(options.omitData ? {} : { data: structuredClone(target.element.data) }),
      ...(options.omitStyle ? {} : { style: structuredClone(target.element.style) }),
    };
  }

  return {
    ...payload,
    ...(options.omitData ? {} : { data: null }),
    ...(options.omitStyle ? {} : { style: null }),
  };
}

const OUTPUT_MODES = new Set<TSceneOutputMode>(['summary', 'focused', 'full']);

type TArgs = TCanvasQueryInput;

export async function fxExecuteCanvasQuery(portal: TPortal, args: TArgs): Promise<TCanvasQuerySuccess> {
  const selector = normalizeSceneSelector(args.selector);

  try {
    const mode = args.output ?? 'summary';
    if (!OUTPUT_MODES.has(mode)) {
      throw {
        ok: false,
        command: 'canvas.query',
        code: 'CANVAS_QUERY_OUTPUT_INVALID',
        message: `Invalid output mode '${String(mode)}'. Expected one of: summary, focused, full.`,
        canvasId: selector.canvasId,
        canvasNameQuery: selector.canvasNameQuery,
      } satisfies TCanvasCmdErrorDetails;
    }
    const omitData = Boolean(args.omitData);
    const omitStyle = Boolean(args.omitStyle);
    const canvasRows = portal.dbService.canvas.listAll();
    const selectedCanvas = fnResolveCanvasSelection({ rows: canvasRows, selector, command: 'canvas.query', actionLabel: 'Query' });
    const { doc: canvasDoc } = await fxLoadCanvasHandleDoc(portal, selectedCanvas);
    validateSelector(canvasDoc, selector);

    const targets = createSceneTargets(canvasDoc);
    const matches: TCanvasQuerySuccess['matches'] = [];

    for (const target of targets) {
      if (!matchesSceneSelector(target, canvasDoc, selector.filters)) continue;

      matches.push({
        metadata: buildMatchMetadata(target, canvasDoc),
        payload: buildQueryPayload(target, canvasDoc, mode, {
          omitData,
          omitStyle,
        }),
      });
    }

    const response: TCanvasQuerySuccess = {
      ok: true,
      command: 'canvas.query',
      mode,
      selector: selector satisfies TSceneSelectorEnvelope,
      canvas: fnNormalizeCanvas(selectedCanvas),
      count: matches.length,
      matches,
    };

    return response;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'ok' in error && 'code' in error) {
      throw error;
    }

    const errorDetails: TCanvasCmdErrorDetails = {
      ok: false,
      command: 'canvas.query',
      code: 'CANVAS_QUERY_FAILED',
      message: error instanceof Error ? error.message : String(error),
      canvasId: selector.canvasId,
      canvasNameQuery: selector.canvasNameQuery,
    };
    throw errorDetails;
  }
}
