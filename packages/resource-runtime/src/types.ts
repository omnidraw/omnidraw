/**
 * @file Actor-independent resource catalog, capability, data, and lifecycle types.
 */

import type {
  TCellId,
  TOrganizationId,
  TPlacementEpoch,
} from '@vibecanvas/tenant-core';

export type TResourceId = string;
export type TResourceSlot = string;
export type TResourceKind = 'kv' | 'secretStore' | 'db';
export type TResourceStatus =
  | 'created'
  | 'provisioning'
  | 'ready'
  | 'migrating'
  | 'error'
  | 'deleting';
export type TResourcePlacementStatus = 'reserved' | 'active' | 'moving' | 'error';
export type TResourceEffect = 'read' | 'write' | 'read_write';
export type TResourcePermission = Exclude<TResourceEffect, 'read_write'>;
export type TResourceOperationName = string;
export type TResourceOperationId = string;

export type TResourceErrorCode =
  | 'RESOURCE_DEFINITION_NOT_FOUND'
  | 'RESOURCE_SLOT_UNKNOWN'
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_NAME_INVALID'
  | 'RESOURCE_NAME_CONFLICT'
  | 'RESOURCE_NAME_AMBIGUOUS'
  | 'RESOURCE_NOT_BOUND'
  | 'RESOURCE_KIND_MISMATCH'
  | 'RESOURCE_SCOPE_INVALID'
  | 'RESOURCE_BINDING_CONFLICT'
  | 'RESOURCE_STILL_BOUND'
  | 'RESOURCE_NOT_READY'
  | 'RESOURCE_UNAVAILABLE'
  | 'RESOURCE_MIGRATING'
  | 'RESOURCE_READ_NOT_ALLOWED'
  | 'RESOURCE_WRITE_NOT_ALLOWED'
  | 'RESOURCE_CALL_INVALID'
  | 'RESOURCE_CALL_CANCELLED'
  | 'RESOURCE_PROVIDER_UNAVAILABLE'
  | 'RESOURCE_PLACEMENT_NOT_FOUND'
  | 'RESOURCE_PLACEMENT_STALE'
  | 'RESOURCE_OWNER_CONFLICT'
  | 'RESOURCE_LIFECYCLE_CONFLICT'
  | 'RESOURCE_DRAIN_TIMEOUT'
  | 'RESOURCE_WRITE_CAPABILITY_INVALID'
  | 'RESOURCE_WRITE_CAPABILITY_EXPIRED'
  | 'RESOURCE_WRITE_CAPABILITY_STALE'
  | 'KV_RESOURCE_NOT_BOUND'
  | 'KV_RESOURCE_UNAVAILABLE'
  | 'KV_KEY_INVALID'
  | 'KV_VALUE_INVALID'
  | 'KV_ENTRY_CONFLICT'
  | 'KV_LIST_LIMIT_EXCEEDED'
  | 'KV_WRITE_NOT_ALLOWED'
  | 'KV_OPERATION_FAILED'
  | 'SECRET_STORE_NOT_BOUND'
  | 'SECRET_STORE_UNAVAILABLE'
  | 'SECRET_STORE_KEY_UNAVAILABLE'
  | 'SECRET_STORE_DECRYPTION_FAILED'
  | 'SECRET_NAME_INVALID'
  | 'SECRET_VALUE_INVALID'
  | 'SECRET_NOT_FOUND'
  | 'SECRET_CONFLICT'
  | 'SECRET_WRITE_NOT_ALLOWED'
  | 'SECRET_OPERATION_FAILED'
  | 'DB_RESOURCE_NOT_BOUND'
  | 'DB_RESOURCE_UNAVAILABLE'
  | 'DB_RESOURCE_MIGRATING'
  | 'DB_RESOURCE_RECOVERY_FAILED'
  | 'DB_RESOURCE_DRAFT_EXISTS'
  | 'DB_RESOURCE_DRAFT_NOT_FOUND'
  | 'DB_RESOURCE_DRAFT_INVALID'
  | 'DB_RESOURCE_APPLY_IN_PROGRESS'
  | 'DB_RESOURCE_APPLY_FAILED'
  | 'DB_RESOURCE_APPLY_RECOVERED'
  | 'DB_RESOURCE_BACKUP_NOT_FOUND'
  | 'DB_RESOURCE_BACKUP_INTEGRITY_FAILED'
  | 'DB_RESOURCE_RESTORE_FAILED'
  | 'DB_RESOURCE_ROW_IDENTITY_REQUIRED'
  | 'DB_RESOURCE_ROW_CONFLICT'
  | 'DB_RESOURCE_ROW_TOO_LARGE'
  | 'DB_RESOURCE_TABLE_READ_ONLY'
  | 'DB_RESOURCE_SCHEMA_OPERATION_INVALID'
  | 'DB_NAMED_OPERATION_UNKNOWN'
  | 'DB_OPERATION_PARAMETERS_INVALID'
  | 'DB_READ_NOT_ALLOWED'
  | 'DB_WRITE_NOT_ALLOWED'
  | 'DB_ARBITRARY_SQL_NOT_ALLOWED'
  | 'DB_LIVE_SQL_APPROVAL_REQUIRED'
  | 'DB_QUERY_FAILED'
  | 'DB_EXECUTE_FAILED'
  | 'DB_RESULT_LIMIT_EXCEEDED'
  | 'DB_BUSY'
  | 'DB_RESOURCE_DELETE_FAILED';

