export type TApiError = Error & { data?: { code: string; details?: unknown } };
export type TApiResult<T> = readonly [TApiError | null, T | undefined];
export type TApiCall<T> = Promise<TApiResult<T>>;

export type TResource = {
  id: string;
  kind: "kv" | "secretStore" | "db";
  name: string;
  status: "created" | "provisioning" | "ready" | "migrating" | "error" | "deleting";
  last_error: unknown | null;
  created_at: string;
  updated_at: string;
};

export type TDbCellValue =
  | { type: "null" }
  | { type: "integer"; value: string }
  | { type: "real"; value: number }
  | { type: "text"; value: string }
  | { type: "blob"; base64: string };

export type TDbBlobPreviewCellValue = {
  type: "blobPreview";
  byteLength: number;
  previewBase64: string;
  truncated: boolean;
};

export type TDbPreviewCellValue = TDbCellValue | TDbBlobPreviewCellValue;

export type TDbColumn = {
  name: string;
  declaredType: string;
  nullable: boolean;
  defaultSql: string | null;
  primaryKeyOrder: number | null;
  hidden: boolean;
};

export type TDbIndex = {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: Array<{ name: string | null; sequence: number }>;
  createSql: string | null;
};

export type TDbForeignKey = {
  id: number;
  columns: string[];
  referencedTable: string;
  referencedColumns: Array<string | null>;
  onUpdate: string;
  onDelete: string;
  match: string;
};

export type TDbTrigger = { name: string; createSql: string };

export type TDbObject = {
  name: string;
  kind: "table" | "view";
  columns: TDbColumn[];
  indexes: TDbIndex[];
  foreignKeys: TDbForeignKey[];
  triggers: TDbTrigger[];
  createSql: string | null;
  identity: { kind: "primaryKey"; columns: string[] } | { kind: "rowid" } | null;
  editable: boolean;
  readOnlyReason: string | null;
};

export type TDbInspection = {
  resourceId: string;
  target: "live" | "draft";
  draftId: string | null;
  objects: TDbObject[];
};

export type TDbScope = Array<"read" | "write">;
export type TDbDefinitionImpact = { definitionName: string; slots: Array<{ slot: string; scope: TDbScope }> };
export type TDbInstanceImpact = { instanceId: string; definitionName: string; status: string; running: boolean };
export type TDbImpact = { resource: TResource; definitions: TDbDefinitionImpact[]; instances: TDbInstanceImpact[] };
export type TDbImpactSlot = { definitionName: string; slot: string; scope: TDbScope };

export type TDbDraftChange = {
  draft_id: string;
  sequence: number;
  kind: "structure" | "sql";
  operation: unknown | null;
  sql: string;
  created_at: string;
};

export type TDbDraft = {
  id: string;
  resource_id: string;
  name: string;
  status: "editing" | "applying" | "applied" | "discarded" | "error";
  last_error: unknown | null;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
};

export type TDbDraftDetails = { draft: TDbDraft; changes: TDbDraftChange[] };

export type TDbApplyInstance = {
  apply_id: string;
  actor_instance_id: string;
  actor_definition_name: string;
  was_running: boolean;
  status: "notRunning" | "pendingStop" | "stopped" | "stopFailed" | "pendingRestart" | "restarted" | "startFailed" | "crashed";
  error: unknown | null;
  updated_at: string;
};

export type TDbApplyRun = {
  id: string;
  resource_id: string;
  draft_id: string | null;
  status: "preparing" | "stopping" | "applying" | "restarting" | "succeeded" | "failed" | "recovered";
  last_error: unknown | null;
  backup_retained: boolean;
  created_at: string;
  completed_at: string | null;
};

export type TDbApplyDetails = { apply: TDbApplyRun; instances: TDbApplyInstance[] };

export type TDbApplyPreview = TDbDraftDetails & {
  resource: TResource;
  impact: TDbImpact;
  warnings: string[];
  compatibilityNotice: string;
};

export type TDbBackupMetadata = { resourceId: string; applyId: string; createdAt: string };
export type TDbBackup = TDbBackupMetadata | null;
export type TDbRestorePreview = {
  backup: TDbBackupMetadata;
  impact: TDbImpact;
  warning: string;
  compatibilityNotice: string;
};

export type TDbRowIdentity =
  | { kind: "primaryKey"; values: Record<string, TDbCellValue> }
  | { kind: "rowid"; value: TDbCellValue };
export type TDbRow = { values: Record<string, TDbCellValue>; identity: TDbRowIdentity | null };
export type TDbRowPreview = { values: Record<string, TDbPreviewCellValue>; identity: TDbRowIdentity | null };
export type TDbRowPage = { object: TDbObject; rows: TDbRowPreview[]; hasMore: boolean; nextCursor: TDbRowIdentity | null };

export type TDbSqlRowsResult = {
  kind: "rows";
  columns: string[];
  rows: Array<Record<string, TDbPreviewCellValue>>;
  rowCount: number;
  rowsAffected: number;
  truncated: boolean;
};

export type TDbSqlExecuteResult = {
  kind: "execute";
  rowsAffected: number;
  lastInsertRowId: TDbCellValue | null;
};

export type TDbSqlResult = TDbSqlRowsResult | TDbSqlExecuteResult;

type TMethod<T> = (input: Record<string, unknown>) => TApiCall<T>;

export type TDbResourceApi = {
  resources: {
    get: TMethod<TResource>;
    rename: TMethod<TResource>;
    delete: TMethod<{ deleted: boolean }>;
  };
  dbResources: {
    impact: TMethod<TDbImpact>;
    inspect: TMethod<TDbInspection | null>;
    executeSql: TMethod<TDbSqlResult>;
  };
  dbRows: {
    list: TMethod<TDbRowPage>;
    get: TMethod<TDbRow>;
    create: TMethod<{ rowsAffected: number; lastInsertRowId: TDbCellValue | null }>;
    update: TMethod<{ rowsAffected: number }>;
    delete: TMethod<{ rowsAffected: number }>;
    bulk: TMethod<Array<{ rowsAffected: number }>>;
  };
  dbDrafts: {
    create: TMethod<TDbDraftDetails>;
    list: TMethod<TDbDraft[]>;
    get: TMethod<TDbDraftDetails>;
    active: TMethod<TDbDraftDetails | null>;
    inspect: TMethod<TDbInspection | null>;
    change: TMethod<TDbDraftChange>;
    executeSql: TMethod<TDbDraftChange>;
    discard: TMethod<TDbDraft>;
  };
  dbApplies: {
    preview: TMethod<TDbApplyPreview>;
    confirm: TMethod<TDbApplyRun>;
    get: TMethod<TDbApplyDetails>;
    list: TMethod<TDbApplyRun[]>;
  };
  dbBackups: {
    get: TMethod<TDbBackup>;
    discard: TMethod<{ discarded: boolean }>;
    previewRestore: TMethod<TDbRestorePreview>;
    restore: TMethod<TDbApplyRun>;
    restoreStatus: TMethod<TDbApplyDetails>;
  };
};

export type TDbApiPortal = { api: TDbResourceApi };
