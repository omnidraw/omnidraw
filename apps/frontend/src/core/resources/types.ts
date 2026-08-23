export type TResource = {
  id: string;
  kind: "kv" | "secretStore" | "db";
  name: string;
  status: "created" | "provisioning" | "ready" | "migrating" | "error" | "deleting";
  lastError: unknown | null;
  createdAtSec: string;
  updatedAtSec: string;
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
export type TDbResourceUse = { id: string; kind: string; state: "active" | "draining" | "stopped"; label?: string };
export type TDbImpact = { resource: TResource; uses: { resourceId: string; uses: TDbResourceUse[] } };

export type TDbDraftChange = {
  draftId: string;
  sequence: number;
  kind: "structure" | "sql";
  operation: unknown | null;
  sql: string;
  createdAtSec: string;
};

export type TDbDraft = {
  id: string;
  resourceId: string;
  name: string;
  status: "editing" | "applying" | "applied" | "discarded" | "error";
  lastError: unknown | null;
  createdAtSec: string;
  updatedAtSec: string;
  appliedAtSec: string | null;
};

export type TDbDraftDetails = { draft: TDbDraft; changes: TDbDraftChange[] };

export type TDbApplyRun = {
  id: string;
  resourceId: string;
  draftId: string | null;
  sourceApplyId: string | null;
  status: "preparing" | "applying" | "succeeded" | "failed" | "recovered";
  lastError: unknown | null;
  backupRetained: boolean;
  createdAtSec: string;
  completedAtSec: string | null;
};

export type TDbApplyDetails = { apply: TDbApplyRun; drain: null | { resourceId: string; leaseId: string; leaseEpoch: number; expiresAtMs: number; drainedUses: TDbResourceUse[] } };

export type TDbApplyPreview = TDbDraftDetails & {
  resource: TResource;
  impact: TDbImpact;
  warnings: string[];
};

export type TDbBackupMetadata = { resourceId: string; applyId: string; createdAtSec: string };
export type TDbBackup = TDbBackupMetadata | null;
export type TDbRestorePreview = {
  backup: TDbBackupMetadata;
  impact: TDbImpact;
  warning: string;
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