export type TSafeResourceError = Readonly<{
  code: TResourceErrorCode;
  message: string;
  details?: Readonly<Record<string, unknown>>;
}>;

export type TResourceDescriptor = Readonly<{
  orgId: TOrganizationId;
  id: TResourceId;
  kind: TResourceKind;
  name: string;
  status: TResourceStatus;
  lastError: TSafeResourceError | null;
  createdAtMs: number;
  updatedAtMs: number;
}>;

/** A storage key is meaningful only to a Resource Store adapter and is never a host path. */
export type TResourceStorageKey = string;

export type TResourcePlacement = Readonly<{
  orgId: TOrganizationId;
  resourceId: TResourceId;
  cellId: TCellId;
  placementEpoch: TPlacementEpoch;
  storageKey: TResourceStorageKey;
  status: TResourcePlacementStatus;
  createdAtMs: number;
  updatedAtMs: number;
}>;

export type TResourceReference = Readonly<{
  resourceId: TResourceId;
  kind: TResourceKind;
}>;

export type TResourceRequirement = Readonly<{
  slot: TResourceSlot;
  kind: TResourceKind;
  effect: TResourceEffect;
  required?: boolean;
  /** Host-declared escape hatch for trusted compatibility definitions only. */
  arbitrarySql?: boolean;
  /** Host-derived named operations. Callers may select a name, but never supply SQL. */
  operations?: Readonly<Record<string, TResourceNamedOperation>>;
}>;

export type TResourceOperationParameterType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'bigint'
  | 'bytes'
  | 'json';

export type TResourceOperationParameterDeclaration = Readonly<{
  type: TResourceOperationParameterType;
  required?: boolean;
  nullable?: boolean;
}>;

export type TResourceNamedOperation = Readonly<{
  effect: TResourcePermission;
  sql: string;
  parameters?: Readonly<Record<string, TResourceOperationParameterDeclaration>>;
  result: 'rows' | 'execute';
}>;

export type TResourceBinding = Readonly<{
  slot: TResourceSlot;
  resourceId: TResourceId;
  kind: TResourceKind;
  allowRead: boolean;
  allowWrite: boolean;
  definitionId?: string;
  revisionId?: string;
  required?: boolean;
}>;

export type TResourceBindingReference = Readonly<{
  definitionId: string;
  revisionId: string;
  slot: TResourceSlot;
  resourceId: TResourceId;
  kind: TResourceKind;
  required: boolean;
  manifestAllowRead: boolean;
  manifestAllowWrite: boolean;
  allowRead: boolean;
  allowWrite: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}>;

export type TResourceBindingDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{
    allowed: false;
    reason: 'slot_mismatch' | 'kind_mismatch' | 'requirement_denied' | 'binding_denied';
  }>;

type TResourceReadCall = Readonly<{
  slot: TResourceSlot;
  kind?: TResourceKind;
  operation: TResourceOperationName;
  operationId?: TResourceOperationId;
  effect: 'read';
  input: unknown;
}>;

type TResourceWriteCall = Readonly<{
  slot: TResourceSlot;
  kind?: TResourceKind;
  operation: TResourceOperationName;
  operationId?: TResourceOperationId;
  effect: 'write';
  input: unknown;
  /** Required by fenced stores; optional only for explicit legacy/local compatibility. */
  writeCapability?: string;
}>;

/** A caller-selected logical slot; concrete resource identity is resolved by the gateway. */
export type TResourceCall = TResourceReadCall | TResourceWriteCall;

