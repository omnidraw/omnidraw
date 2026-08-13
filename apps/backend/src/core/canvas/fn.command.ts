import type {
  TCanvasCommand,
  TCanvasItemId,
  TCanvasItemPatch,
  TCanvasItemSnapshot,
  TCanvasJsonPath,
  TCanvasOperation,
  TCanvasPrecondition,
} from '@omnidraw/canvas-contract';

type TSceneNode = TCanvasItemSnapshot['item'];
type TJsonValue = Extract<TCanvasItemPatch, { type: 'set' }>['value'];

export type TCommandLimits = Readonly<{
  maxOperations: number;
  maxPreconditions: number;
  maxPatchesPerOperation: number;
  maxTouchedItems: number;
  maxCommandBytes: number;
  maxJsonDepth: number;
  maxJsonEntries: number;
  maxPathDepth: number;
}>;

export type TCommandIssue = Readonly<{
  code: string;
  message: string;
}>;

export type TJsonBounds = Readonly<{
  maxBytes: number;
  maxDepth: number;
  maxEntries: number;
}>;

export type TPathReadResult =
  | Readonly<{ exists: false }>
  | Readonly<{ exists: true; value: unknown }>;

export type TPatchResult =
  | Readonly<{ ok: true; item: TSceneNode }>
  | Readonly<{ ok: false; message: string }>;

type TJsonMeasure = Readonly<{
  valid: boolean;
  depth: number;
  entries: number;
}>;

const FORBIDDEN_PATH_SEGMENTS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

function measureJson(value: unknown, depth: number): TJsonMeasure {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return { valid: true, depth, entries: 1 };
  }
  if (Array.isArray(value)) {
    let maxDepth = depth;
    let entries = 1;
    for (const entry of value) {
      const measured = measureJson(entry, depth + 1);
      if (!measured.valid) return measured;
      maxDepth = Math.max(maxDepth, measured.depth);
      entries += measured.entries;
    }
    return { valid: true, depth: maxDepth, entries };
  }
  if (typeof value !== 'object' || value === undefined) {
    return { valid: false, depth, entries: 1 };
  }
  const record = value as Readonly<Record<string, unknown>>;
  let maxDepth = depth;
  let entries = 1;
  for (const [key, entry] of Object.entries(record)) {
    if (FORBIDDEN_PATH_SEGMENTS.has(key)) {
      return { valid: false, depth, entries };
    }
    const measured = measureJson(entry, depth + 1);
    if (!measured.valid) return measured;
    maxDepth = Math.max(maxDepth, measured.depth);
    entries += measured.entries + 1;
  }
  return { valid: true, depth: maxDepth, entries };
}

function pathKey(path: TCanvasJsonPath): string {
  return path
    .map((part) => (
      typeof part === 'number'
        ? `n:${part}`
        : `s:${part.length}:${part}`
    ))
    .join('|');
}

function hasItemRevisionGuard(
  preconditions: readonly TCanvasPrecondition[],
  itemId: TCanvasItemId,
): boolean {
  return preconditions.some((precondition) => (
    precondition.type === 'item-revision'
    && precondition.itemId === itemId
  ));
}

function hasItemValueGuard(
  preconditions: readonly TCanvasPrecondition[],
  itemId: TCanvasItemId,
): boolean {
  return preconditions.some((precondition) => (
    (precondition.type === 'path-absent' || precondition.type === 'path-value')
    && precondition.itemId === itemId
  ));
}

function hasPathGuard(
  preconditions: readonly TCanvasPrecondition[],
  itemId: TCanvasItemId,
  path: TCanvasJsonPath,
): boolean {
  const expectedKey = pathKey(path);
  return preconditions.some((precondition) => (
    (precondition.type === 'path-absent' || precondition.type === 'path-value')
    && precondition.itemId === itemId
    && pathKey(precondition.path) === expectedKey
  ));
}

