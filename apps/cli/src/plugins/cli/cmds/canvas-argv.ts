import { parseArgs } from 'node:util';
import type {
  TCanvasItemPatch,
  TCanvasItemQueryCursor,
  TCanvasItemQueryFilter,
} from '@omnidraw/canvas-contract';
import { fnCanvasCliError } from './fn.canvas-subcommand-inputs';
import type {
  TCanvasNode,
  TCanvasSelector,
  TCanvasCliSubcommand,
  TParsedCanvasCommand,
} from './interface';

type TOptionDefinition = Readonly<{
  type: 'boolean' | 'string';
  short?: string;
  multiple?: boolean;
}>;

type TOptionValues = Readonly<Record<string, boolean | string | string[] | undefined>>;

const COMMON_OPTIONS = Object.freeze({
  help: { type: 'boolean', short: 'h' },
  json: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  port: { type: 'string' },
  'data-dir': { type: 'string' },
} satisfies Readonly<Record<string, TOptionDefinition>>);

const SELECTOR_OPTIONS = Object.freeze({
  canvas: { type: 'string' },
  'canvas-name': { type: 'string' },
} satisfies Readonly<Record<string, TOptionDefinition>>);

function parseOptions(
  command: string,
  args: readonly string[],
  options: Readonly<Record<string, TOptionDefinition>>,
): TOptionValues {
  try {
    return parseArgs({
      args: [...args],
      allowPositionals: false,
      strict: true,
      options: {
        ...COMMON_OPTIONS,
        ...options,
      },
    }).values as TOptionValues;
  } catch (error) {
    throw fnCanvasCliError(
      command,
      'CANVAS_ARGUMENT_INVALID',
      error instanceof Error ? error.message : String(error),
      `Run 'omnidraw ${command.replace('.', ' ')} --help' for accepted options.`,
    );
  }
}

function stringValue(
  command: string,
  values: TOptionValues,
  key: string,
): string | undefined {
  const value = values[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw fnCanvasCliError(
      command,
      'CANVAS_ARGUMENT_VALUE_REQUIRED',
      `--${key} requires a non-empty value.`,
    );
  }
  return value.trim();
}

function repeatedStringValues(values: TOptionValues, key: string): readonly string[] {
  const value = values[key];
  return Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
}

function stringValues(values: TOptionValues, key: string): readonly string[] {
  return repeatedStringValues(values, key)
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function requiredIds(
  command: string,
  values: TOptionValues,
  minimum = 1,
): readonly string[] {
  const ids = [...new Set(stringValues(values, 'id'))];
  if (ids.length < minimum) {
    throw fnCanvasCliError(
      command,
      minimum === 1 ? 'CANVAS_ITEM_ID_REQUIRED' : 'CANVAS_GROUP_TARGETS_REQUIRED',
      minimum === 1
        ? 'Pass at least one non-empty --id.'
        : `Pass at least ${minimum} distinct --id targets.`,
    );
  }
  return ids;
}

function selector(command: string, values: TOptionValues): TCanvasSelector {
  const canvasId = stringValue(command, values, 'canvas');
  const canvasNameQuery = stringValue(command, values, 'canvas-name');
  if (Boolean(canvasId) === Boolean(canvasNameQuery)) {
    throw fnCanvasCliError(
      command,
      'CANVAS_SELECTOR_REQUIRED',
      'Choose exactly one canvas selector: --canvas <id> or --canvas-name <query>.',
    );
  }
  return {
    ...(canvasId === undefined ? {} : { canvasId }),
    ...(canvasNameQuery === undefined ? {} : { canvasNameQuery }),
  };
}

function dryRun(values: TOptionValues): boolean {
  return values['dry-run'] === true;
}

function parseJson(command: string, flag: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw fnCanvasCliError(
      command,
      'CANVAS_JSON_INVALID',
      `--${flag} must be valid JSON.`,
    );
  }
}

function nodes(command: string, values: TOptionValues): readonly TCanvasNode[] {
  const raw = repeatedStringValues(values, 'item');
  if (raw.length === 0) {
    throw fnCanvasCliError(
      command,
      'CANVAS_ITEM_REQUIRED',
      'Pass at least one full Cangine node with --item <json>.',
    );
  }
  return raw.flatMap((entry) => {
    const parsed = parseJson(command, 'item', entry);
    const valuesToCheck = Array.isArray(parsed) ? parsed : [parsed];
    for (const value of valuesToCheck) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw fnCanvasCliError(
          command,
          'CANVAS_ITEM_INVALID',
          '--item must be a Cangine node object or an array of node objects.',
        );
      }
    }
    return valuesToCheck as TCanvasNode[];
  });
}