/** A gateway-resolved call. This still contains no path, handle, native config, or key material. */
export type TResolvedResourceCall = Readonly<{
  slot: TResourceSlot;
  resourceId: TResourceId;
  kind: TResourceKind;
  /** Authorization snapshot resolved from the host-owned manifest/revision. */
  requirement: TResourceRequirement;
  operation: TResourceOperationName;
  operationId?: TResourceOperationId;
  effect: TResourcePermission;
  input: unknown;
  writeCapability?: string;
}>;

export type TResourceOperationReceipt = Readonly<{
  operationId: TResourceOperationId;
  resourceId: TResourceId;
  effect: TResourcePermission;
  committed: boolean;
}>;

export type TResourceCallResult<TOutput = unknown> = Readonly<{
  output: TOutput;
  receipt?: TResourceOperationReceipt;
}>;

export type TResourceWriteCapabilityClaims = Readonly<{
  orgId: TOrganizationId;
  resourceId: TResourceId;
  operation: TResourceOperationName;
  attemptId: string;
  leaseEpoch: number;
  expiresAtMs: number;
  nonce: string;
}>;

export type TResourceProviderCreateArgs = Readonly<Record<string, never>>;

export type TResourceReconciliation = Readonly<{
  status: Extract<TResourceStatus, 'ready' | 'error'>;
  lastError?: TSafeResourceError | null;
}>;

export type TResourceUse = Readonly<{
  id: string;
  kind: string;
  state: 'active' | 'draining' | 'stopped';
  label?: string;
}>;

export type TResourceUseInspection = Readonly<{
  resourceId: TResourceId;
  uses: readonly TResourceUse[];
}>;

export type TResourceDrainRequest = Readonly<{
  resourceId: TResourceId;
  reason: 'schema_apply' | 'restore' | 'delete' | 'move' | 'shutdown';
  timeoutMs: number;
}>;

export type TResourceDrainLease = Readonly<{
  resourceId: TResourceId;
  leaseId: string;
  leaseEpoch: number;
  expiresAtMs: number;
  drainedUses: readonly TResourceUse[];
}>;

export type TResourceDrainResult =
  | Readonly<{ ok: true; lease: TResourceDrainLease }>
  | Readonly<{ ok: false; code: 'RESOURCE_DRAIN_TIMEOUT'; inspection: TResourceUseInspection }>;

export type TResourceReleaseMode = 'resume' | 'hold';

export type TResourceReleaseResult = Readonly<{
  resourceId: TResourceId;
  released: boolean;
  mode: TResourceReleaseMode;
  resumedUseIds: readonly string[];
}>;

export type TResourceJson =
  | string
  | number
  | boolean
  | null
  | readonly TResourceJson[]
  | Readonly<{ [key: string]: TResourceJson | undefined }>;

export type TKeyValueEntry = Readonly<{
  key: string;
  value: TResourceJson;
  revision: number;
  createdAtMs: number;
  updatedAtMs: number;
}>;

export type TKeyValueEntryMetadata = Omit<TKeyValueEntry, 'value'>;

export type TKeyValueEntryPreview = TKeyValueEntryMetadata & Readonly<{
  valuePreview: string;
  valueTruncated: boolean;
}>;

export type TSecretEntryMetadata = Readonly<{
  name: string;
  revision: number;
  createdAtMs: number;
  updatedAtMs: number;
}>;

/** Plaintext secret DTO; only IHumanResourceSecretService may return this type. */
export type TSecretReveal = Readonly<{
  kind: 'secretStore';
  name: string;
  value: string;
  revision: number;
}>;

export type TResourceDataPage =
  | Readonly<{
    kind: 'kv';
    entries: readonly TKeyValueEntryPreview[];
    nextCursor: string | null;
  }>
  | Readonly<{
    kind: 'secretStore';
    entries: readonly TSecretEntryMetadata[];
    nextCursor: string | null;
  }>;

export type TResourceDataMutationResult =
  | Readonly<{ kind: 'kv'; entry: TKeyValueEntryPreview }>
  | Readonly<{ kind: 'secretStore'; entry: TSecretEntryMetadata }>;

export type TResourceDataListRequest = Readonly<{
  resourceId: TResourceId;
  prefix?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}>;

export type TResourceDataSetRequest = Readonly<{
  resourceId: TResourceId;
  key: string;
  expectedRevision: number | null;
  value: TResourceJson;
}>;

export type TResourceDataDeleteRequest = Readonly<{
  resourceId: TResourceId;
  key: string;
  expectedRevision: number;
}>;

export type TDbIntegerCellValue = Readonly<{ type: 'integer'; value: string }>;

