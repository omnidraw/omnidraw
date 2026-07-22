import { Button } from "@kobalte/core/button";
import * as DropdownMenu from "@kobalte/core/dropdown-menu";
import * as Dialog from "@kobalte/core/dialog";
import * as Tabs from "@kobalte/core/tabs";
import * as TextField from "@kobalte/core/text-field";
import { useNavigate, useSearchParams } from "@solidjs/router";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Database from "lucide-solid/icons/database";
import MoreHorizontal from "lucide-solid/icons/more-horizontal";
import PanelLeft from "lucide-solid/icons/panel-left";
import Plus from "lucide-solid/icons/plus";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import Trash2 from "lucide-solid/icons/trash-2";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Component } from "solid-js";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";
import { catalogInvalidation } from "@/ai-chat-adapters";
import { orpcWebsocketService } from "@/services/orpc-websocket";
import { setStore } from "@/store";
import { ConfirmActionDialog } from "./components/ConfirmActionDialog";
import { CoordinatedOperationDialog } from "./components/CoordinatedOperationDialog";
import { LiveSqlApprovalDialog } from "./components/LiveSqlApprovalDialog";
import { RowEditorDialog } from "./components/RowEditorDialog";
import { ObjectInspector } from "./components/ObjectInspector";
import { StructureChangeDialog, type TStructureOperationKind } from "./components/StructureChangeDialog";
import {
  fnActiveDraft,
  fnApiErrorCode,
  fnApplyTerminal,
  fnBatches,
  fnBoundedPage,
  fnCellText,
  fnChangeSummary,
  fnImpactUses,
  fnImpactSlots,
  fnInspectionTables,
  fnLiveSqlApprovalRequired,
  fnRestoreTerminal,
  fnSqlResultColumns,
  fnSqlResultSummary,
  fnStatusLabel,
  fnTimestamp,
  fnWorkbenchTabLabel,
} from "./fn.db-resource";
import {
  fxApplies,
  fxActiveDraft,
  fxApply,
  fxApplyPreview,
  fxBackup,
  fxDraft,
  fxDrafts,
  fxImpact,
  fxInspectDraft,
  fxInspectLive,
  fxResource,
  fxRestore,
  fxRestorePreview,
  fxRow,
  fxRows,
} from "./fx.db-resource";
import {
  txBulkDeleteRows,
  txConfirmApply,
  txCreateDraft,
  txCreateRow,
  txDeleteResource,
  txDeleteRow,
  txDiscardBackup,
  txDiscardDraft,
  txDraftChange,
  txExecuteLiveSql,
  txRename,
  txRestoreBackup,
  txUpdateRow,
} from "./tx.db-resource";
import type {
  TDbApiPortal,
  TDbApplyDetails,
  TDbApplyPreview,
  TDbBackup,
  TDbColumn,
  TDbDraft,
  TDbDraftDetails,
  TDbImpact,
  TDbInspection,
  TDbObject,
  TDbResourceApi,
  TDbRestorePreview,
  TDbRow,
  TDbRowIdentity,
  TDbRowPage,
  TDbRowPreview,
  TDbSqlResult,
  TResource,
} from "./types";
import styles from "./DbResourcePage.module.css";

type TWorkbenchTab = "overview" | "schema" | "data" | "sql";
type TConfirmState = "resource" | "draft" | "backup" | "row" | "bulk" | "structure" | null;

export type TDbResourcePageProps = { resourceId: string };

const API = orpcWebsocketService.apiService.api.resource as unknown as TDbResourceApi;
const portal: TDbApiPortal = { api: API };
const TAB_VALUES: TWorkbenchTab[] = ["overview", "schema", "data", "sql"];

