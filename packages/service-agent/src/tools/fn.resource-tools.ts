import { fnResourceNameKey } from '@omnidraw/service-db/core/fn.resource-name';
import type { TDbInspection, TDbObject } from '@omnidraw/resource-runtime';
import type { TAgentResource } from './resource-service';

type TResourceKind = TAgentResource['kind'];

export type TSafeResource = {
  name: string;
  kind: TResourceKind;
  status: TAgentResource['status'];
};

export type TSafeResourceError = {
  code: string;
  message: string;
};

function fnCompareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fnCursorChecksum(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(36);
}

export function fnSafeResource(resource: TAgentResource): TSafeResource {
  return {
    name: resource.name,
    kind: resource.kind,
    status: resource.status,
  };
}

export function fnSafeManifestResourceLink(resource: TAgentResource) {
  return {
    resourceId: resource.id,
    name: resource.name,
    kind: resource.kind,
    status: resource.status,
  };
}

export function fnSafeResourceMetadata(resource: TAgentResource) {
  return {
    ...fnSafeResource(resource),
    createdAtSec: resource.createdAtSec,
    updatedAtSec: resource.updatedAtSec,
  };
}

export function fnSortResources(resources: readonly TAgentResource[]): TAgentResource[] {
  return [...resources].sort((left, right) => (
    fnCompareStrings(fnResourceNameKey(left.name), fnResourceNameKey(right.name))
    || fnCompareStrings(left.kind, right.kind)
    || fnCompareStrings(left.id, right.id)
  ));
}

export function fnSafeResourceError(
  error: unknown,
  fallback: TSafeResourceError = { code: 'RESOURCE_OPERATION_FAILED', message: 'Resource operation failed.' },
): TSafeResourceError {
  const value = error as { code?: unknown; message?: unknown };
  return {
    code: typeof value?.code === 'string' ? value.code : fallback.code,
    message: typeof value?.message === 'string' ? value.message : fallback.message,
  };
}

export function fnRedactResourceError(error: TSafeResourceError, values: readonly string[]): TSafeResourceError {
  let code = error.code;
  let message = error.message;
  for (const value of values) {
    if (value.length === 0) continue;
    code = code.split(value).join('[redacted]');
    message = message.split(value).join('[redacted]');
  }
  return { code, message };
}

export function fnResourceListFingerprint(resources: readonly TAgentResource[]): string {
  return fnCursorChecksum(resources.map((resource) => (
    `${fnResourceNameKey(resource.name)}\u0000${resource.kind}\u0000${resource.status}\u0000${resource.id}`
  )).join('\u0001'));
}

export function fnCreateResourceListCursor(offset: number, fingerprint: string, kind?: TResourceKind): string {
  const payload = `${kind ?? 'all'}.${offset.toString(36)}.${fingerprint}`;
  return `vc1.${payload}.${fnCursorChecksum(payload)}`;
}

export function fnParseResourceListCursor(
  cursor: string,
  expectedFingerprint: string,
  expectedKind?: TResourceKind,
): { ok: true; offset: number } | { ok: false } {
  const match = /^vc1\.(all|kv|secretStore|db)\.([0-9a-z]+)\.([0-9a-z]+)\.([0-9a-z]+)$/u.exec(cursor);
  if (!match) return { ok: false };
  const kind = match[1]!;
  const offsetText = match[2]!;
  const fingerprint = match[3]!;
  const payload = `${kind}.${offsetText}.${fingerprint}`;
  if (
    match[4] !== fnCursorChecksum(payload)
    || kind !== (expectedKind ?? 'all')
    || fingerprint !== expectedFingerprint
  ) return { ok: false };
  const offset = Number.parseInt(offsetText, 36);
  return Number.isSafeInteger(offset) && offset >= 0 ? { ok: true, offset } : { ok: false };
}

export function fnSortDbSchemaObjects(objects: readonly TDbObject[]): TDbObject[] {
  return [...objects].sort((left, right) => (
    fnCompareStrings(left.name.toLowerCase(), right.name.toLowerCase())
    || fnCompareStrings(left.name, right.name)
    || fnCompareStrings(left.kind, right.kind)
  ));
}

export function fnDbSchemaFingerprint(objects: readonly TDbObject[]): string {
  return fnCursorChecksum(JSON.stringify(fnSortDbSchemaObjects(objects)));
}

export function fnCreateDbSchemaCursor(offset: number, fingerprint: string): string {
  const payload = `${offset.toString(36)}.${fingerprint}`;
  return `vds1.${payload}.${fnCursorChecksum(payload)}`;
}

export function fnParseDbSchemaCursor(
  cursor: string,
  expectedFingerprint: string,
): { ok: true; offset: number } | { ok: false } {
  const match = /^vds1\.([0-9a-z]+)\.([0-9a-z]+)\.([0-9a-z]+)$/u.exec(cursor);
  if (!match) return { ok: false };
  const offsetText = match[1]!;
  const fingerprint = match[2]!;
  const payload = `${offsetText}.${fingerprint}`;
  if (match[3] !== fnCursorChecksum(payload) || fingerprint !== expectedFingerprint) return { ok: false };
  const offset = Number.parseInt(offsetText, 36);
  return Number.isSafeInteger(offset) && offset >= 0 ? { ok: true, offset } : { ok: false };
}