function patches(command: string, values: TOptionValues): readonly TCanvasItemPatch[] {
  const raw = stringValue(command, values, 'patch');
  if (raw === undefined) {
    throw fnCanvasCliError(
      command,
      'CANVAS_PATCH_REQUIRED',
      'Pass --patch with one JSON-path patch or an array of patches.',
    );
  }
  const parsed = parseJson(command, 'patch', raw);
  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  for (const candidate of candidates) {
    if (
      candidate === null
      || typeof candidate !== 'object'
      || Array.isArray(candidate)
    ) {
      throw fnCanvasCliError(
        command,
        'CANVAS_PATCH_INVALID',
        'Each patch must be an object with type and path fields.',
      );
    }
    const record = candidate as Readonly<Record<string, unknown>>;
    if (
      (record.type !== 'set' && record.type !== 'remove')
      || !Array.isArray(record.path)
      || record.path.length === 0
      || record.path.some((part) => (
        typeof part !== 'string'
        && !(typeof part === 'number' && Number.isSafeInteger(part) && part >= 0)
      ))
      || (record.type === 'set' && !Object.hasOwn(record, 'value'))
    ) {
      throw fnCanvasCliError(
        command,
        'CANVAS_PATCH_INVALID',
        'Patches use {"type":"set","path":[...],"value":...} or {"type":"remove","path":[...]}.',
      );
    }
  }
  return candidates as TCanvasItemPatch[];
}

function finiteNumber(
  command: string,
  values: TOptionValues,
  key: string,
): number | undefined {
  const raw = stringValue(command, values, key);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw fnCanvasCliError(
      command,
      'CANVAS_NUMBER_INVALID',
      `--${key} must be a finite number.`,
    );
  }
  return value;
}

function positiveInteger(
  command: string,
  values: TOptionValues,
  key: string,
): number | undefined {
  const raw = stringValue(command, values, key);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw fnCanvasCliError(
      command,
      'CANVAS_INTEGER_INVALID',
      `--${key} must be a positive integer.`,
    );
  }
  return value;
}

function queryCursor(
  command: string,
  values: TOptionValues,
): TCanvasItemQueryCursor | undefined {
  const raw = stringValue(command, values, 'cursor');
  if (raw === undefined) return undefined;
  const parsed = parseJson(command, 'cursor', raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw fnCanvasCliError(
      command,
      'CANVAS_CURSOR_INVALID',
      '--cursor must be a canvas query cursor object.',
    );
  }
  const record = parsed as Readonly<Record<string, unknown>>;
  const valid = (
    record.type === 'id'
    && typeof record.id === 'string'
  ) || (
    record.type === 'parent-order'
    && typeof record.orderKey === 'string'
    && typeof record.id === 'string'
  ) || (
    record.type === 'widget-identity'
    && typeof record.revisionId === 'string'
    && typeof record.instanceId === 'string'
    && typeof record.id === 'string'
  );
  if (!valid) {
    throw fnCanvasCliError(
      command,
      'CANVAS_CURSOR_INVALID',
      '--cursor does not match an id, parent-order, or widget-identity cursor.',
    );
  }
  return parsed as TCanvasItemQueryCursor;
}

function queryFilter(
  command: string,
  values: TOptionValues,
): TCanvasItemQueryFilter {
  const ids = stringValues(values, 'id');
  const kind = stringValue(command, values, 'kind');
  const parent = stringValue(command, values, 'parent');
  const widgetInstance = stringValue(command, values, 'widget-instance');
  const widgetDefinition = stringValue(command, values, 'widget-definition');
  const revisionId = stringValue(command, values, 'revision');
  const filterCount = Number(ids.length > 0)
    + Number(kind !== undefined)
    + Number(parent !== undefined)
    + Number(widgetInstance !== undefined)
    + Number(widgetDefinition !== undefined);
  if (filterCount > 1) {
    throw fnCanvasCliError(
      command,
      'CANVAS_QUERY_FILTER_CONFLICT',
      'Choose at most one query filter: --id, --kind, --parent, --widget-instance, or --widget-definition.',
    );
  }
  if (revisionId !== undefined && widgetDefinition === undefined) {
    throw fnCanvasCliError(
      command,
      'CANVAS_QUERY_REVISION_WITHOUT_DEFINITION',
      '--revision is only valid with --widget-definition.',
    );
  }
  if (ids.length > 0) return { type: 'ids', ids };
  if (kind !== undefined) return { type: 'kind', kind: kind as never };
  if (parent !== undefined) {
    return { type: 'parent', parentId: parent === 'root' || parent === 'null' ? null : parent };
  }
  if (widgetInstance !== undefined) {
    return { type: 'widget-instance', instanceId: widgetInstance };
  }
  if (widgetDefinition !== undefined) {
    return {
      type: 'widget-definition',
      definitionId: widgetDefinition,
      ...(revisionId === undefined ? {} : { revisionId }),
    };
  }
  return { type: 'all' };
}

