/**
 * @file Pure identity, JSON, pagination, and row helpers for physical actor key-value files.
 */
import type { TJson } from '@vibecanvas/service-db/model';
import type {
  TActorResourceKeyValueEntry,
  TActorResourceKeyValueEntryMetadata,
} from './ActorResourceKeyValuePersistence';

const RESOURCE_ID_MAX_LENGTH = 128;
const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 500;

type TNativeEntryMetadataRow = {
  readonly key: unknown;
  readonly revision: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
};

type TNativeEntryRow = TNativeEntryMetadataRow & {
  readonly value: unknown;
};

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value: unknown, ancestors: Set<object>): asserts value is TJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite.');
    return;
  }
  if (typeof value !== 'object') throw new TypeError('Value is not JSON-compatible.');
  if (ancestors.has(value)) throw new TypeError('Cyclic values are not JSON-compatible.');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) assertJsonValue(item, ancestors);
      return;
    }
    if (!isPlainRecord(value)) throw new TypeError('Class instances are not JSON-compatible.');
    for (const item of Object.values(value)) assertJsonValue(item, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

export function fnActorResourceKeyValueHostId(value: string): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > RESOURCE_ID_MAX_LENGTH
    || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
  ) {
    throw new TypeError('Actor resource has an invalid host identity.');
  }
  return value;
}

export function fnActorResourceKeyValueSerialize(value: unknown): string {
  assertJsonValue(value, new Set());
  return JSON.stringify(value);
}

export function fnActorResourceKeyValueParse(value: unknown): TJson {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  assertJsonValue(parsed, new Set());
  return parsed;
}

export function fnActorResourceKeyValueListLimit(limit: number | undefined): number {
  const resolved = limit ?? LIST_DEFAULT_LIMIT;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > LIST_MAX_LIMIT) {
    throw new RangeError(`Actor resource key-value list limit must be between 1 and ${LIST_MAX_LIMIT}.`);
  }
  return resolved;
}

export function fnActorResourceKeyValueEntry(row: unknown): TActorResourceKeyValueEntry {
  const value = row as TNativeEntryRow;
  return {
    ...fnActorResourceKeyValueEntryMetadata(value),
    value: fnActorResourceKeyValueParse(value.value),
  };
}

export function fnActorResourceKeyValueEntryMetadata(row: unknown): TActorResourceKeyValueEntryMetadata {
  const value = row as TNativeEntryMetadataRow;
  const revision = Number(value.revision);
  if (
    typeof value.key !== 'string'
    || !Number.isInteger(revision)
    || revision < 1
    || typeof value.created_at !== 'string'
    || typeof value.updated_at !== 'string'
  ) {
    throw new TypeError('Actor resource key-value entry is malformed.');
  }
  return {
    key: value.key,
    revision,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}
