import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { TCanvasDoc, TElement } from '@vibecanvas/service-automerge/types/canvas-doc';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import { fnNormalizeCanvas, fnResolveCanvasSelection, fnSortIds, type TCanvasSummary } from '../core/fn.canvas';
import { fnIsPlainObject } from '../core/fn.guard';
import { fxLoadCanvasHandleDoc } from '../core/fx.canvas';
import { fxBuildCanvasAddData, fxDefaultCanvasAddStyle } from './fn.canvas-add-contract';
import type { TCanvasCmdErrorDetails } from '../types';

export type TAddPrimitiveType = 'rect' | 'ellipse' | 'diamond' | 'text' | 'line' | 'arrow';

export type TCanvasAddElementInput = {
  id?: string;
  type: TAddPrimitiveType;
  x?: number;
  y?: number;
  rotation?: number;
  parentGroupId?: string | null;
  locked?: boolean;
  data?: Record<string, unknown>;
  style?: Record<string, unknown>;
};

export type TArgsCanvasAddInput = {
  canvasId?: string | null;
  canvasNameQuery?: string | null;
  dryRun?: boolean;
  elements?: TCanvasAddElementInput[];
};

export type TCanvasAddInput = TArgsCanvasAddInput;

export type TCanvasAddSuccess = {
  ok: true;
  command: 'canvas.add';
  dryRun: boolean;
  canvas: TCanvasSummary;
  addedCount: number;
  addedIds: string[];
  elements: Array<{ id: string; type: TAddPrimitiveType; parentGroupId: string | null; zIndex: string }>;
};

export type TPortalCanvasAdd = {
  dbService: IDbService;
  automergeService: IAutomergeService;
  crypto: typeof crypto;
};

export type TPortal = TPortalCanvasAdd;

const CANVAS_ADD_DRY_RUN_PLACEHOLDER_ID = 'PLACEHOLDER-NO';

function fnCreateOrderedZIndex(index: number): string {
  return `z${String(index).padStart(8, '0')}`;
}

function fnExtractZIndexNumber(zIndex: string): number {
  const match = /^z(\d+)$/.exec(zIndex);
  return match ? Number(match[1]) : -1;
}

function fnValidateInput(args: TArgsCanvasAddInput): TCanvasAddElementInput[] {
  const elements = args.elements ?? [];
  if (elements.length === 0) throw { ok: false, command: 'canvas.add', code: 'CANVAS_ADD_ELEMENT_REQUIRED', message: 'Add requires at least one element payload.', canvasId: args.canvasId ?? null, canvasNameQuery: args.canvasNameQuery ?? null } satisfies TCanvasCmdErrorDetails;
  return elements;
}

function fnValidateElementPayload(element: TCanvasAddElementInput, doc: TCanvasDoc, dryRun: boolean): void {
  if (typeof element.type !== 'string' || element.type.trim().length === 0) {
    throw { ok: false, command: 'canvas.add', code: 'CANVAS_ADD_TYPE_REQUIRED', message: 'Element payload must include a supported type.' } satisfies TCanvasCmdErrorDetails;
  }
  if (!['rect', 'ellipse', 'diamond', 'text', 'line', 'arrow'].includes(element.type)) {
    throw { ok: false, command: 'canvas.add', code: 'CANVAS_ADD_TYPE_INVALID', message: `Unsupported element type '${String(element.type)}'.` } satisfies TCanvasCmdErrorDetails;
  }
  if (element.data !== undefined && !fnIsPlainObject(element.data)) throw { ok: false, command: 'canvas.add', code: 'CANVAS_ADD_PAYLOAD_INVALID', message: 'Element data must be an object.' } satisfies TCanvasCmdErrorDetails;
  if (element.style !== undefined && !fnIsPlainObject(element.style)) throw { ok: false, command: 'canvas.add', code: 'CANVAS_ADD_PAYLOAD_INVALID', message: 'Element style must be an object.' } satisfies TCanvasCmdErrorDetails;
  if (element.parentGroupId !== undefined && element.parentGroupId !== null && !doc.groups[element.parentGroupId]) {
    throw { ok: false, command: 'canvas.add', code: 'CANVAS_ADD_PARENT_GROUP_NOT_FOUND', message: `Parent group '${element.parentGroupId}' was not found.` } satisfies TCanvasCmdErrorDetails;
  }
  if (!dryRun && element.id && (doc.elements[element.id] || doc.groups[element.id])) {
    throw { ok: false, command: 'canvas.add', code: 'CANVAS_ADD_ID_CONFLICT', message: `Element id '${element.id}' already exists.` } satisfies TCanvasCmdErrorDetails;
  }
}