export const DbResourcePage: Component<TDbResourcePageProps> = (props) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams<{ tab?: string; object?: string }>();
  const [resource, setResource] = createSignal<TResource | null>(null);
  const [impact, setImpact] = createSignal<TDbImpact | null>(null);
  const [drafts, setDrafts] = createSignal<TDbDraft[]>([]);
  const [draftDetail, setDraftDetail] = createSignal<TDbDraftDetails | null>(null);
  const [applyRuns, setApplyRuns] = createSignal<TDbApplyDetails[]>([]);
  const [backup, setBackup] = createSignal<TDbBackup>(null);
  const [liveInspection, setLiveInspection] = createSignal<TDbInspection | null>(null);
  const [draftInspection, setDraftInspection] = createSignal<TDbInspection | null>(null);
  const [rowPage, setRowPage] = createSignal<TDbRowPage | null>(null);
  const [rowCursors, setRowCursors] = createSignal<Array<TDbRowIdentity | undefined>>([undefined]);
  const [selectedRows, setSelectedRows] = createSignal<TDbRowPreview[]>([]);
  const [editingRow, setEditingRow] = createSignal<TDbRow | null>(null);
  const [rowEditorColumns, setRowEditorColumns] = createSignal<TDbColumn[]>([]);
  const [rowEditorDisabledColumns, setRowEditorDisabledColumns] = createSignal<string[]>([]);
  const [rowEditorDisabledValues, setRowEditorDisabledValues] = createSignal<Record<string, string>>({});
  const [rowDialogMode, setRowDialogMode] = createSignal<"create" | "edit">("create");
  const [rowDialogOpen, setRowDialogOpen] = createSignal(false);
  const [rowConflict, setRowConflict] = createSignal("");
  const [sql, setSql] = createSignal("");
  const [sqlResult, setSqlResult] = createSignal<TDbSqlResult | null>(null);
  const [sqlResultPage, setSqlResultPage] = createSignal(1);
  const [sqlApprovalOpen, setSqlApprovalOpen] = createSignal(false);
  const [pendingSqlApproval, setPendingSqlApproval] = createSignal("");
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal("");
  const [viewError, setViewError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [inspectionLoading, setInspectionLoading] = createSignal(false);
  const [rowsLoading, setRowsLoading] = createSignal(false);
  const [confirmState, setConfirmState] = createSignal<TConfirmState>(null);
  const [pendingRow, setPendingRow] = createSignal<TDbRow | null>(null);
  const [pendingStructureOperation, setPendingStructureOperation] = createSignal<Record<string, unknown> | null>(null);
  const [changeKind, setChangeKind] = createSignal<TStructureOperationKind>("createTable");
  const [changeColumn, setChangeColumn] = createSignal<string | undefined>();
  const [changeDialogOpen, setChangeDialogOpen] = createSignal(false);
  const [inspectorDialogOpen, setInspectorDialogOpen] = createSignal(false);
  const [operationDialogOpen, setOperationDialogOpen] = createSignal(false);
  const [operationMode, setOperationMode] = createSignal<"apply" | "restore">("apply");
  const [operationLoading, setOperationLoading] = createSignal(false);
  const [operationPreview, setOperationPreview] = createSignal<TDbApplyPreview | TDbRestorePreview | null>(null);
  const [operationRun, setOperationRun] = createSignal<TDbApplyDetails | null>(null);
  const [operationError, setOperationError] = createSignal("");
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let inspectionRequestId = 0;
  let rowsRequestId = 0;

  onCleanup(() => pollTimer && clearTimeout(pollTimer));

  const activeTab = (): TWorkbenchTab => TAB_VALUES.includes(searchParams.tab as TWorkbenchTab) ? searchParams.tab as TWorkbenchTab : "overview";
  const selectedObjectName = () => searchParams.object ?? "";
  const activeDraft = createMemo(() => fnActiveDraft(drafts()));
  const structureInspection = () => activeDraft() ? draftInspection() : liveInspection();
  const structureObjects = () => fnInspectionTables(structureInspection());
  const liveObjects = () => fnInspectionTables(liveInspection());
  const selectedStructureObject = () => structureObjects().find((object) => object.name === selectedObjectName()) ?? null;
  const selectedLiveObject = () => liveObjects().find((object) => object.name === selectedObjectName()) ?? null;
  const selectedLiveColumns = () => selectedLiveObject()?.columns.filter((column) => !column.hidden) ?? [];
  const draftChanges = () => draftDetail()?.changes ?? [];
  const sqlRowsResult = () => sqlResult()?.kind === "rows" ? sqlResult() as Extract<TDbSqlResult, { kind: "rows" }> : null;
  const sqlExecuteResult = () => sqlResult()?.kind === "execute" ? sqlResult() as Extract<TDbSqlResult, { kind: "execute" }> : null;
  const sqlPage = createMemo(() => fnBoundedPage(sqlRowsResult()?.rows ?? [], sqlResultPage(), 50));

  const selectTab = (tab: string) => {
    const nextTab = TAB_VALUES.includes(tab as TWorkbenchTab) ? tab as TWorkbenchTab : "overview";
    setSearchParams({ tab: nextTab, object: nextTab === "overview" || nextTab === "sql" ? undefined : searchParams.object });
  };

  const selectObject = (name: string) => setSearchParams({ tab: activeTab(), object: name || undefined });

  const loadMeta = async () => {
    setLoading(true);
    setError("");
    const [[resourceError, resourceValue], [impactError, impactValue], [draftsError, draftValues], [activeError, activeDraftValue], [appliesError, applyValues], [backupError, backupValue]] = await Promise.all([
      fxResource(portal, { resourceId: props.resourceId }),
      fxImpact(portal, { resourceId: props.resourceId }),
      fxDrafts(portal, { resourceId: props.resourceId }),
      fxActiveDraft(portal, { resourceId: props.resourceId }),
      fxApplies(portal, { resourceId: props.resourceId, limit: 10 }),
      fxBackup(portal, { resourceId: props.resourceId }),
    ]);
    if (resourceError || !resourceValue) {
      setError(resourceError?.message ?? "Database resource response was empty.");
      setResource(null);
      setLoading(false);
      return;
    }
    setResource(resourceValue);
    setName(resourceValue.name);
    const metadataError = impactError ?? draftsError ?? activeError ?? appliesError ?? backupError;
    if (metadataError) setError(metadataError.message);
    setImpact(impactValue ?? null);
    setDrafts(draftValues ?? []);
    const applyDetailsResponses = await Promise.all((applyValues ?? []).map(async (run) => ({ run, response: await fxApply(portal, { applyId: run.id }) })));
    const applyDetailsError = applyDetailsResponses.find(({ response }) => response[0])?.response[0];
    if (applyDetailsError) setError(applyDetailsError.message);
    setApplyRuns(applyDetailsResponses.map(({ run, response: [, details] }) => details ?? { apply: run, drain: null }));
    setBackup(backupValue ?? null);
    const openDraft = activeDraftValue?.draft ?? fnActiveDraft(draftValues ?? []);
    if (openDraft) {
      const [, detail] = await fxDraft(portal, { draftId: openDraft.id });
      setDraftDetail(detail ?? activeDraftValue ?? { draft: openDraft, changes: [] });
    } else {
      setDraftDetail(null);
      setDraftInspection(null);
    }
    setLoading(false);
  };

  const loadInspection = async () => {
    const requestId = ++inspectionRequestId;
    setViewError("");
    if (activeTab() !== "schema" && activeTab() !== "data") {
      setInspectionLoading(false);
      return;
    }
    setInspectionLoading(true);
    if (activeTab() === "schema" && activeDraft()) {
      const [inspectError, inspection] = await fxInspectDraft(portal, { resourceId: props.resourceId, draftId: activeDraft()!.id });
      if (requestId !== inspectionRequestId) return;
      setInspectionLoading(false);
      if (inspectError) return setViewError(inspectError.message);
      setDraftInspection(inspection ?? null);
      return;
    }
    if (activeTab() === "schema" || activeTab() === "data") {
      const [inspectError, inspection] = await fxInspectLive(portal, { resourceId: props.resourceId });
      if (requestId !== inspectionRequestId) return;
      setInspectionLoading(false);
      if (inspectError) return setViewError(inspectError.message);
      setLiveInspection(inspection ?? null);
    }
  };

  const loadRows = async (cursor?: TDbRowIdentity) => {
    const requestId = ++rowsRequestId;
    setViewError("");
    const objectName = selectedObjectName();
    if (!objectName || activeTab() !== "data") {
      setRowsLoading(false);
      setRowPage(null);
      return;
    }
    setRowsLoading(true);
    setRowPage(null);
    const [rowError, page] = await fxRows(portal, { resourceId: props.resourceId, objectName, cursor, limit: 50 });
    if (requestId !== rowsRequestId) return;
    setRowsLoading(false);
    if (rowError || !page) {
      setViewError(rowError?.message ?? "Database row response was empty.");
      setRowPage(null);
      return;
    }
    setRowPage(page);
    setSelectedRows([]);
    setEditingRow(null);
    setPendingRow(null);
  };

  createEffect(() => {
    void props.resourceId;
    void loadMeta();
  });

  createEffect(() => {
    if (!TAB_VALUES.includes(searchParams.tab as TWorkbenchTab)) setSearchParams({ tab: "overview", object: undefined });
  });

  createEffect(() => {
    void activeTab();
    void activeDraft()?.id;
    void loadInspection();
  });

  createEffect(() => {
    void activeTab();
    void selectedObjectName();
    setRowCursors([undefined]);
    void loadRows(undefined);
  });

  const rename = async () => {
    const trimmed = name().trim();
    if (!trimmed || trimmed === resource()?.name) return;
    setBusy(true);
    const [renameError] = await txRename(portal, { resourceId: props.resourceId, name: trimmed });
    setBusy(false);
    if (renameError) return showErrorToast(renameError.message);
    showSuccessToast("Resource renamed");
    catalogInvalidation.invalidate("resources");
    await loadMeta();
  };

  const deleteResource = async () => {
    setBusy(true);
    const [deleteError] = await txDeleteResource(portal, { resourceId: props.resourceId });
    setBusy(false);
    if (deleteError) return showErrorToast(deleteError.message);
    catalogInvalidation.invalidate("resources");
    showSuccessToast("Database resource deleted");
    navigate("/");
  };

  const createDraft = async () => {
    setBusy(true);
    const [draftError] = await txCreateDraft(portal, { resourceId: props.resourceId, name: "Schema draft" });
    setBusy(false);
    if (draftError) return showErrorToast(draftError.message);
    showSuccessToast("Schema draft created. Live database unchanged.");
    await loadMeta();
    await loadInspection();
  };

  const discardDraft = async () => {
    const draft = activeDraft();
    if (!draft) return;
    setBusy(true);
    const [discardError] = await txDiscardDraft(portal, { draftId: draft.id });
    setBusy(false);
    if (discardError) return showErrorToast(discardError.message);
    setConfirmState(null);
    showSuccessToast("Schema draft discarded");
    await loadMeta();
    await loadInspection();
  };

  const openChange = (kind: TStructureOperationKind, columnName?: string) => {
    setChangeKind(kind);
    setChangeColumn(columnName);
    setChangeDialogOpen(true);
  };

  const commitStructureOperation = async (operation: Record<string, unknown>) => {
    const draft = activeDraft();
    if (!draft) return;
    setBusy(true);
    const [changeError] = await txDraftChange(portal, { draftId: draft.id, operation });
    setBusy(false);
    if (changeError) return showErrorToast(changeError.message);
    setChangeDialogOpen(false);
    setConfirmState(null);
    setPendingStructureOperation(null);
    showSuccessToast("Change applied to draft. Live database unchanged.");
    await loadMeta();
    await loadInspection();
  };

  const submitStructureOperation = (operation: Record<string, unknown>) => {
    const kind = String(operation.kind ?? "");
    if (["dropTable", "dropColumn", "alterColumn", "dropIndex", "dropForeignKey"].includes(kind)) {
      setPendingStructureOperation(operation);
      setChangeDialogOpen(false);
      setConfirmState("structure");
      return;
    }
    void commitStructureOperation(operation);
  };

  const executeSql = async (approved = false, approvedSql?: string) => {
    const statement = (approvedSql ?? sql()).trim();
    if (!statement) return;
    setBusy(true);
    const [sqlError, result] = await txExecuteLiveSql(portal, { resourceId: props.resourceId, sql: statement, approved });
    setBusy(false);
    if (sqlError) {
      if (!approved && fnLiveSqlApprovalRequired(sqlError)) {
        setPendingSqlApproval(statement);
        setSqlApprovalOpen(true);
        return;
      }
      return showErrorToast(sqlError.message);
    }
    if (!result) return showErrorToast("Live SQL response was empty.");
    setSqlApprovalOpen(false);
    setPendingSqlApproval("");
    setSqlResult(result);
    setSqlResultPage(1);
    showSuccessToast(result.kind === "rows" ? `${result.rowCount} live rows returned` : `${result.rowsAffected} live rows affected`);
    await loadMeta();
  };

  const openRowEditor = async (mode: "create" | "edit", row: TDbRowPreview | null) => {
    setRowDialogMode(mode);
    setRowConflict("");
    if (mode === "edit") {
      const object = selectedLiveObject();
      if (!object || !row?.identity) return;
      const columns = selectedLiveColumns();
      const disabledColumns = columns.filter((column) => {
        const preview = row.values[column.name];
        return column.declaredType.toUpperCase().includes("BLOB") || preview?.type === "blob" || preview?.type === "blobPreview";
      });
      const editableColumns = columns.filter((column) => !disabledColumns.includes(column));
      let fullRow: TDbRow = { identity: row.identity, values: {} };
      if (editableColumns.length > 0) {
        setBusy(true);
        const [rowError, projectedRow] = await fxRow(portal, { resourceId: props.resourceId, objectName: object.name, identity: row.identity, columns: editableColumns.map((column) => column.name) });
        setBusy(false);
        if (rowError || !projectedRow) return showErrorToast(rowError?.message ?? "Database row response was empty.");
        fullRow = projectedRow;
      }
      setRowEditorColumns(columns);
      setRowEditorDisabledColumns(disabledColumns.map((column) => column.name));
      setRowEditorDisabledValues(Object.fromEntries(disabledColumns.map((column) => [column.name, fnCellText(row.values[column.name])])));
      setEditingRow(fullRow);
    } else {
      setRowEditorColumns(selectedLiveColumns());
      setRowEditorDisabledColumns([]);
      setRowEditorDisabledValues({});
      setEditingRow(null);
    }
    setRowDialogOpen(true);
  };

  const openRowDelete = async (row: TDbRowPreview) => {
    const object = selectedLiveObject();
    if (!object || !row.identity) return;
    setBusy(true);
    const [rowError, fullRow] = await fxRow(portal, { resourceId: props.resourceId, objectName: object.name, identity: row.identity });
    setBusy(false);
    if (rowError || !fullRow) return showErrorToast(rowError?.message ?? "Database row response was empty.");
    setPendingRow(fullRow);
    setConfirmState("row");
  };

  const saveRow = async (values: TDbRow["values"]) => {
    const object = selectedLiveObject();
    const row = editingRow();
    if (!object || (rowDialogMode() === "edit" && !row?.identity)) return;
    setBusy(true);
    const [rowError] = rowDialogMode() === "create"
      ? await txCreateRow(portal, { resourceId: props.resourceId, objectName: object.name, values })
      : await txUpdateRow(portal, {
          resourceId: props.resourceId,
          objectName: object.name,
          identity: row!.identity!,
          expected: row!.values,
          values,
        });
    setBusy(false);
    if (rowError) {
      if (fnApiErrorCode(rowError).toLowerCase().includes("conflict") || rowError.message.toLowerCase().includes("conflict")) {
        setRowConflict(rowError.message);
        return;
      }
      return showErrorToast(rowError.message);
    }
    setRowDialogOpen(false);
    showSuccessToast(rowDialogMode() === "create" ? "Row added" : "Row updated");
    await loadRows(rowCursors()[rowCursors().length - 1]);
  };

  const deleteRow = async () => {
    const object = selectedLiveObject();
    const row = pendingRow();
    if (!object || !row?.identity) return;
    setBusy(true);
    const [rowError] = await txDeleteRow(portal, {
      resourceId: props.resourceId,
      objectName: object.name,
      identity: row.identity,
      expected: row.values,
    });
    setBusy(false);
    if (rowError) {
      if (fnApiErrorCode(rowError).toLowerCase().includes("conflict") || rowError.message.toLowerCase().includes("conflict")) {
        showErrorToast("Row changed before deletion. Reload it before trying again.");
      } else showErrorToast(rowError.message);
      return;
    }
    setConfirmState(null);
    setPendingRow(null);
    showSuccessToast("Row deleted");
    await loadRows(rowCursors()[rowCursors().length - 1]);
  };

  const bulkDelete = async () => {
    const object = selectedLiveObject();
    const rows = selectedRows().filter((row): row is TDbRowPreview & { identity: TDbRowIdentity } => row.identity !== null);
    if (!object || !rows.length) return;
    setBusy(true);
    const hydratedResponses: Array<Awaited<ReturnType<typeof fxRow>>> = [];
    for (const batch of fnBatches(rows, 4)) {
      hydratedResponses.push(...await Promise.all(batch.map((row) => fxRow(portal, {
        resourceId: props.resourceId,
        objectName: object.name,
        identity: row.identity,
      }))));
    }
    const hydrationError = hydratedResponses.find(([rowError, fullRow]) => rowError || !fullRow);
    if (hydrationError) {
      setBusy(false);
      return showErrorToast(hydrationError[0]?.message ?? "A selected database row response was empty.");
    }
    const hydratedRows = hydratedResponses.map(([, row]) => row!);
    const [bulkError] = await txBulkDeleteRows(portal, {
      resourceId: props.resourceId,
      objectName: object.name,
      rows: hydratedRows.map((row) => ({ identity: row.identity!, expected: row.values })),
    });
    setBusy(false);
    if (bulkError) return showErrorToast(bulkError.message);
    setConfirmState(null);
    showSuccessToast(`${selectedRows().length} rows deleted transactionally`);
    await loadRows(rowCursors()[rowCursors().length - 1]);
  };

  const toggleSelectedRow = (row: TDbRowPreview, selected: boolean) => setSelectedRows((current) =>
    selected ? [...current, row] : current.filter((candidate) => candidate !== row),
  );

  const pollApply = async (applyId: string) => {
    const [pollError, run] = await fxApply(portal, { applyId });
    if (pollError || !run) {
      setOperationError(pollError?.message ?? "Apply status response was empty.");
      return;
    }
    setOperationRun(run);
    if (!fnApplyTerminal(run.apply.status)) pollTimer = setTimeout(() => void pollApply(applyId), 900);
    else await loadMeta();
  };

  const pollRestore = async (restoreId: string) => {
    const [pollError, run] = await fxRestore(portal, { restoreId });
    if (pollError || !run) {
      setOperationError(pollError?.message ?? "Restore status response was empty.");
      return;
    }
    setOperationRun(run);
    if (!fnRestoreTerminal(run.apply.status)) pollTimer = setTimeout(() => void pollRestore(restoreId), 900);
    else await loadMeta();
  };

  const openApply = async () => {
    const draft = activeDraft();
    if (!draft) return;
    setOperationMode("apply");
    setOperationDialogOpen(true);
    setOperationLoading(true);
    setOperationPreview(null);
    setOperationRun(null);
    setOperationError("");
    const [previewError, preview] = await fxApplyPreview(portal, { draftId: draft.id });
    setOperationLoading(false);
    if (previewError || !preview) return setOperationError(previewError?.message ?? "Apply preview response was empty.");
    setOperationPreview(preview);
  };

  const setCoordinatedOperationOpen = (open: boolean) => {
    setOperationDialogOpen(open);
    if (!open) {
      if (pollTimer) clearTimeout(pollTimer);
      void loadMeta();
    }
  };

  const confirmApply = async () => {
    const draft = activeDraft();
    if (!draft) return;
    setBusy(true);
    const [applyError, run] = await txConfirmApply(portal, { draftId: draft.id });
    setBusy(false);
    if (applyError || !run) return setOperationError(applyError?.message ?? "Apply confirmation response was empty.");
    setOperationRun({ apply: run, drain: null });
    void pollApply(run.id);
  };

  const openRestore = async () => {
    const retained = backup();
    if (!retained) return;
    setOperationMode("restore");
    setOperationDialogOpen(true);
    setOperationLoading(true);
    setOperationPreview(null);
    setOperationRun(null);
    setOperationError("");
    const [previewError, preview] = await fxRestorePreview(portal, { resourceId: props.resourceId, applyId: retained.applyId });
    setOperationLoading(false);
    if (previewError || !preview) return setOperationError(previewError?.message ?? "Restore preview response was empty.");
    setOperationPreview(preview);
  };

  const confirmRestore = async () => {
    const retained = backup();
    if (!retained) return;
    setBusy(true);
    const [restoreError, run] = await txRestoreBackup(portal, { resourceId: props.resourceId, applyId: retained.applyId });
    setBusy(false);
    if (restoreError || !run) return setOperationError(restoreError?.message ?? "Restore response was empty.");
    setOperationRun({ apply: run, drain: null });
    void pollRestore(run.id);
  };

  const discardBackup = async () => {
    const retained = backup();
    if (!retained) return;
    setBusy(true);
    const [discardError] = await txDiscardBackup(portal, { resourceId: props.resourceId, applyId: retained.applyId });
    setBusy(false);
    if (discardError) return showErrorToast(discardError.message);
    setConfirmState(null);
    showSuccessToast("Retained backup discarded");
    await loadMeta();
  };

  const nextRows = async () => {
    const next = rowPage()?.nextCursor;
    if (!next) return;
    setRowCursors((current) => [...current, next]);
    await loadRows(next);
  };

  const previousRows = async () => {
    if (rowCursors().length <= 1) return;
    const next = rowCursors().slice(0, -1);
    setRowCursors(next);
    await loadRows(next[next.length - 1]);
  };

  return (
    <div class={styles.page}>
      <Show when={resource()} fallback={<div class={styles.centerState}><p class={error() ? styles.error : styles.muted}>{error() || "Loading database resource…"}</p></div>}>
        {(current) => (
          <Tabs.Root value={activeTab()} onChange={selectTab} class={styles.tabsRoot}>
            <header class={styles.header}>
              <div class={styles.titleBlock}>
                <p class={styles.eyebrow}>Database resource</p>
                <div class={styles.titleLine}><Database size={16} /><h2 class={styles.title}>{current().name}</h2><span class={styles.status}><i class={`${styles.dot} ${current().status === "ready" ? styles.dotReady : ""}`} />{fnStatusLabel(current().status)}</span></div>
                <Show when={viewError() || error()}><p class={styles.headerError} role="alert">{viewError() || error()}</p></Show>
              </div>
              <div class={styles.headerActions}>
                <Button class={`${styles.button} ${styles.iconButton}`} aria-label="Refresh database workbench" disabled={loading()} onClick={() => void loadMeta()}><RefreshCw size={14} /></Button>
                <Button class={`${styles.button} ${styles.iconButton}`} aria-label="Toggle sidebar" onClick={() => setStore("sidebarVisible", (visible) => !visible)}><PanelLeft size={15} /></Button>
                <Button class={`${styles.button} ${styles.danger}`} disabled={busy()} onClick={() => setConfirmState("resource")}><Trash2 size={13} /> Delete</Button>
              </div>
            </header>
            <Tabs.List class={styles.tabsList} aria-label="Database resource workbench">
              <For each={TAB_VALUES}>{(tab) => <Tabs.Trigger class={styles.tab} value={tab}>{fnWorkbenchTabLabel(tab)}</Tabs.Trigger>}</For>
            </Tabs.List>

            <Tabs.Content value="overview" class={styles.tabContent}>
              <div class={styles.content}>
                <section class={styles.summary}>
                  <div class={styles.summaryItem}><span class={styles.label}>Status</span><span>{fnStatusLabel(current().status)}</span></div>
                  <div class={styles.summaryItem}><span class={styles.label}>Created</span><span>{fnTimestamp(current().created_at)}</span></div>
                  <div class={styles.summaryItem}><span class={styles.label}>Updated</span><span>{fnTimestamp(current().updated_at)}</span></div>
                  <div class={styles.summaryItem}><span class={styles.label}>Resource ID</span><code title={current().id}>{current().id}</code></div>
                </section>
                <div class={styles.twoColumn}>
                  <section class={styles.panel}>
                    <div class={styles.panelHeader}><h3>Settings</h3></div>
                    <div class={styles.panelBody}>
                      <TextField.Root value={name()} onChange={setName}>
                        <TextField.Label class={styles.label}>Resource name</TextField.Label>
                        <TextField.Input class={styles.input} />
                      </TextField.Root>
                      <div class={styles.actions}><Button class={`${styles.button} ${styles.primary}`} disabled={busy() || !name().trim() || name().trim() === current().name} onClick={rename}>Save name</Button></div>
                    </div>
                  </section>
                  <section class={styles.panel}>
                    <div class={styles.panelHeader}><h3>Bindings</h3><span>{fnImpactSlots(impact()).length}</span></div>
                    <table class={styles.table}>
                      <thead><tr><th>Definition</th><th>Slot</th><th>Effective access</th></tr></thead>
                      <tbody><For each={fnImpactSlots(impact())} fallback={<tr><td colSpan={3} class={styles.muted}>No revision bindings.</td></tr>}>{(slot) => (
                        <tr><td>{slot.definitionId} · {slot.revisionId}</td><td>{slot.slot}</td><td>{slot.scope.join(" + ")}</td></tr>
                      )}</For></tbody>
                    </table>
                  </section>
                </div>
                <section class={styles.panel}>
                  <div class={styles.panelHeader}><h3>Active resource uses</h3><span>{fnImpactUses(impact()).length}</span></div>
                  <table class={styles.table}>
                    <thead><tr><th>Use</th><th>Kind</th><th>Observed status</th><th>Label</th></tr></thead>
                    <tbody><For each={fnImpactUses(impact())} fallback={<tr><td colSpan={4} class={styles.muted}>No active resource uses.</td></tr>}>{(use) => (
                      <tr><td>{use.id}</td><td>{use.kind}</td><td>{use.state}</td><td>{use.label ?? "—"}</td></tr>
                    )}</For></tbody>
                  </table>
                </section>
                <div class={styles.twoColumn}>
                  <section class={styles.panel}>
                    <div class={styles.panelHeader}><h3>Recent apply runs</h3><span>{applyRuns().length}</span></div>
                    <For each={applyRuns()} fallback={<p class={styles.empty}>No coordinated applies yet.</p>}>{(details) => (
                      <div class={styles.applyRow}>
                        <div><strong>{fnStatusLabel(details.apply.status)}</strong><small>{fnTimestamp(details.apply.created_at)}</small></div>
                        <div><span>Database: {details.apply.status === "succeeded" ? "succeeded" : fnStatusLabel(details.apply.status)}</span><span>{details.drain ? `${details.drain.drainedUses.length} use(s) drained` : "No active drain lease"}</span></div>
                      </div>
                    )}</For>
                  </section>
                  <section class={styles.panel}>
                    <div class={styles.panelHeader}><h3>Latest retained backup</h3></div>
                    <Show when={backup()} fallback={<p class={styles.empty}>No retained backup.</p>}>
                      {(retained) => <div class={styles.panelBody}><dl class={styles.definitionList}><div><dt>Apply</dt><dd>{retained().applyId}</dd></div><div><dt>Created</dt><dd>{fnTimestamp(retained().createdAt)}</dd></div></dl><p class={styles.warning}>Restore loses writes made after this backup.</p><div class={styles.actions}><Button class={`${styles.button} ${styles.danger}`} onClick={() => setConfirmState("backup")}>Discard</Button><Button class={`${styles.button} ${styles.primary}`} onClick={() => void openRestore()}>Preview restore</Button></div></div>}
                    </Show>
                  </section>
                </div>
              </div>
            </Tabs.Content>

            <Tabs.Content value="schema" class={styles.tabContent}>
              <div class={styles.workbenchHeader}>
                <div><strong>{activeDraft() ? "Schema draft active" : "Live schema"}</strong><span>{activeDraft() ? `${draftChanges().length} pending changes · Live database unchanged` : "Read-only inspection"}</span></div>
                <div class={styles.actions}>
                  <Show when={activeDraft()} fallback={<Button class={`${styles.button} ${styles.primary}`} disabled={busy()} onClick={() => void createDraft()}>Create schema draft</Button>}>
                    <Button class={`${styles.button} ${styles.danger}`} disabled={busy()} onClick={() => setConfirmState("draft")}>Discard draft</Button>
                    <Button class={`${styles.button} ${styles.primary}`} disabled={busy()} onClick={() => void openApply()}>Review & apply</Button>
                  </Show>
                </div>
              </div>
              <div class={styles.workbench}>
                <aside class={styles.navigator}>
                  <div class={styles.navigatorHeader}><span>Tables</span><Show when={activeDraft()}><Button class={styles.iconButton} aria-label="Create table" onClick={() => openChange("createTable")}><Plus size={13} /></Button></Show></div>
                  <For each={structureObjects()} fallback={<p class={styles.navigatorEmpty}>{inspectionLoading() ? "Loading tables…" : "No user tables."}</p>}>{(object) => <Button class={`${styles.objectItem} ${selectedObjectName() === object.name ? styles.objectItemSelected : ""}`} onClick={() => selectObject(object.name)}><span>{object.name}</span><small>table</small></Button>}</For>
                </aside>
                <main class={styles.structureMain}>
                  <Show when={selectedStructureObject()} fallback={<div class={styles.centerState}><p class={styles.muted}>Select a table to inspect its physical schema.</p></div>}>
                    {(object) => <>
                      <div class={styles.objectTitle}><div><h3>{object().name}</h3><span>{object().kind} · {object().editable ? "editable identity" : object().readOnlyReason ?? "read-only"}</span></div><div class={styles.actions}><Button class={`${styles.button} ${styles.narrowInspectorTrigger}`} onClick={() => setInspectorDialogOpen(true)}>Details</Button><Show when={activeDraft() && object().kind === "table"}><DropdownMenu.Root><DropdownMenu.Trigger class={styles.button}>Object actions <ChevronDown size={12} /></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content class={styles.menu}><DropdownMenu.Item class={styles.menuItem} onSelect={() => openChange("renameTable")}>Rename table</DropdownMenu.Item><DropdownMenu.Item class={`${styles.menuItem} ${styles.menuItemDanger}`} onSelect={() => openChange("dropTable")}>Drop table</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></Show></div></div>
                      <div class={styles.tableToolbar}><h4>Columns</h4><Show when={activeDraft() && object().kind === "table"}><Button class={styles.button} onClick={() => openChange("addColumn")}><Plus size={12} /> Add column</Button></Show></div>
                      <table class={styles.table}><thead><tr><th>Name</th><th>Declared type</th><th>Null</th><th>Default</th><th>PK order</th><Show when={activeDraft()}><th>Actions</th></Show></tr></thead><tbody><For each={object().columns}>{(column) => <tr><td>{column.name}</td><td>{column.declaredType || "ANY"}</td><td>{column.nullable ? "yes" : "no"}</td><td><code>{column.defaultSql ?? "—"}</code></td><td>{column.primaryKeyOrder || "—"}</td><Show when={activeDraft()}><td><div class={styles.inlineActions}><Button class={styles.linkButton} onClick={() => openChange("renameColumn", column.name)}>Rename</Button><Button class={styles.linkButton} onClick={() => openChange("alterColumn", column.name)}>Edit</Button><Button class={`${styles.linkButton} ${styles.dangerText}`} onClick={() => openChange("dropColumn", column.name)}>Drop</Button></div></td></Show></tr>}</For></tbody></table>
                    </>}
                  </Show>
                </main>
                <aside class={styles.inspector}><ObjectInspector object={selectedStructureObject()} editableDraft={Boolean(activeDraft())} onChange={openChange} /></aside>
              </div>
              <Show when={activeDraft()}><section class={styles.changePanel}><div class={styles.panelHeader}><h3>Pending changes</h3><span>{draftChanges().length}</span></div><ol class={styles.changeList}><For each={draftChanges()} fallback={<li class={styles.empty}>No changes yet.</li>}>{(change) => <li><span class={styles.sequence}>{change.sequence}</span><strong>{fnChangeSummary(change)}</strong><code>{change.sql}</code></li>}</For></ol></section></Show>
            </Tabs.Content>

            <Tabs.Content value="data" class={styles.tabContent}>
              <div class={styles.dataWorkbench}>
                <aside class={styles.navigator}><div class={styles.navigatorHeader}><span>Tables</span></div><For each={liveObjects()} fallback={<p class={styles.navigatorEmpty}>{inspectionLoading() ? "Loading tables…" : "No user tables."}</p>}>{(object) => <Button class={`${styles.objectItem} ${selectedObjectName() === object.name ? styles.objectItemSelected : ""}`} onClick={() => selectObject(object.name)}><span>{object.name}</span><small>table</small></Button>}</For></aside>
                <main class={styles.dataMain}>
                  <Show when={selectedLiveObject()} fallback={<div class={styles.centerState}><p class={styles.muted}>Select a table before loading live rows.</p></div>}>
                    {(object) => <>
                      <div class={styles.dataHeader}><div><h3>{object().name}</h3><p class={styles.muted}>Live data · never part of a schema draft</p></div><div class={styles.actions}><Show when={!object().editable}><span class={styles.readOnly}>{object().readOnlyReason ?? "This table has no safe stable identity and is read-only."}</span></Show><Button class={`${styles.button} ${styles.danger}`} disabled={!selectedRows().length || !object().editable} onClick={() => setConfirmState("bulk")}>Delete selected ({selectedRows().length})</Button><Button class={`${styles.button} ${styles.primary}`} disabled={!object().editable} onClick={() => void openRowEditor("create", null)}><Plus size={12} /> Add row</Button></div></div>
                      <div class={styles.gridScroll}><table class={`${styles.table} ${styles.dataTable}`}><thead><tr><th class={styles.checkCell} aria-label="Selection" /><For each={selectedLiveColumns()}>{(column) => <th>{column.name}<small>{column.declaredType || "ANY"}</small></th>}</For><th>Actions</th></tr></thead><tbody><For each={rowPage()?.rows ?? []} fallback={<tr><td colSpan={selectedLiveColumns().length + 2} class={styles.empty}>{rowsLoading() ? "Loading rows…" : "No rows on this page."}</td></tr>}>{(row) => <tr><td class={styles.checkCell}><input type="checkbox" aria-label="Select row" disabled={!object().editable} checked={selectedRows().includes(row)} onChange={(event) => toggleSelectedRow(row, event.currentTarget.checked)} /></td><For each={selectedLiveColumns()}>{(column) => { const cell = () => row.values[column.name]; return <td class={`${styles.cell} ${cell()?.type === "null" ? styles.nullCell : cell()?.type === "blob" || cell()?.type === "blobPreview" ? styles.blobCell : ""}`} title={fnCellText(cell())}>{fnCellText(cell())}</td>; }}</For><td><div class={styles.inlineActions}><Button class={styles.iconButton} aria-label="Edit row" disabled={!object().editable || busy()} onClick={() => void openRowEditor("edit", row)}><MoreHorizontal size={13} /></Button><Button class={styles.iconButton} aria-label="Delete row" disabled={!object().editable || busy()} onClick={() => void openRowDelete(row)}><Trash2 size={13} /></Button></div></td></tr>}</For></tbody></table></div>
                      <div class={styles.pagination}><Button class={styles.button} disabled={rowCursors().length <= 1} onClick={() => void previousRows()}>Previous</Button><span>Cursor page {rowCursors().length} · up to 50 rows{rowPage()?.hasMore && !rowPage()?.nextCursor ? " · more rows unavailable without a stable identity" : ""}</span><Button class={styles.button} disabled={!rowPage()?.nextCursor} onClick={() => void nextRows()}>Next</Button></div>
                    </>}
                  </Show>
                </main>
              </div>
            </Tabs.Content>

            <Tabs.Content value="sql" class={styles.tabContent}>
              <div class={styles.content}>
                <section class={styles.sqlWorkspace}>
                  <div class={styles.panel}>
                    <div class={styles.panelHeader}><h3>Live SQL console</h3><span>Live database</span></div>
                    <div class={styles.panelBody}>
                      <TextField.Root value={sql()} onChange={setSql}>
                        <TextField.Label class={styles.label}>One SQLite-compatible statement</TextField.Label>
                        <TextField.TextArea class={`${styles.input} ${styles.sqlEditor}`} placeholder="SELECT id, body FROM notes ORDER BY id LIMIT 100;" />
                      </TextField.Root>
                      <div class={styles.actions}><Button class={`${styles.button} ${styles.primary}`} disabled={busy() || !sql().trim()} onClick={() => void executeSql(false)}>{busy() ? "Running…" : "Run against live"}</Button></div>
                    </div>
                  </div>
                  <div class={styles.panel}>
                    <div class={styles.panelHeader}><h3>Result</h3><span>{fnSqlResultSummary(sqlResult())}</span></div>
                    <Show when={sqlResult()} fallback={<p class={styles.empty}>Run a live statement to display its result.</p>}>
                      {(result) => <Show when={result().kind === "rows"} fallback={<div class={styles.sqlExecuteSummary}><strong>{sqlExecuteResult()?.rowsAffected ?? 0}</strong><span>rows affected</span><Show when={sqlExecuteResult()?.lastInsertRowId}><span>Last insert row ID: {fnCellText(sqlExecuteResult()?.lastInsertRowId ?? undefined)}</span></Show></div>}>
                        <Show when={sqlRowsResult()?.truncated}><p class={styles.warning}>Showing the first 200 rows. Add a LIMIT/OFFSET or a narrower WHERE clause to inspect the next bounded result.</p></Show>
                        <div class={`${styles.gridScroll} ${styles.sqlGridScroll}`}><table class={`${styles.table} ${styles.dataTable}`}><thead><tr><For each={fnSqlResultColumns(sqlResult())}>{(column) => <th>{column}</th>}</For></tr></thead><tbody><For each={sqlPage().rows} fallback={<tr><td colSpan={Math.max(1, fnSqlResultColumns(sqlResult()).length)} class={styles.empty}>Statement returned no rows.</td></tr>}>{(row) => <tr><For each={fnSqlResultColumns(sqlResult())}>{(column) => { const cell = () => row[column]; return <td class={`${styles.cell} ${cell()?.type === "null" ? styles.nullCell : cell()?.type === "blob" || cell()?.type === "blobPreview" ? styles.blobCell : ""}`} title={fnCellText(cell())}>{fnCellText(cell())}</td>; }}</For></tr>}</For></tbody></table></div>
                        <div class={styles.pagination}><Button class={styles.button} disabled={sqlPage().page <= 1} onClick={() => setSqlResultPage((page) => page - 1)}>Previous</Button><span>{sqlPage().firstRow}–{sqlPage().lastRow} of {sqlRowsResult()?.rowCount ?? 0} returned · page {sqlPage().page} of {sqlPage().pageCount}</span><Button class={styles.button} disabled={sqlPage().page >= sqlPage().pageCount} onClick={() => setSqlResultPage((page) => page + 1)}>Next</Button></div>
                      </Show>}
                    </Show>
                  </div>
                </section>
              </div>
            </Tabs.Content>
          </Tabs.Root>
        )}
      </Show>

      <StructureChangeDialog open={changeDialogOpen()} kind={changeKind()} tableName={selectedStructureObject()?.name} columnName={changeColumn()} column={selectedStructureObject()?.columns.find((column) => column.name === changeColumn())} busy={busy()} onOpenChange={setChangeDialogOpen} onSubmit={submitStructureOperation} />
      <Dialog.Root open={inspectorDialogOpen()} onOpenChange={setInspectorDialogOpen}><Dialog.Portal><Dialog.Overlay class={styles.dialogOverlay} /><Dialog.Content class={`${styles.dialogContent} ${styles.inspectorDialog}`}><Dialog.Title class={styles.dialogTitle}>Object details · {selectedStructureObject()?.name}</Dialog.Title><Dialog.Description class={styles.dialogDescription}>Indexes, foreign keys, triggers, and exact create SQL.</Dialog.Description><ObjectInspector object={selectedStructureObject()} editableDraft={Boolean(activeDraft())} onChange={(kind, value) => { setInspectorDialogOpen(false); openChange(kind, value); }} /><div class={styles.dialogActions}><Dialog.CloseButton class={styles.button}>Close</Dialog.CloseButton></div></Dialog.Content></Dialog.Portal></Dialog.Root>
      <RowEditorDialog open={rowDialogOpen()} mode={rowDialogMode()} tableName={selectedLiveObject()?.name ?? ""} columns={rowEditorColumns()} disabledColumns={rowEditorDisabledColumns()} disabledValues={rowEditorDisabledValues()} row={editingRow()} busy={busy()} conflict={rowConflict()} onOpenChange={(open) => { setRowDialogOpen(open); if (!open) setEditingRow(null); }} onSubmit={(values) => void saveRow(values)} onReload={() => { setRowDialogOpen(false); setEditingRow(null); void loadRows(rowCursors()[rowCursors().length - 1]); }} />
      <CoordinatedOperationDialog open={operationDialogOpen()} mode={operationMode()} loading={operationLoading()} busy={busy()} preview={operationPreview()} run={operationRun()} error={operationError()} onOpenChange={setCoordinatedOperationOpen} onConfirm={() => operationMode() === "apply" ? void confirmApply() : void confirmRestore()} />
      <LiveSqlApprovalDialog open={sqlApprovalOpen()} sql={pendingSqlApproval()} busy={busy()} onOpenChange={(open) => { setSqlApprovalOpen(open); if (!open) setPendingSqlApproval(""); }} onConfirm={() => void executeSql(true, pendingSqlApproval())} />

      <ConfirmActionDialog open={confirmState() === "resource"} title="Delete database resource" description="This permanently deletes the database resource and its live data. Bound definitions must be reviewed first." confirmLabel="Delete resource" busy={busy()} destructive onOpenChange={(open) => !open && setConfirmState(null)} onConfirm={() => void deleteResource()} />
      <ConfirmActionDialog open={confirmState() === "draft"} title="Discard schema draft" description="This deletes the physical draft and every pending schema change. Live remains unchanged." confirmLabel="Discard draft" busy={busy()} destructive onOpenChange={(open) => !open && setConfirmState(null)} onConfirm={() => void discardDraft()} />
      <ConfirmActionDialog open={confirmState() === "backup"} title="Discard retained backup" description="This permanently removes the latest recovery point. It will no longer be available for coordinated restore." confirmLabel="Discard backup" busy={busy()} destructive onOpenChange={(open) => !open && setConfirmState(null)} onConfirm={() => void discardBackup()} />
      <ConfirmActionDialog open={confirmState() === "row"} title="Delete live row" description="The row is deleted directly from live using its stable identity and expected original values. A conflict will never be overwritten." confirmLabel="Delete row" busy={busy()} destructive onOpenChange={(open) => { if (!open) { setConfirmState(null); setPendingRow(null); } }} onConfirm={() => void deleteRow()} />
      <ConfirmActionDialog open={confirmState() === "bulk"} title="Bulk delete live rows" description={`Delete ${selectedRows().length} selected rows in one bounded transaction? Conflicts abort the operation.`} confirmLabel="Delete selected" busy={busy()} destructive onOpenChange={(open) => !open && setConfirmState(null)} onConfirm={() => void bulkDelete()} />
      <ConfirmActionDialog open={confirmState() === "structure"} title="Confirm destructive draft change" description={`This draft operation may remove or rewrite affected objects or data: ${String(pendingStructureOperation()?.kind ?? "change")}. Live remains unchanged until apply.`} confirmLabel="Apply to draft" busy={busy()} destructive onOpenChange={(open) => !open && setConfirmState(null)} onConfirm={() => pendingStructureOperation() && void commitStructureOperation(pendingStructureOperation()!)} />
    </div>
  );
};

export default DbResourcePage;