export type TDbCellValue =
  | Readonly<{ type: 'null' }>
  | TDbIntegerCellValue
  | Readonly<{ type: 'real'; value: number }>
  | Readonly<{ type: 'text'; value: string }>
  | Readonly<{ type: 'blob'; base64: string }>;

export type TDbBlobPreviewCellValue = Readonly<{
  type: 'blobPreview';
  byteLength: number;
  previewBase64: string;
  truncated: boolean;
}>;

export type TDbPreviewCellValue = Exclude<TDbCellValue, { readonly type: 'blob' }>
  | TDbBlobPreviewCellValue;

export type TDbRowIdentity =
  | Readonly<{ kind: 'primaryKey'; values: Readonly<Record<string, TDbCellValue>> }>
  | Readonly<{ kind: 'rowid'; value: TDbIntegerCellValue }>;

export type TDbColumn = Readonly<{
  name: string;
  declaredType: string;
  nullable: boolean;
  defaultSql: string | null;
  primaryKeyOrder: number | null;
  hidden: boolean;
}>;

export type TDbIndex = Readonly<{
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: readonly Readonly<{ name: string | null; sequence: number }>[];
  createSql: string | null;
}>;

export type TDbForeignKey = Readonly<{
  id: number;
  columns: readonly string[];
  referencedTable: string;
  referencedColumns: readonly (string | null)[];
  onUpdate: string;
  onDelete: string;
  match: string;
}>;

export type TDbTrigger = Readonly<{ name: string; createSql: string }>;

export type TDbObject = Readonly<{
  name: string;
  kind: 'table' | 'view';
  columns: readonly TDbColumn[];
  indexes: readonly TDbIndex[];
  foreignKeys: readonly TDbForeignKey[];
  triggers: readonly TDbTrigger[];
  createSql: string | null;
  identity: Readonly<{ kind: 'primaryKey'; columns: readonly string[] }>
    | Readonly<{ kind: 'rowid' }>
    | null;
  editable: boolean;
  readOnlyReason: string | null;
}>;

export type TDbInspection = Readonly<{
  resourceId: TResourceId;
  target: 'live' | 'draft';
  draftId: string | null;
  objects: readonly TDbObject[];
}>;

export type TDbRow = Readonly<{
  identity: TDbRowIdentity | null;
  values: Readonly<Record<string, TDbCellValue>>;
}>;

export type TDbRowPreview = Readonly<{
  identity: TDbRowIdentity | null;
  values: Readonly<Record<string, TDbPreviewCellValue>>;
}>;

export type TDbRowsPage = Readonly<{
  object: TDbObject;
  rows: readonly TDbRowPreview[];
  hasMore: boolean;
  nextCursor: TDbRowIdentity | null;
}>;

export type TDbLiveSqlResult =
  | Readonly<{
    kind: 'rows';
    columns: readonly string[];
    rows: readonly Readonly<Record<string, TDbPreviewCellValue>>[];
    rowCount: number;
    rowsAffected: number;
    truncated: boolean;
  }>
  | Readonly<{
    kind: 'execute';
    rowsAffected: number;
    lastInsertRowId: TDbCellValue | null;
  }>;

export type TDbRowCreate = Readonly<{
  kind: 'create';
  values: Readonly<Record<string, TDbCellValue>>;
}>;

export type TDbRowUpdate = Readonly<{
  kind: 'update';
  identity: TDbRowIdentity;
  values: Readonly<Record<string, TDbCellValue>>;
  expectedOriginal: Readonly<Record<string, TDbCellValue>>;
}>;

export type TDbRowDelete = Readonly<{
  kind: 'delete';
  identity: TDbRowIdentity;
  expectedOriginal: Readonly<Record<string, TDbCellValue>>;
}>;

export type TDbRowMutation = TDbRowCreate | TDbRowUpdate | TDbRowDelete;

export type TDbRowMutationResult = Readonly<{
  rowsAffected: number;
  lastInsertRowId?: TDbCellValue | null;
}>;

export type TDbColumnDefinition = Readonly<{
  name: string;
  declaredType?: string;
  nullable?: boolean;
  defaultSql?: string | null;
  primaryKeyOrder?: number | null;
}>;

