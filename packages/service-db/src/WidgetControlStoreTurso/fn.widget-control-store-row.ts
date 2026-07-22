import type { TResourceEffect, TResourceRequirement } from '@vibecanvas/resource-runtime';
import type {
  TWidgetArtifactDescriptor,
  TWidgetDefinitionDescriptor,
  TWidgetManifestV2,
  TWidgetRevisionDescriptor,
  TWidgetServerFunctionDescriptor,
} from '@vibecanvas/widget-contract';

export type TWidgetControlStoreArtifactRow = Readonly<{
  org_id: TWidgetArtifactDescriptor['orgId'];
  id: string;
  kind: TWidgetArtifactDescriptor['kind'];
  digest_sha256: string;
  byte_size: unknown;
  retention_state: TWidgetArtifactDescriptor['retentionState'];
  retain_until_ms: unknown;
  created_at_ms: unknown;
}>;

function numberFromSql(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`Stored ${label} is invalid.`);
  }
  return number;
}

function nullableArtifact(
  row: Record<string, unknown>,
  prefix: 'server_',
): TWidgetArtifactDescriptor | null {
  const id = row[`${prefix}id`];
  if (id === null || id === undefined) return null;
  return fnWidgetControlStoreArtifact({
    org_id: row.org_id as TWidgetArtifactDescriptor['orgId'],
    id: String(id),
    kind: row[`${prefix}kind`] as TWidgetArtifactDescriptor['kind'],
    digest_sha256: String(row[`${prefix}digest_sha256`]),
    byte_size: row[`${prefix}byte_size`],
    retention_state: row[`${prefix}retention_state`] as TWidgetArtifactDescriptor['retentionState'],
    retain_until_ms: row[`${prefix}retain_until_ms`],
    created_at_ms: row[`${prefix}created_at_ms`],
  });
}

export function fnWidgetControlStoreSerializeManifest(manifest: TWidgetManifestV2): string {
  const serialized = JSON.stringify(manifest);
  if (serialized === undefined) throw new TypeError('Widget manifest is not JSON serializable.');
  return serialized;
}

export function fnWidgetControlStoreDefinition(row: unknown): TWidgetDefinitionDescriptor {
  const value = row as {
    org_id: TWidgetDefinitionDescriptor['orgId'];
    id: string;
    slug: string;
    name: string;
    status: TWidgetDefinitionDescriptor['status'];
    active_revision_id: string | null;
    created_at_ms: unknown;
    updated_at_ms: unknown;
  };
  return {
    orgId: value.org_id,
    id: value.id,
    slug: value.slug,
    name: value.name,
    status: value.status,
    activeRevisionId: value.active_revision_id,
    createdAtMs: numberFromSql(value.created_at_ms, 'widget definition created timestamp'),
    updatedAtMs: numberFromSql(value.updated_at_ms, 'widget definition updated timestamp'),
  };
}

export function fnWidgetControlStoreArtifact(row: TWidgetControlStoreArtifactRow): TWidgetArtifactDescriptor {
  return {
    orgId: row.org_id,
    id: row.id,
    kind: row.kind,
    digestSha256: row.digest_sha256,
    byteSize: numberFromSql(row.byte_size, 'widget artifact byte size'),
    retentionState: row.retention_state,
    retainUntilMs: row.retain_until_ms === null || row.retain_until_ms === undefined
      ? null
      : numberFromSql(row.retain_until_ms, 'widget artifact retention timestamp'),
    createdAtMs: numberFromSql(row.created_at_ms, 'widget artifact created timestamp'),
  };
}

export function fnWidgetControlStoreRevision(row: unknown): TWidgetRevisionDescriptor {
  const value = row as Record<string, unknown> & {
    org_id: TWidgetRevisionDescriptor['orgId'];
    id: string;
    definition_id: string;
    revision_number: unknown;
    manifest_json: string | TWidgetManifestV2;
    contract_digest_sha256: string;
    created_at_ms: unknown;
    ui_id: string;
    ui_kind: TWidgetArtifactDescriptor['kind'];
    ui_digest_sha256: string;
    ui_byte_size: unknown;
  };
  const storedDescriptors = typeof value.function_descriptors_json === 'string'
    ? JSON.parse(value.function_descriptors_json) as { functions?: unknown }
    : value.function_descriptors_json as { functions?: unknown };
  if (!Array.isArray(storedDescriptors?.functions)) {
    throw new TypeError('Stored widget function descriptors are invalid.');
  }
  return {
    orgId: value.org_id,
    id: value.id,
    definitionId: value.definition_id,
    revisionNumber: numberFromSql(value.revision_number, 'widget revision number'),
    manifest: (typeof value.manifest_json === 'string'
      ? JSON.parse(value.manifest_json)
      : value.manifest_json) as TWidgetManifestV2,
    canonicalManifestJson: typeof value.manifest_json === 'string'
      ? value.manifest_json
      : JSON.stringify(value.manifest_json),
    functionDescriptors: storedDescriptors.functions as readonly TWidgetServerFunctionDescriptor[],
    functionDescriptorsDigestSha256: String(value.function_descriptors_digest_sha256),
    contractDigestSha256: value.contract_digest_sha256,
    uiArtifact: fnWidgetControlStoreArtifact({
      org_id: value.org_id,
      id: value.ui_id,
      kind: value.ui_kind,
      digest_sha256: value.ui_digest_sha256,
      byte_size: value.ui_byte_size,
      retention_state: value.ui_retention_state as TWidgetArtifactDescriptor['retentionState'],
      retain_until_ms: value.ui_retain_until_ms,
      created_at_ms: value.ui_created_at_ms,
    }),
    serverArtifact: nullableArtifact(value, 'server_'),
    createdAtMs: numberFromSql(value.created_at_ms, 'widget revision created timestamp'),
  };
}

export function fnWidgetControlStoreResourceCeiling(
  requirement: TResourceRequirement,
): Readonly<{ allowRead: boolean; allowWrite: boolean }> {
  const effect: TResourceEffect = requirement.effect;
  return {
    allowRead: effect === 'read' || effect === 'read_write',
    allowWrite: effect === 'write' || effect === 'read_write',
  };
}
