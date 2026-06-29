/* eslint-disable functional-core/export-shape -- legacy CLI contract builder names predate the fn prefix policy */
import type { TCanvasSubcommandOptions } from '../../../parse-argv';
import type { TCanvasAddElementInput, TCanvasAddInput } from '@vibecanvas/canvas-cmds/cmds/tx.cmd.add';
import type { TCanvasMoveInput } from '@vibecanvas/canvas-cmds/cmds/tx.cmd.move';
import type { TCanvasGroupInput } from '@vibecanvas/canvas-cmds/cmds/tx.cmd.group';
import type { TCanvasUngroupInput } from '@vibecanvas/canvas-cmds/cmds/tx.cmd.ungroup';
import type { TCanvasReorderInput } from '@vibecanvas/canvas-cmds/cmds/tx.cmd.reorder';
import type { TCanvasPatchEnvelope, TCanvasPatchInput } from '@vibecanvas/canvas-cmds/cmds/tx.cmd.patch';
import type { TCanvasDeleteInput } from '@vibecanvas/canvas-cmds/cmds/tx.cmd.delete';
import type { TCanvasQueryInput, TSceneBounds, TSceneSelector, TSceneSelectorEnvelope, TSceneSelectorScalar } from '@vibecanvas/canvas-cmds/cmds/fx.cmd.query';

function parseScalarString(value: string): TSceneSelectorScalar {
  const trimmed = value.trim();
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseBounds(raw: string | undefined): TSceneBounds | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map((entry) => Number(entry.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return { x: parts[0]!, y: parts[1]!, w: parts[2]!, h: parts[3]! };
}

function parseStyleAssignments(values: string[] | undefined): Record<string, TSceneSelectorScalar> {
  if (!values || values.length === 0) return {};
  return Object.fromEntries(values.flatMap((raw) => {
    const separatorIndex = raw.indexOf('=');
    if (separatorIndex < 0) return [];
    const key = raw.slice(0, separatorIndex).trim();
    if (!key) return [];
    return [[key, parseScalarString(raw.slice(separatorIndex + 1))] as const];
  }));
}

function parseWhereSelector(where: string): TSceneSelector {
  const params = new URLSearchParams(where);
  return {
    ids: params.getAll('id').flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean),
    kinds: params.getAll('kind').flatMap((value) => value.split(',')).map((value) => value.trim()).filter((value): value is 'element' | 'group' => value === 'element' || value === 'group'),
    types: params.getAll('type').flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean),
    style: Object.fromEntries(Array.from(params.entries()).filter(([key]) => key.startsWith('style.')).map(([key, value]) => [key.slice('style.'.length), parseScalarString(value)])),
    group: params.get('group')?.trim() || null,
    subtree: params.get('subtree')?.trim() || null,
    bounds: parseBounds(params.get('bounds') ?? undefined) ?? null,
    boundsMode: params.get('bounds-mode') === 'contains' ? 'contains' : 'intersects',
  };
}