export type TDbDraftOperation =
  | Readonly<{ kind: 'createTable'; table: string; columns: readonly TDbColumnDefinition[]; strict?: boolean; withoutRowid?: boolean }>
  | Readonly<{ kind: 'renameTable'; table: string; newName: string }>
  | Readonly<{ kind: 'dropTable'; table: string }>
  | Readonly<{ kind: 'addColumn'; table: string; column: TDbColumnDefinition }>
  | Readonly<{ kind: 'renameColumn'; table: string; column: string; newName: string }>
  | Readonly<{ kind: 'alterColumn'; table: string; column: string; definition: TDbColumnDefinition }>
  | Readonly<{ kind: 'dropColumn'; table: string; column: string }>
  | Readonly<{ kind: 'createIndex'; table: string; name: string; columns: readonly string[]; unique?: boolean }>
  | Readonly<{ kind: 'dropIndex'; name: string }>
  | Readonly<{ kind: 'createForeignKey'; table: string; columns: readonly string[]; referencedTable: string; referencedColumns: readonly string[]; onUpdate?: string; onDelete?: string }>
  | Readonly<{ kind: 'dropForeignKey'; table: string; id: number }>;

export type TDbResourceDraftStatus = 'editing' | 'applying' | 'applied' | 'discarded' | 'error';
export type TDbResourceDraftChangeKind = 'structure' | 'sql';
export type TDbResourceApplyStatus =
  | 'preparing'
  | 'stopping'
  | 'applying'
  | 'restarting'
  | 'succeeded'
  | 'failed'
  | 'recovered';
export type TDbResourceBackupState = 'retained' | 'deleting' | 'deleted';

export type TDbResourceDraft = Readonly<{
  orgId: TOrganizationId;
  id: string;
  resourceId: TResourceId;
  name: string;
  status: TDbResourceDraftStatus;
  lastError: TSafeResourceError | null;
  createdAtMs: number;
  updatedAtMs: number;
  appliedAtMs: number | null;
}>;

export type TDbResourceDraftChange = Readonly<{
  orgId: TOrganizationId;
  draftId: string;
  sequence: number;
  kind: TDbResourceDraftChangeKind;
  operation: TDbDraftOperation | Readonly<{ type: 'boundSql'; parameters: readonly TDbCellValue[] }> | null;
  sql: string;
  createdAtMs: number;
}>;

export type TDbResourceApplyRun = Readonly<{
  orgId: TOrganizationId;
  id: string;
  resourceId: TResourceId;
  draftId: string | null;
  sourceApplyId: string | null;
  status: TDbResourceApplyStatus;
  lastError: TSafeResourceError | null;
  backupRetained: boolean;
  createdAtMs: number;
  completedAtMs: number | null;
}>;

export type TDbResourceBackup = Readonly<{
  orgId: TOrganizationId;
  id: string;
  resourceId: TResourceId;
  applyRunId: string;
  storageKey: TResourceStorageKey;
  digestSha256: string;
  byteSize: number;
  state: TDbResourceBackupState;
  createdAtMs: number;
  verifiedAtMs: number;
  deleteAfterMs: number | null;
}>;

export type TDbDraftDetails = Readonly<{
  draft: TDbResourceDraft;
  changes: readonly TDbResourceDraftChange[];
}>;

export type TDbResourceImpact = Readonly<{
  resource: TResourceDescriptor;
  bindings: readonly TResourceBindingReference[];
  uses: TResourceUseInspection;
}>;

export type TDbApplyPreview = TDbDraftDetails & Readonly<{
  resource: TResourceDescriptor;
  impact: TDbResourceImpact;
  warnings: readonly string[];
}>;

export type TDbApplyDetails = Readonly<{
  apply: TDbResourceApplyRun;
  drain: TResourceDrainLease | null;
}>;

export type TResourceListFilter = Readonly<{
  kind?: TResourceKind;
  status?: TResourceStatus;
}>;

export type TCreateResourceRequest = Readonly<{
  id: TResourceId;
  kind: TResourceKind;
  name: string;
  cellId: TCellId;
  placementEpoch: TPlacementEpoch;
  storageKey: TResourceStorageKey;
  nowMs: number;
}>;

export type TUpdateResourceStateRequest = Readonly<{
  resourceId: TResourceId;
  expectedStatus: TResourceStatus | readonly TResourceStatus[];
  status: TResourceStatus;
  lastError: TSafeResourceError | null;
  nowMs: number;
}>;

export type TReserveResourcePlacementRequest = Readonly<{
  resourceId: TResourceId;
  cellId: TCellId;
  placementEpoch: TPlacementEpoch;
  storageKey: TResourceStorageKey;
  nowMs: number;
}>;

export type TUpdateResourcePlacementRequest = Readonly<{
  resourceId: TResourceId;
  expectedEpoch: TPlacementEpoch;
  placementEpoch: TPlacementEpoch;
  cellId: TCellId;
  status: TResourcePlacementStatus;
  storageKey: TResourceStorageKey;
  nowMs: number;
}>;