function validatePath(
  path: TCanvasJsonPath,
  maxPathDepth: number,
): TCommandIssue | null {
  if (path.length === 0) {
    return { code: 'EMPTY_PATH', message: 'JSON patch and value paths cannot be empty.' };
  }
  if (path.length > maxPathDepth) {
    return {
      code: 'PATH_DEPTH_LIMIT',
      message: `A JSON path exceeds the maximum depth of ${maxPathDepth}.`,
    };
  }
  for (const part of path) {
    if (
      (typeof part === 'number' && (!Number.isSafeInteger(part) || part < 0))
      || (typeof part === 'string' && (
        part.length === 0 || FORBIDDEN_PATH_SEGMENTS.has(part)
      ))
    ) {
      return { code: 'INVALID_PATH', message: 'A JSON path contains an invalid segment.' };
    }
  }
  if (path[0] === 'id') {
    return { code: 'IMMUTABLE_ID', message: 'Canvas item IDs cannot be patched.' };
  }
  if (path[0] === 'parentId' || path[0] === 'orderKey') {
    return {
      code: 'STRUCTURAL_PATCH',
      message: 'Use reparent or reorder for hierarchy and order changes.',
    };
  }
  return null;
}

function validateOperationGuards(
  operation: TCanvasOperation,
  preconditions: readonly TCanvasPrecondition[],
): TCommandIssue[] {
  if (operation.type === 'insert') {
    const guarded = preconditions.some((precondition) => (
      precondition.type === 'item-absent'
      && precondition.itemId === operation.item.id
    ));
    return guarded
      ? []
      : [{
          code: 'MISSING_PRECONDITION',
          message: `Insert '${operation.item.id}' requires an item-absent precondition.`,
        }];
  }
  if (operation.type === 'patch') {
    if (hasItemRevisionGuard(preconditions, operation.itemId)) return [];
    const unguarded = operation.patches.find((patch) => (
      !hasPathGuard(preconditions, operation.itemId, patch.path)
    ));
    return unguarded === undefined
      ? []
      : [{
          code: 'MISSING_PRECONDITION',
          message: `Patch '${operation.itemId}' has an unguarded JSON path.`,
        }];
  }
  if (operation.type === 'delete') {
    return hasItemRevisionGuard(preconditions, operation.itemId)
      || hasItemValueGuard(preconditions, operation.itemId)
      ? []
      : [{
          code: 'MISSING_PRECONDITION',
          message: `Delete '${operation.itemId}' requires an item or value precondition.`,
        }];
  }
  const itemId = operation.type === 'replace'
    ? operation.item.id
    : operation.itemId;
  return hasItemRevisionGuard(preconditions, itemId)
    ? []
    : [{
        code: 'MISSING_PRECONDITION',
        message: `${operation.type} '${itemId}' requires an item-revision precondition.`,
      }];
}

function operationItemIds(operation: TCanvasOperation): readonly TCanvasItemId[] {
  if (operation.type === 'insert' || operation.type === 'replace') {
    return operation.item.parentId === null
      ? [operation.item.id]
      : [operation.item.id, operation.item.parentId];
  }
  if (operation.type === 'reparent') {
    return operation.parentId === null
      ? [operation.itemId]
      : [operation.itemId, operation.parentId];
  }
  return [operation.itemId];
}

function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => cloneJson(entry));
  if (value !== null && typeof value === 'object') {
    const cloned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      cloned[key] = cloneJson(entry);
    }
    return cloned;
  }
  return value;
}

function resolveParent(
  root: unknown,
  path: TCanvasJsonPath,
): Readonly<{ parent: unknown; final: string | number }> | null {
  let parent = root;
  for (const part of path.slice(0, -1)) {
    if (typeof part === 'number') {
      if (!Array.isArray(parent) || part >= parent.length) return null;
      parent = parent[part];
      continue;
    }
    if (
      parent === null
      || typeof parent !== 'object'
      || Array.isArray(parent)
      || !Object.prototype.hasOwnProperty.call(parent, part)
    ) {
      return null;
    }
    parent = (parent as Readonly<Record<string, unknown>>)[part];
  }
  return { parent, final: path[path.length - 1]! };
}

