import { describe, expect, test } from "vitest";
import {
  fnActiveDraft,
  fnApiErrorCode,
  fnBatches,
  fnBoundedPage,
  fnCellInputError,
  fnCellText,
  fnImpactUses,
  fnInspectionTables,
  fnInputCell,
  fnLiveSqlApprovalRequired,
  fnRowInputOmitted,
  fnSqlResultColumns,
  fnSqlResultSummary,
  fnStatusLabel,
  fnWorkbenchTabLabel,
} from "./fn.db-resource";
import type { TDbColumn, TDbImpact, TDbSqlResult } from "./types";

const column = (value: Pick<TDbColumn, "name" | "declaredType" | "nullable">): TDbColumn => ({
  ...value,
  defaultSql: null,
  primaryKeyOrder: null,
  hidden: false,
});

describe("database resource workbench functions", () => {
  test("keeps integers and blobs lossless", () => {
    const integer = fnInputCell("9223372036854775807", column({ name: "id", declaredType: "INTEGER", nullable: false }));
    const blob = fnInputCell("AP8Q", column({ name: "payload", declaredType: "BLOB", nullable: false }));

    expect(integer).toEqual({ type: "integer", value: "9223372036854775807" });
    expect(blob).toEqual({ type: "blob", base64: "AP8Q" });
    expect(fnCellText(integer)).toBe("9223372036854775807");
    expect(fnCellText(blob)).toBe("BLOB · 3 bytes");
  });

  test("validates typed row input before sending it", () => {
    expect(fnCellInputError("12x", column({ name: "id", declaredType: "INTEGER", nullable: false }))).toBe("id requires an integer.");
    expect(fnCellInputError("+12", column({ name: "id", declaredType: "INTEGER", nullable: false }))).toBe("id requires an integer.");
    expect(fnCellInputError("9223372036854775808", column({ name: "id", declaredType: "INTEGER", nullable: false }))).toBe("id is outside SQLite's signed 64-bit integer range.");
    expect(fnCellInputError("-9223372036854775808", column({ name: "id", declaredType: "INTEGER", nullable: false }))).toBeNull();
    expect(fnCellInputError("Infinity", column({ name: "score", declaredType: "REAL", nullable: false }))).toBe("score requires a finite real number.");
    expect(fnCellInputError("not base64", column({ name: "payload", declaredType: "BLOB", nullable: false }))).toBe("payload requires base64 bytes.");
    expect(fnCellInputError("", column({ name: "note", declaredType: "TEXT", nullable: true }))).toBeNull();
  });

  test("omits generated create fields without changing nullable or edit semantics", () => {
    expect(fnRowInputOmitted("create", "", { ...column({ name: "id", declaredType: "INTEGER", nullable: false }), primaryKeyOrder: 1 })).toBe(true);
    expect(fnRowInputOmitted("create", "", { ...column({ name: "created", declaredType: "TEXT", nullable: false }), defaultSql: "CURRENT_TIMESTAMP" })).toBe(true);
    expect(fnRowInputOmitted("create", "", column({ name: "note", declaredType: "TEXT", nullable: true }))).toBe(false);
    expect(fnRowInputOmitted("edit", "", { ...column({ name: "id", declaredType: "INTEGER", nullable: false }), primaryKeyOrder: 1 })).toBe(false);
  });

  test("normalizes active resource uses", () => {
    const impact: TDbImpact = {
      resource: { id: "resource-1", kind: "db", name: "Notes DB", status: "ready", lastError: null, createdAtSec: "now", updatedAtSec: "now" },
      uses: { resourceId: "resource-1", uses: [{ id: "invocation-1", kind: "function", state: "active" }] },
    };

    expect(fnImpactUses(impact)).toEqual(impact.uses.uses);
  });

  test("selects only editing or applying drafts and uses applying UI wording", () => {
    const draft = { id: "draft-1", resourceId: "resource-1", name: "Structure draft", status: "editing" as const, lastError: null, createdAtSec: "now", updatedAtSec: "now", appliedAtSec: null };
    expect(fnActiveDraft([draft])?.id).toBe("draft-1");
    expect(fnStatusLabel("migrating")).toBe("applying");
    expect(fnStatusLabel("startFailed")).toBe("start failed");
  });

  test("reads stable management error codes from the API envelope", () => {
    const error = Object.assign(new Error("Resource operation failed."), { data: { code: "DB_RESOURCE_ROW_CONFLICT" } });
    expect(fnApiErrorCode(error)).toBe("DB_RESOURCE_ROW_CONFLICT");
  });

  test("uses schema and table terminology in the workbench", () => {
    expect(fnWorkbenchTabLabel("schema")).toBe("Schema");
    expect(fnWorkbenchTabLabel("sql")).toBe("SQL");
    const baseObject = { columns: [], indexes: [], foreignKeys: [], triggers: [], createSql: null, identity: null, editable: false, readOnlyReason: null };
    expect(fnInspectionTables({
      resourceId: "resource-1",
      target: "live",
      draftId: null,
      objects: [
        { ...baseObject, name: "notes", kind: "table" },
        { ...baseObject, name: "notes_view", kind: "view" },
      ],
    }).map((object) => object.name)).toEqual(["notes"]);
  });

  test("renders bounded BLOB previews without requiring the full payload", () => {
    expect(fnCellText({
      type: "blobPreview",
      byteLength: 8_388_608,
      previewBase64: "AP8Q",
      truncated: true,
    })).toBe("BLOB · 8388608 bytes · AP8Q…");
    expect(fnCellText({
      type: "blobPreview",
      byteLength: 3,
      previewBase64: "AP8Q",
      truncated: false,
    })).toBe("BLOB · 3 bytes · AP8Q");
  });

  test("summarizes and exposes live SQL result-set columns", () => {
    const rows: TDbSqlResult = {
      kind: "rows",
      columns: ["id", "title"],
      rows: [{ id: { type: "integer", value: "1" }, title: { type: "text", value: "First" } }],
      rowCount: 1,
      rowsAffected: 0,
      truncated: false,
    };
    expect(fnSqlResultColumns(rows)).toEqual(["id", "title"]);
    expect(fnSqlResultSummary(rows)).toBe("1 returned · 0 affected");
    expect(fnSqlResultSummary({ kind: "execute", rowsAffected: 2, lastInsertRowId: null })).toBe("2 affected");
    expect(fnSqlResultColumns({ kind: "execute", rowsAffected: 2, lastInsertRowId: null })).toEqual([]);
  });

  test("recognizes the typed mutation approval challenge", () => {
    const error = Object.assign(new Error("Approval required."), { data: { code: "DB_LIVE_SQL_APPROVAL_REQUIRED" } });
    expect(fnLiveSqlApprovalRequired(error)).toBe(true);
    expect(fnLiveSqlApprovalRequired(Object.assign(new Error("Other"), { data: { code: "OTHER" } }))).toBe(false);
  });

  test("renders at most 50 result rows and clamps pagination state", () => {
    const manyRows = Array.from({ length: 10_001 }, (_, index) => index);
    const middle = fnBoundedPage(manyRows, 100, 50);
    expect(middle.rows).toHaveLength(50);
    expect(middle.rows[0]).toBe(4_950);
    expect(middle.firstRow).toBe(4_951);
    expect(middle.lastRow).toBe(5_000);

    const last = fnBoundedPage(manyRows, 999_999, 5_000);
    expect(last.pageSize).toBe(100);
    expect(last.page).toBe(101);
    expect(last.rows).toEqual([10_000]);
  });

  test("bounds bulk hydration batches to four rows", () => {
    const batches = fnBatches(Array.from({ length: 50 }, (_, index) => index), 4);
    expect(batches).toHaveLength(13);
    expect(batches.every((batch) => batch.length <= 4)).toBe(true);
    expect(batches.flat()).toEqual(Array.from({ length: 50 }, (_, index) => index));
  });
});