function fnBuildElement(args: { input: TCanvasAddElementInput; zIndex: string; randomUUID: () => string }): TElement {
  const now = Date.now();
  const defaultStyleByType = args.input.type === 'text'
    ? { fontSize: '@text/s', textAlign: 'left' as const, verticalAlign: 'top' as const }
    : {};
  return {
    id: args.input.id ?? args.randomUUID(),
    x: args.input.x ?? 0,
    y: args.input.y ?? 0,
    rotation: args.input.rotation ?? 0,
    zIndex: args.zIndex,
    parentGroupId: args.input.parentGroupId ?? null,
    bindings: [],
    locked: args.input.locked ?? false,
    createdAt: now,
    updatedAt: now,
    data: fxBuildCanvasAddData(args.input.type, args.input.data ?? {}),
    style: { ...fxDefaultCanvasAddStyle(), ...defaultStyleByType, ...(args.input.style ?? {}) },
  };
}

export async function txExecuteCanvasAdd(portal: TPortalCanvasAdd, args: TArgsCanvasAddInput): Promise<TCanvasAddSuccess> {
  try {
    const requestedElements = fnValidateInput(args);
    const dryRun = args.dryRun === true;
    const selectedCanvas = fnResolveCanvasSelection({ rows: await portal.dbService.canvas.listAll(), selector: args, command: 'canvas.add', actionLabel: 'Add' });
    const { handle, doc } = await fxLoadCanvasHandleDoc(portal, selectedCanvas);

    for (const element of requestedElements) fnValidateElementPayload(element, doc, dryRun);

    const maxExistingIndex = Math.max(-1, ...Object.values(doc.elements).map((element) => fnExtractZIndexNumber(element.zIndex)), ...Object.values(doc.groups).map((group) => fnExtractZIndexNumber(group.zIndex)));
    const builtElements = requestedElements.map((element, index) => fnBuildElement({
      input: dryRun ? { ...element, id: CANVAS_ADD_DRY_RUN_PLACEHOLDER_ID } : element,
      zIndex: fnCreateOrderedZIndex(maxExistingIndex + index + 1),
      randomUUID: () => dryRun ? CANVAS_ADD_DRY_RUN_PLACEHOLDER_ID : portal.crypto.randomUUID(),
    }));

    if (!dryRun) {
      const builtIds = new Set<string>();
      for (const element of builtElements) {
        if (builtIds.has(element.id)) throw { ok: false, command: 'canvas.add', code: 'CANVAS_ADD_ID_CONFLICT', message: `Element id '${element.id}' already exists.` } satisfies TCanvasCmdErrorDetails;
        builtIds.add(element.id);
      }

      handle.change((nextDoc) => {
        for (const element of builtElements) nextDoc.elements[element.id] = structuredClone(element);
      });
    }

    return {
      ok: true,
      command: 'canvas.add',
      dryRun,
      canvas: fnNormalizeCanvas(selectedCanvas),
      addedCount: builtElements.length,
      addedIds: builtElements.map((element) => element.id),
      elements: builtElements.map((element) => ({ id: element.id, type: element.data.type as TAddPrimitiveType, parentGroupId: element.parentGroupId, zIndex: element.zIndex })),
    };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'ok' in error && 'code' in error) throw error;
    throw {
      ok: false,
      command: 'canvas.add',
      code: 'CANVAS_ADD_FAILED',
      message: error instanceof Error ? error.message : String(error),
      canvasId: args.canvasId,
      canvasNameQuery: args.canvasNameQuery ?? null,
    } satisfies TCanvasCmdErrorDetails;
  }
}
