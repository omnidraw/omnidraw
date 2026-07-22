import type {
  TApiError,
  TDbCellValue,
  TDbColumn,
  TDbDraft,
  TDbDraftChange,
  TDbForeignKey,
  TDbImpact,
  TDbIndex,
  TDbImpactSlot,
  TDbInspection,
  TDbResourceUse,
  TDbObject,
  TDbPreviewCellValue,
  TDbSqlResult,
} from "./types";

export const fnInspectionObjects = (inspection: TDbInspection | null | undefined): TDbObject[] =>
  inspection?.objects ?? [];

export const fnInspectionTables = (inspection: TDbInspection | null | undefined): TDbObject[] =>
  fnInspectionObjects(inspection).filter((object) => object.kind === "table");

export const fnActiveDraft = (drafts: TDbDraft[]): TDbDraft | null =>
  drafts.find((draft) => draft.status === "editing" || draft.status === "applying") ?? null;

export const fnImpactSlots = (impact: TDbImpact | null | undefined): TDbImpactSlot[] =>
  (impact?.bindings ?? []).map((binding) => ({
    definitionId: binding.definitionId,
    revisionId: binding.revisionId,
    slot: binding.slot,
    scope: [
      ...(binding.allowRead ? ["read" as const] : []),
      ...(binding.allowWrite ? ["write" as const] : []),
    ],
  }));

export const fnImpactUses = (impact: TDbImpact | null | undefined): TDbResourceUse[] =>
  impact?.uses.uses ?? [];

export const fnCellText = (cell: TDbPreviewCellValue | undefined): string => {
  if (!cell || cell.type === "null") return "NULL";
  if (cell.type === "blobPreview") {
    const preview = cell.previewBase64 ? ` · ${cell.previewBase64}${cell.truncated ? "…" : ""}` : "";
    return `BLOB · ${cell.byteLength} bytes${preview}`;
  }
  if (cell.type === "blob") {
    const padding = cell.base64.endsWith("==") ? 2 : cell.base64.endsWith("=") ? 1 : 0;
    return `BLOB · ${Math.max(0, Math.floor(cell.base64.length * 3 / 4) - padding)} bytes`;
  }
  return String(cell.value);
};

export const fnCellEditorText = (cell: TDbCellValue | undefined): string => {
  if (!cell || cell.type === "null") return "";
  if (cell.type === "blob") return cell.base64;
  return String(cell.value);
};

export const fnInputCell = (value: string, column: TDbColumn): TDbCellValue => {
  const declaredType = column.declaredType.toUpperCase();
  if (value === "" && column.nullable) return { type: "null" };
  if (declaredType.includes("INT")) return { type: "integer", value };
  if (["REAL", "FLOA", "DOUB"].some((part) => declaredType.includes(part))) {
    const parsed = Number(value);
    return { type: "real", value: parsed };
  }
  if (declaredType.includes("BLOB")) return { type: "blob", base64: value };
  return { type: "text", value };
};

export const fnCellInputError = (value: string, column: TDbColumn): string | null => {
  const declaredType = column.declaredType.toUpperCase();
  if (value === "" && column.nullable) return null;
  if (declaredType.includes("INT")) {
    if (!/^-?(?:0|[1-9]\d*)$/.test(value)) return `${column.name} requires an integer.`;
    const negative = value.startsWith("-");
    const digits = negative ? value.slice(1) : value;
    const limit = negative ? "9223372036854775808" : "9223372036854775807";
    if (digits.length > limit.length || (digits.length === limit.length && digits > limit)) return `${column.name} is outside SQLite's signed 64-bit integer range.`;
  }
  if (["REAL", "FLOA", "DOUB"].some((part) => declaredType.includes(part)) && !Number.isFinite(Number(value))) return `${column.name} requires a finite real number.`;
  if (declaredType.includes("BLOB") && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return `${column.name} requires base64 bytes.`;
  return null;
};

export const fnRowInputOmitted = (mode: "create" | "edit", value: string, column: TDbColumn): boolean =>
  mode === "create" && value === "" && (column.primaryKeyOrder !== null || column.defaultSql !== null);

export const fnIndexColumns = (index: TDbIndex): string =>
  index.columns.map((column) => column.name ?? "expression").join(", ");

export const fnForeignKeySummary = (foreignKey: TDbForeignKey): string => {
  return `${foreignKey.columns.join(", ")} → ${foreignKey.referencedTable}(${foreignKey.referencedColumns.map((column) => column ?? "?").join(", ")})`;
};

export const fnChangeSummary = (change: TDbDraftChange): string => {
  const operation = change.operation;
  if (!operation) return change.kind === "sql" ? "Advanced SQL" : "Structure change";
  const kind = typeof operation === "object" && "kind" in operation && typeof operation.kind === "string" ? operation.kind : "Structure change";
  return kind.replace(/([a-z])([A-Z])/g, "$1 $2");
};

export const fnStatusLabel = (status: string): string =>
  (status === "migrating" ? "applying" : status).replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();

export const fnTimestamp = (value: string | null | undefined): string => {
  if (!value) return "—";
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
};

export const fnApplyTerminal = (status: string): boolean => ["succeeded", "failed", "recovered"].includes(status);
export const fnRestoreTerminal = (status: string): boolean => ["succeeded", "failed", "recovered"].includes(status);

export const fnApiErrorCode = (error: TApiError): string => {
  return error.data?.code ?? "";
};

export const fnLiveSqlApprovalRequired = (error: TApiError): boolean =>
  fnApiErrorCode(error) === "DB_LIVE_SQL_APPROVAL_REQUIRED";

export const fnWorkbenchTabLabel = (tab: "overview" | "schema" | "data" | "sql"): string => ({
  overview: "Overview",
  schema: "Schema",
  data: "Data",
  sql: "SQL",
})[tab];

export const fnSqlResultSummary = (result: TDbSqlResult | null | undefined): string => {
  if (!result) return "Not run";
  return result.kind === "rows"
    ? `${result.rowCount} returned · ${result.rowsAffected} affected`
    : `${result.rowsAffected} affected`;
};

export const fnSqlResultColumns = (result: TDbSqlResult | null | undefined): string[] =>
  result?.kind === "rows" ? result.columns : [];

export type TBoundedPage<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  pageCount: number;
  firstRow: number;
  lastRow: number;
};

export const fnBatches = <T>(values: T[], requestedBatchSize: number): T[][] => {
  const batchSize = Math.max(1, Math.min(16, Math.floor(requestedBatchSize) || 1));
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += batchSize) batches.push(values.slice(index, index + batchSize));
  return batches;
};

export const fnBoundedPage = <T>(rows: T[], requestedPage: number, requestedPageSize = 50): TBoundedPage<T> => {
  const pageSize = Math.max(1, Math.min(100, Math.floor(requestedPageSize) || 50));
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.max(1, Math.min(pageCount, Math.floor(requestedPage) || 1));
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  return {
    rows: pageRows,
    page,
    pageSize,
    pageCount,
    firstRow: pageRows.length ? start + 1 : 0,
    lastRow: start + pageRows.length,
  };
};