function applyPatch(root: unknown, patch: TCanvasItemPatch): string | null {
  const resolved = resolveParent(root, patch.path);
  if (resolved === null) return 'The patch parent path does not exist.';
  const { parent, final } = resolved;
  if (typeof final === 'number') {
    if (!Array.isArray(parent)) return 'A numeric path segment requires an array.';
    if (patch.type === 'set') {
      if (final > parent.length) return 'An array patch index is out of bounds.';
      if (final === parent.length) parent.push(cloneJson(patch.value));
      else parent[final] = cloneJson(patch.value);
      return null;
    }
    if (final >= parent.length) return 'The array element to remove does not exist.';
    parent.splice(final, 1);
    return null;
  }
  if (parent === null || typeof parent !== 'object' || Array.isArray(parent)) {
    return 'A string path segment requires an object.';
  }
  const record = parent as Record<string, unknown>;
  if (patch.type === 'set') {
    record[final] = cloneJson(patch.value);
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(record, final)) {
    return 'The property to remove does not exist.';
  }
  delete record[final];
  return null;
}

export function fnUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
      bytes += 4;
    } else bytes += 3;
  }
  return bytes;
}

export function fnValidateJsonBounds(
  value: unknown,
  bounds: TJsonBounds,
): readonly TCommandIssue[] {
  const issues: TCommandIssue[] = [];
  const measured = measureJson(value, 0);
  if (!measured.valid) {
    return [{
      code: 'INVALID_JSON',
      message: 'The value contains non-JSON or unsafe data.',
    }];
  }
  if (measured.depth > bounds.maxDepth) {
    issues.push({
      code: 'JSON_DEPTH_LIMIT',
      message: `The value exceeds JSON depth ${bounds.maxDepth}.`,
    });
  }
  if (measured.entries > bounds.maxEntries) {
    issues.push({
      code: 'JSON_ENTRY_LIMIT',
      message: `The value exceeds ${bounds.maxEntries} JSON entries.`,
    });
  }
  try {
    if (fnUtf8ByteLength(JSON.stringify(value)) > bounds.maxBytes) {
      issues.push({
        code: 'JSON_SIZE_LIMIT',
        message: `The value exceeds ${bounds.maxBytes} bytes.`,
      });
    }
  } catch {
    issues.push({
      code: 'INVALID_JSON',
      message: 'The value cannot be serialized as JSON.',
    });
  }
  return issues;
}