export function fnDbApplyTerminalStatus(status: string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'recovered';
}

export function fnResourceCapabilities(resource: TAgentResource) {
  const ready = resource.status === 'ready';
  const lifecycleBusy = resource.status === 'provisioning'
    || resource.status === 'migrating'
    || resource.status === 'deleting';
  const currentlyDeletable = !lifecycleBusy;
  return {
    ready,
    currentlyDeletable,
    deleteBlockedReason: lifecycleBusy
      ? `Resource status '${resource.status}' currently blocks deletion.`
      : null,
    capabilities: {
      inspect: true,
      read: ready,
      write: ready,
      rename: !lifecycleBusy,
      delete: currentlyDeletable,
    },
  };
}

export function fnSafeDbSchemaObject(object: TDbObject) {
  return {
    name: object.name,
    kind: object.kind,
    columns: object.columns.slice(0, 128).map((column) => ({
      ...column,
      defaultSql: column.defaultSql?.slice(0, 8_000) ?? null,
    })),
    columnsTruncated: object.columns.length > 128,
    indexes: object.indexes.slice(0, 64).map((index) => ({
      name: index.name,
      unique: index.unique,
      origin: index.origin,
      partial: index.partial,
      columns: index.columns.slice(0, 64),
      columnsTruncated: index.columns.length > 64,
    })),
    indexesTruncated: object.indexes.length > 64,
    foreignKeys: object.foreignKeys.slice(0, 64).map((foreignKey) => ({
      ...foreignKey,
      columns: foreignKey.columns.slice(0, 64),
      referencedColumns: foreignKey.referencedColumns.slice(0, 64),
    })),
    foreignKeysTruncated: object.foreignKeys.length > 64,
    triggers: object.triggers.slice(0, 64).map((trigger) => ({ name: trigger.name })),
    triggersTruncated: object.triggers.length > 64,
    createSql: object.createSql,
    identity: object.identity?.kind === 'primaryKey'
      ? { kind: object.identity.kind, columns: object.identity.columns.slice(0, 64) }
      : object.identity,
    editable: object.editable,
    readOnlyReason: object.readOnlyReason?.slice(0, 2_000) ?? null,
  };
}

export function fnSafeDbSchemaOverview(
  inspection: TDbInspection | null | undefined,
  page: { offset?: number; limit?: number } = {},
) {
  const allObjects = fnSortDbSchemaObjects(inspection?.objects ?? []);
  const offset = page.offset ?? 0;
  const limit = Math.max(1, Math.min(100, page.limit ?? 100));
  const selectedObjects = allObjects.slice(offset, offset + limit);
  const objects = selectedObjects.map((object) => ({
    name: object.name,
    kind: object.kind,
    createSql: object.createSql,
    indexes: object.indexes.slice(0, 64).map((index) => ({
      name: index.name,
      unique: index.unique,
      columns: index.columns.slice(0, 64).map((column) => column.name),
      columnsTruncated: index.columns.length > 64,
    })),
    indexesTruncated: object.indexes.length > 64,
    foreignKeys: object.foreignKeys.slice(0, 64).map((foreignKey) => ({
      columns: foreignKey.columns.slice(0, 64),
      referencedTable: foreignKey.referencedTable,
      referencedColumns: foreignKey.referencedColumns.slice(0, 64),
      onUpdate: foreignKey.onUpdate,
      onDelete: foreignKey.onDelete,
    })),
    foreignKeysTruncated: object.foreignKeys.length > 64,
    triggers: object.triggers.slice(0, 64).map((trigger) => trigger.name),
    triggersTruncated: object.triggers.length > 64,
    editable: object.editable,
    readOnlyReason: object.readOnlyReason?.slice(0, 2_000) ?? null,
  }));
  const nextOffset = offset + objects.length;
  const fingerprint = fnDbSchemaFingerprint(allObjects);
  return {
    available: inspection != null,
    summary: {
      objectCount: allObjects.length,
      tableCount: allObjects.filter((object) => object.kind === 'table').length,
      viewCount: allObjects.filter((object) => object.kind === 'view').length,
      columnCount: allObjects.reduce((count, object) => count + object.columns.length, 0),
      indexCount: allObjects.reduce((count, object) => count + object.indexes.length, 0),
      foreignKeyCount: allObjects.reduce((count, object) => count + object.foreignKeys.length, 0),
      triggerCount: allObjects.reduce((count, object) => count + object.triggers.length, 0),
    },
    objects,
    nextCursor: nextOffset < allObjects.length ? fnCreateDbSchemaCursor(nextOffset, fingerprint) : null,
    rowsRead: false,
  };
}