function parseQuerySelector(queryJson: string): TSceneSelector {
  const parsed = JSON.parse(queryJson) as Record<string, unknown>;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw {
      ok: false,
      command: 'canvas.query',
      code: 'CANVAS_QUERY_JSON_INVALID',
      message: '--query must be a JSON object with fields like { ids, kinds, types, style, group, subtree, bounds, boundsMode }.',
    };
  }

  const kinds = Array.isArray(parsed.kinds)
    ? parsed.kinds.map((value) => typeof value === 'string' ? value.trim() : '').filter((value): value is 'element' | 'group' => value === 'element' || value === 'group')
    : [];

  const styleRaw = parsed.style;
  if (styleRaw !== undefined && (Array.isArray(styleRaw) || (styleRaw !== null && typeof styleRaw !== 'object'))) {
    throw {
      ok: false,
      command: 'canvas.query',
      code: 'CANVAS_QUERY_JSON_INVALID',
      message: '--query style must be an object of scalar values.',
    };
  }

  const style = styleRaw && typeof styleRaw === 'object'
    ? Object.fromEntries(Object.entries(styleRaw).filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null))
    : {};

  const boundsRaw = parsed.bounds;
  if (boundsRaw !== undefined && (Array.isArray(boundsRaw) || (boundsRaw !== null && typeof boundsRaw !== 'object'))) {
    throw {
      ok: false,
      command: 'canvas.query',
      code: 'CANVAS_QUERY_JSON_INVALID',
      message: '--query bounds must be an object like { x, y, w, h }.',
    };
  }

  const boundsRecord = boundsRaw && typeof boundsRaw === 'object'
    ? boundsRaw as Record<string, unknown>
    : null;
  const bounds = boundsRecord
    && typeof boundsRecord.x === 'number'
    && typeof boundsRecord.y === 'number'
    && typeof boundsRecord.w === 'number'
    && typeof boundsRecord.h === 'number'
    ? { x: boundsRecord.x, y: boundsRecord.y, w: boundsRecord.w, h: boundsRecord.h }
    : boundsRecord === null
      ? null
      : (() => {
          throw {
            ok: false,
            command: 'canvas.query',
            code: 'CANVAS_QUERY_JSON_INVALID',
            message: '--query bounds must include numeric x, y, w, and h fields.',
          };
        })();

  return {
    ids: Array.isArray(parsed.ids) ? parsed.ids.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean) : [],
    kinds,
    types: Array.isArray(parsed.types) ? parsed.types.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean) : [],
    style,
    group: typeof parsed.group === 'string' && parsed.group.trim() ? parsed.group.trim() : null,
    subtree: typeof parsed.subtree === 'string' && parsed.subtree.trim() ? parsed.subtree.trim() : null,
    bounds,
    boundsMode: parsed.boundsMode === 'contains' ? 'contains' : 'intersects',
  };
}