export function fnValidateCommand(
  command: TCanvasCommand,
  limits: TCommandLimits,
): readonly TCommandIssue[] {
  const issues: TCommandIssue[] = [];
  if (command.canvasId.trim().length === 0 || command.commandId.trim().length === 0) {
    issues.push({
      code: 'INVALID_ID',
      message: 'canvasId and commandId must be non-empty strings.',
    });
  }
  if (!Number.isSafeInteger(command.baseRevision) || command.baseRevision < 0) {
    issues.push({
      code: 'INVALID_REVISION',
      message: 'baseRevision must be a non-negative safe integer.',
    });
  }
  if (command.operations.length === 0) {
    issues.push({ code: 'EMPTY_COMMAND', message: 'A command must contain an operation.' });
  }
  if (command.operations.length > limits.maxOperations) {
    issues.push({
      code: 'OPERATION_LIMIT',
      message: `The command exceeds ${limits.maxOperations} operations.`,
    });
  }
  if (command.preconditions.length > limits.maxPreconditions) {
    issues.push({
      code: 'PRECONDITION_LIMIT',
      message: `The command exceeds ${limits.maxPreconditions} preconditions.`,
    });
  }

  for (const precondition of command.preconditions) {
    if (
      precondition.type === 'path-absent'
      || precondition.type === 'path-value'
    ) {
      const pathIssue = validatePath(precondition.path, limits.maxPathDepth);
      if (pathIssue !== null) issues.push(pathIssue);
    }
  }

  for (const operation of command.operations) {
    issues.push(...validateOperationGuards(operation, command.preconditions));
    if (operation.type !== 'patch') continue;
    if (operation.patches.length === 0) {
      issues.push({
        code: 'EMPTY_PATCH',
        message: `Patch '${operation.itemId}' must contain at least one path.`,
      });
    }
    if (operation.patches.length > limits.maxPatchesPerOperation) {
      issues.push({
        code: 'PATCH_LIMIT',
        message: `A patch exceeds ${limits.maxPatchesPerOperation} paths.`,
      });
    }
    const seenPaths = new Set<string>();
    for (const patch of operation.patches) {
      const pathIssue = validatePath(patch.path, limits.maxPathDepth);
      if (pathIssue !== null) issues.push(pathIssue);
      const key = pathKey(patch.path);
      if (seenPaths.has(key)) {
        issues.push({
          code: 'DUPLICATE_PATCH_PATH',
          message: `Patch '${operation.itemId}' repeats a JSON path.`,
        });
      }
      seenPaths.add(key);
    }
  }

  const touched = fnCollectCommandItemIds(command);
  if (touched.length > limits.maxTouchedItems) {
    issues.push({
      code: 'TOUCHED_ITEM_LIMIT',
      message: `The command touches more than ${limits.maxTouchedItems} items.`,
    });
  }
  issues.push(...fnValidateJsonBounds(command, {
    maxBytes: limits.maxCommandBytes,
    maxDepth: limits.maxJsonDepth,
    maxEntries: limits.maxJsonEntries,
  }).map((issue) => (
    issue.code === 'JSON_SIZE_LIMIT'
      ? { ...issue, code: 'COMMAND_SIZE_LIMIT' }
      : issue
  )));
  return issues;
}

export function fnCollectCommandItemIds(
  command: TCanvasCommand,
): readonly TCanvasItemId[] {
  const ids = new Set<TCanvasItemId>();
  for (const precondition of command.preconditions) ids.add(precondition.itemId);
  for (const operation of command.operations) {
    for (const id of operationItemIds(operation)) ids.add(id);
  }
  return [...ids];
}

export function fnReadJsonPath(
  value: unknown,
  path: TCanvasJsonPath,
): TPathReadResult {
  let current = value;
  for (const part of path) {
    if (typeof part === 'number') {
      if (!Array.isArray(current) || part >= current.length) {
        return { exists: false };
      }
      current = current[part];
      continue;
    }
    if (
      current === null
      || typeof current !== 'object'
      || Array.isArray(current)
      || !Object.prototype.hasOwnProperty.call(current, part)
    ) {
      return { exists: false };
    }
    current = (current as Readonly<Record<string, unknown>>)[part];
  }
  return { exists: true, value: current };
}

export function fnJsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((entry, index) => fnJsonEqual(entry, right[index]));
  }
  if (
    left === null
    || right === null
    || typeof left !== 'object'
    || typeof right !== 'object'
  ) {
    return false;
  }
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index]
      && fnJsonEqual(leftRecord[key], rightRecord[key])
    ));
}

export function fnApplyCanvasItemPatches(
  item: TSceneNode,
  patches: readonly TCanvasItemPatch[],
): TPatchResult {
  const cloned = cloneJson(item);
  for (const patch of patches) {
    const error = applyPatch(cloned, patch);
    if (error !== null) return { ok: false, message: error };
  }
  return { ok: true, item: cloned as TSceneNode };
}

export function fnCloneCanvasItem(item: TSceneNode): TSceneNode {
  return cloneJson(item) as TSceneNode;
}

export function fnCloneJsonValue(value: TJsonValue): TJsonValue {
  return cloneJson(value) as TJsonValue;
}