export function parseCanvasSubcommandArgs(
  subcommand: TCanvasCliSubcommand,
  args: readonly string[],
): TParsedCanvasCommand {
  const command = `canvas.${subcommand}`;
  if (subcommand === 'list') {
    parseOptions(command, args, {});
    return { subcommand };
  }
  if (subcommand === 'query') {
    const values = parseOptions(command, args, {
      ...SELECTOR_OPTIONS,
      id: { type: 'string', multiple: true },
      kind: { type: 'string' },
      parent: { type: 'string' },
      'widget-instance': { type: 'string' },
      'widget-definition': { type: 'string' },
      revision: { type: 'string' },
      limit: { type: 'string' },
      cursor: { type: 'string' },
    });
    const limit = positiveInteger(command, values, 'limit');
    const cursor = queryCursor(command, values);
    return {
      subcommand,
      input: {
        ...selector(command, values),
        filter: queryFilter(command, values),
        ...(limit === undefined ? {} : { limit }),
        ...(cursor === undefined ? {} : { cursor }),
      },
    };
  }
  if (subcommand === 'add') {
    const values = parseOptions(command, args, {
      ...SELECTOR_OPTIONS,
      item: { type: 'string', multiple: true },
    });
    return {
      subcommand,
      input: {
        ...selector(command, values),
        dryRun: dryRun(values),
        items: nodes(command, values),
      },
    };
  }
  if (subcommand === 'patch') {
    const values = parseOptions(command, args, {
      ...SELECTOR_OPTIONS,
      id: { type: 'string', multiple: true },
      patch: { type: 'string' },
    });
    return {
      subcommand,
      input: {
        ...selector(command, values),
        dryRun: dryRun(values),
        ids: requiredIds(command, values),
        patches: patches(command, values),
      },
    };
  }
  if (subcommand === 'move') {
    const values = parseOptions(command, args, {
      ...SELECTOR_OPTIONS,
      id: { type: 'string', multiple: true },
      absolute: { type: 'boolean' },
      relative: { type: 'boolean' },
      x: { type: 'string' },
      y: { type: 'string' },
    });
    if (Boolean(values.absolute) === Boolean(values.relative)) {
      throw fnCanvasCliError(
        command,
        'CANVAS_MOVE_MODE_REQUIRED',
        'Choose exactly one move mode: --absolute or --relative.',
      );
    }
    const x = finiteNumber(command, values, 'x');
    const y = finiteNumber(command, values, 'y');
    if (x === undefined && y === undefined) {
      throw fnCanvasCliError(
        command,
        'CANVAS_MOVE_COORDINATE_REQUIRED',
        'Pass --x, --y, or both.',
      );
    }
    return {
      subcommand,
      input: {
        ...selector(command, values),
        dryRun: dryRun(values),
        ids: requiredIds(command, values),
        mode: values.relative === true ? 'relative' : 'absolute',
        ...(x === undefined ? {} : { x }),
        ...(y === undefined ? {} : { y }),
      },
    };
  }
  if (subcommand === 'group') {
    const values = parseOptions(command, args, {
      ...SELECTOR_OPTIONS,
      id: { type: 'string', multiple: true },
      'group-id': { type: 'string' },
    });
    return {
      subcommand,
      input: {
        ...selector(command, values),
        dryRun: dryRun(values),
        ids: requiredIds(command, values, 2),
        groupId: stringValue(command, values, 'group-id') ?? '',
      },
    };
  }
  if (subcommand === 'ungroup') {
    const values = parseOptions(command, args, {
      ...SELECTOR_OPTIONS,
      id: { type: 'string' },
    });
    const groupId = stringValue(command, values, 'id');
    if (groupId === undefined) {
      throw fnCanvasCliError(
        command,
        'CANVAS_GROUP_ID_REQUIRED',
        'Pass one group node id with --id.',
      );
    }
    return {
      subcommand,
      input: {
        ...selector(command, values),
        dryRun: dryRun(values),
        groupId,
      },
    };
  }
  if (subcommand === 'reorder') {
    const values = parseOptions(command, args, {
      ...SELECTOR_OPTIONS,
      id: { type: 'string' },
      'order-key': { type: 'string' },
    });
    const id = stringValue(command, values, 'id');
    const orderKey = stringValue(command, values, 'order-key');
    if (id === undefined || orderKey === undefined) {
      throw fnCanvasCliError(
        command,
        'CANVAS_REORDER_ARGUMENT_REQUIRED',
        'Pass one --id and one non-empty --order-key.',
      );
    }
    return {
      subcommand,
      input: {
        ...selector(command, values),
        dryRun: dryRun(values),
        id,
        orderKey,
      },
    };
  }
  const values = parseOptions(command, args, {
    ...SELECTOR_OPTIONS,
    id: { type: 'string', multiple: true },
  });
  return {
    subcommand: 'delete',
    input: {
      ...selector(command, values),
      dryRun: dryRun(values),
      ids: requiredIds(command, values),
    },
  };
}