function sortUnique(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

const QUERY_OUTPUT_MODES = new Set<TCanvasQueryInput['output']>(['summary', 'focused', 'full']);

export function buildCanvasQueryInput(options?: TCanvasSubcommandOptions): TCanvasQueryInput {
  const selectorModeCount = Number(Boolean(options?.where)) + Number(Boolean(options?.queryJson)) + Number(Boolean(
    (options?.ids?.length ?? 0) > 0
    || (options?.kinds?.length ?? 0) > 0
    || (options?.types?.length ?? 0) > 0
    || (options?.styles?.length ?? 0) > 0
    || options?.groupId
    || options?.subtree
    || options?.bounds
    || options?.boundsMode
  ));

  if (selectorModeCount > 1) {
    throw {
      ok: false,
      command: 'canvas.query',
      code: 'CANVAS_QUERY_SELECTOR_CONFLICT',
      message: 'Pass at most one selector input style: structured flags, --where, or --query.',
      canvasId: options?.canvasId ?? null,
      canvasNameQuery: options?.canvasNameQuery ?? null,
    };
  }

  const selector: TSceneSelectorEnvelope = {
    source: 'none',
    canvasId: options?.canvasId,
    canvasNameQuery: options?.canvasNameQuery,
    filters: {
      ids: [],
      kinds: [],
      types: [],
      style: {},
      group: null,
      subtree: null,
      bounds: null,
      boundsMode: 'intersects',
    },
  };

  if (options?.where) {
    selector.source = 'where';
    selector.filters = parseWhereSelector(options.where);
  } else if (options?.queryJson) {
    selector.source = 'query';
    selector.filters = parseQuerySelector(options.queryJson);
  } else {
    const style = parseStyleAssignments(options?.styles);
    const hasFlags = Boolean(
      (options?.ids?.length ?? 0) > 0
      || (options?.kinds?.length ?? 0) > 0
      || (options?.types?.length ?? 0) > 0
      || Object.keys(style).length > 0
      || options?.groupId
      || options?.subtree
      || options?.bounds
      || options?.boundsMode,
    );

    selector.source = hasFlags ? 'flags' : 'none';
    selector.filters = {
      ids: sortUnique(options?.ids),
      kinds: (options?.kinds?.filter((value): value is 'element' | 'group' => value === 'element' || value === 'group')) ?? [],
      types: options?.types ?? [],
      style,
      group: options?.groupId ?? null,
      subtree: options?.subtree ?? null,
      bounds: parseBounds(options?.bounds) ?? null,
      boundsMode: options?.boundsMode === 'contains' ? 'contains' : 'intersects',
    };
  }

  if (options?.output !== undefined && !QUERY_OUTPUT_MODES.has(options.output as TCanvasQueryInput['output'])) {
    throw {
      ok: false,
      command: 'canvas.query',
      code: 'CANVAS_QUERY_OUTPUT_INVALID',
      message: `Invalid --output mode '${options.output}'. Expected one of: summary, focused, full.`,
      canvasId: options?.canvasId ?? null,
      canvasNameQuery: options?.canvasNameQuery ?? null,
    };
  }

  return {
    selector,
    output: options?.output as TCanvasQueryInput['output'],
    omitData: options?.omitData,
    omitStyle: options?.omitStyle,
  };
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function buildCanvasAddInput(options: TCanvasSubcommandOptions | undefined, elements: TCanvasAddElementInput[]): TCanvasAddInput {
  return {
    canvasId: options?.canvasId,
    canvasNameQuery: options?.canvasNameQuery,
    dryRun: options?.dryRun,
    elements,
  };
}

export function buildCanvasMoveInput(options?: TCanvasSubcommandOptions): TCanvasMoveInput {
  return {
    canvasId: options?.canvasId,
    canvasNameQuery: options?.canvasNameQuery,
    dryRun: options?.dryRun,
    ids: sortUnique(options?.ids),
    mode: options?.absolute ? 'absolute' : options?.relative ? 'relative' : undefined,
    x: parseOptionalNumber(options?.x),
    y: parseOptionalNumber(options?.y),
  };
}

export function buildCanvasGroupInput(options?: TCanvasSubcommandOptions): TCanvasGroupInput {
  return {
    canvasId: options?.canvasId,
    canvasNameQuery: options?.canvasNameQuery,
    dryRun: options?.dryRun,
    ids: sortUnique(options?.ids),
  };
}

export function buildCanvasUngroupInput(options?: TCanvasSubcommandOptions): TCanvasUngroupInput {
  return {
    canvasId: options?.canvasId,
    canvasNameQuery: options?.canvasNameQuery,
    dryRun: options?.dryRun,
    ids: sortUnique(options?.ids),
  };
}

export function buildCanvasReorderInput(options?: TCanvasSubcommandOptions): TCanvasReorderInput {
  return {
    canvasId: options?.canvasId,
    canvasNameQuery: options?.canvasNameQuery,
    ids: sortUnique(options?.ids),
    action: options?.action as TCanvasReorderInput['action'],
  };
}

function parsePatchEnvelope(options?: TCanvasSubcommandOptions): TCanvasPatchEnvelope | undefined {
  if (options?.patch) return JSON.parse(options.patch) as TCanvasPatchEnvelope;
  return undefined;
}

export function buildCanvasPatchInput(options?: TCanvasSubcommandOptions, patch?: TCanvasPatchEnvelope): TCanvasPatchInput {
  return {
    canvasId: options?.canvasId,
    canvasNameQuery: options?.canvasNameQuery,
    dryRun: options?.dryRun,
    ids: sortUnique(options?.ids),
    patch: patch ?? parsePatchEnvelope(options),
  };
}

export function buildCanvasDeleteInput(options?: TCanvasSubcommandOptions): TCanvasDeleteInput {
  return {
    canvasId: options?.canvasId,
    canvasNameQuery: options?.canvasNameQuery,
    dryRun: options?.dryRun,
    ids: sortUnique(options?.ids),
  };
}
