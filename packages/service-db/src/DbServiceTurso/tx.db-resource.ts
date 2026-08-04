import type { Database } from '@tursodatabase/database';
import type {
  TDbResourceApplyRun,
  TDbResourceApplyStatus,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TDbResourceDraftChangeKind,
  TDbResourceDraftStatus,
  TJson,
} from '../model';
import { txRunDatabaseTransaction } from '../tx.run-database-transaction';
import { fnSerializeJsonValue } from './fn.json';
import { fnParseDbResourceDraftChangeRow } from './fn.db-resource';
import { fxDbResourceApplyGet, fxDbResourceDraftGet } from './fx.db-resource';

type TPortal = { db: Database };
type TArgsDraftCreate = { id: string; resourceId: string; name: string };
type TArgsDraftRename = { id: string; name: string };
type TArgsDraftUpdateStatus = {
  id: string;
  status: TDbResourceDraftStatus;
  expectedStatus?: TDbResourceDraftStatus;
  lastError?: TJson | null;
};
type TArgsDraftAppendChange = {
  draftId: string;
  sequence: number;
  kind: TDbResourceDraftChangeKind;
  operation?: TJson | null;
  sql: string;
};
type TArgsDraftDiscard = { id: string; lastError?: TJson | null };
type TArgsApplyCreate = {
  id: string;
  resourceId: string;
  draftId?: string | null;
  sourceApplyId?: string | null;
  status?: TDbResourceApplyStatus;
};
type TArgsApplyCreateFromDraft = { id: string; resourceId: string; draftId: string };
type TArgsApplyFinishWithDraft = {
  id: string;
  draftId: string;
  status: Extract<TDbResourceApplyStatus, 'succeeded' | 'failed' | 'recovered'>;
  expectedStatus?: TDbResourceApplyStatus;
  draftStatus: Extract<TDbResourceDraftStatus, 'applied' | 'editing' | 'error'>;
  lastError?: TJson | null;
  backupRetained?: boolean;
};
type TArgsApplyUpdate = {
  id: string;
  status: TDbResourceApplyStatus;
  expectedStatus?: TDbResourceApplyStatus;
  lastError?: TJson | null;
  backupRetained?: boolean;
};

function serializedJson(value: TJson | null | undefined): string | null {
  return value === null || value === undefined ? null : fnSerializeJsonValue(value);
}

async function requireDbResource(
  portal: TPortal,
  resourceId: string,
  allowedStatuses: readonly string[],
): Promise<void> {
  const resource = await (await portal.db.prepare(`
    SELECT kind, status FROM resource_catalog WHERE id = ?
  `)).get(resourceId) as { kind?: unknown; status?: unknown } | null;
  if (!resource || resource.kind !== 'db' || !allowedStatuses.includes(String(resource.status))) {
    throw new Error(`Resource '${resourceId}' is not an available DbResource.`);
  }
}

export async function txDbResourceDraftCreate(
  portal: TPortal,
  args: TArgsDraftCreate,
): Promise<TDbResourceDraft> {
  await requireDbResource(portal, args.resourceId, ['ready']);
  await (await portal.db.prepare(`
    INSERT INTO db_resource_drafts (
      id, resource_id, name, status, last_error_json, applied_at_sec
    ) VALUES (?, ?, ?, 'editing', NULL, NULL)
  `)).run(args.id, args.resourceId, args.name);
  const draft = await fxDbResourceDraftGet(portal, { id: args.id });
  if (!draft) throw new Error(`Failed to create DbResource draft '${args.id}'.`);
  return draft;
}

export async function txDbResourceDraftRename(
  portal: TPortal,
  args: TArgsDraftRename,
): Promise<TDbResourceDraft | null> {
  const result = await (await portal.db.prepare(`
    UPDATE db_resource_drafts
    SET name = ?, updated_at_sec = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'editing'
  `)).run(args.name, args.id);
  return result.changes === 0 ? null : fxDbResourceDraftGet(portal, { id: args.id });
}

export async function txDbResourceDraftUpdateStatus(
  portal: TPortal,
  args: TArgsDraftUpdateStatus,
): Promise<TDbResourceDraft | null> {
  const predicates = ['id = ?'];
  const parameters: Array<string | null> = [
    args.status,
    serializedJson(args.lastError),
    args.status,
    args.id,
  ];
  if (args.expectedStatus !== undefined) {
    predicates.push('status = ?');
    parameters.push(args.expectedStatus);
  }
  const result = await (await portal.db.prepare(`
    UPDATE db_resource_drafts
    SET
      status = ?,
      last_error_json = ?,
      updated_at_sec = CURRENT_TIMESTAMP,
      applied_at_sec = CASE WHEN ? = 'applied' THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE ${predicates.join(' AND ')}
  `)).run(...parameters);
  return result.changes === 0 ? null : fxDbResourceDraftGet(portal, { id: args.id });
}

export async function txDbResourceDraftAppendChange(
  portal: TPortal,
  args: TArgsDraftAppendChange,
): Promise<TDbResourceDraftChange> {
  return txRunDatabaseTransaction({ database: portal.db }, {
    mode: 'deferred',
    operation: async () => {
      const draft = await fxDbResourceDraftGet(portal, { id: args.draftId });
      if (!draft || draft.status !== 'editing') {
        throw new Error(`DbResource draft '${args.draftId}' is not editable.`);
      }
      const sequenceRow = await (await portal.db.prepare(`
        SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
        FROM db_resource_draft_changes
        WHERE draft_id = ?
      `)).get(args.draftId) as { next_sequence: number } | undefined;
      if ((sequenceRow?.next_sequence ?? 1) !== args.sequence) {
        throw new Error(`DbResource draft '${args.draftId}' physical and control sequences diverged.`);
      }
      await (await portal.db.prepare(`
        INSERT INTO db_resource_draft_changes (
          draft_id, sequence, kind, operation_json, sql_text
        ) VALUES (?, ?, ?, ?, ?)
      `)).run(
        args.draftId,
        args.sequence,
        args.kind,
        serializedJson(args.operation),
        args.sql,
      );
      const row = await (await portal.db.prepare(`
        SELECT * FROM db_resource_draft_changes
        WHERE draft_id = ? AND sequence = ?
      `)).get(args.draftId, args.sequence);
      if (row == null) throw new Error('Failed to persist DbResource draft change.');
      return fnParseDbResourceDraftChangeRow(row);
    },
  });
}

export async function txDbResourceDraftDiscard(
  portal: TPortal,
  args: TArgsDraftDiscard,
): Promise<TDbResourceDraft | null> {
  const result = await (await portal.db.prepare(`
    UPDATE db_resource_drafts
    SET
      status = 'discarded',
      last_error_json = ?,
      applied_at_sec = NULL,
      updated_at_sec = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('editing', 'error')
  `)).run(serializedJson(args.lastError), args.id);
  return result.changes === 0 ? null : fxDbResourceDraftGet(portal, { id: args.id });
}

export async function txDbResourceApplyCreate(
  portal: TPortal,
  args: TArgsApplyCreate,
): Promise<TDbResourceApplyRun> {
  await requireDbResource(portal, args.resourceId, ['ready', 'migrating']);
  if (args.draftId != null) {
    const draft = await fxDbResourceDraftGet(portal, { id: args.draftId });
    if (!draft || draft.resourceId !== args.resourceId || !['editing', 'applying'].includes(draft.status)) {
      throw new Error(`DbResource draft '${args.draftId}' is not active for resource '${args.resourceId}'.`);
    }
  }
  if (args.sourceApplyId != null) {
    const source = await fxDbResourceApplyGet(portal, { id: args.sourceApplyId });
    if (!source || source.resourceId !== args.resourceId || !source.backupRetained) {
      throw new Error(`DbResource retained backup '${args.sourceApplyId}' is unavailable.`);
    }
  }
  if (args.draftId != null && args.sourceApplyId != null) {
    throw new Error('DbResource work cannot be both a draft apply and a backup restore.');
  }
  const status = args.status ?? 'preparing';
  await (await portal.db.prepare(`
    INSERT INTO db_resource_apply_runs (
      id, resource_id, draft_id, source_apply_id, status,
      last_error_json, backup_retained, completed_at_sec
    ) VALUES (
      ?, ?, ?, ?, ?, NULL, false,
      CASE WHEN ? IN ('succeeded', 'failed', 'recovered') THEN CURRENT_TIMESTAMP ELSE NULL END
    )
  `)).run(
    args.id,
    args.resourceId,
    args.draftId ?? null,
    args.sourceApplyId ?? null,
    status,
    status,
  );
  const apply = await fxDbResourceApplyGet(portal, { id: args.id });
  if (!apply) throw new Error(`Failed to create DbResource apply '${args.id}'.`);
  return apply;
}

export async function txDbResourceApplyCreateFromDraft(
  portal: TPortal,
  args: TArgsApplyCreateFromDraft,
): Promise<{ apply: TDbResourceApplyRun; draft: TDbResourceDraft }> {
  return txRunDatabaseTransaction({ database: portal.db }, {
    mode: 'deferred',
    operation: async () => {
      await requireDbResource(portal, args.resourceId, ['ready']);
      const draft = await fxDbResourceDraftGet(portal, { id: args.draftId });
      if (!draft || draft.resourceId !== args.resourceId || draft.status !== 'editing') {
        throw new Error(`DbResource draft '${args.draftId}' is not editable for this resource.`);
      }
      const updatedDraft = await txDbResourceDraftUpdateStatus(portal, {
        id: args.draftId,
        status: 'applying',
        expectedStatus: 'editing',
        lastError: null,
      });
      if (!updatedDraft) throw new Error(`DbResource draft '${args.draftId}' changed before apply.`);
      const apply = await txDbResourceApplyCreate(portal, {
        id: args.id,
        resourceId: args.resourceId,
        draftId: args.draftId,
        status: 'preparing',
      });
      return { apply, draft: updatedDraft };
    },
  });
}

export async function txDbResourceApplyFinishWithDraft(
  portal: TPortal,
  args: TArgsApplyFinishWithDraft,
): Promise<{ apply: TDbResourceApplyRun; draft: TDbResourceDraft }> {
  return txRunDatabaseTransaction({ database: portal.db }, {
    mode: 'deferred',
    operation: async () => {
      const apply = await txDbResourceApplyUpdate(portal, {
        id: args.id,
        status: args.status,
        expectedStatus: args.expectedStatus,
        lastError: args.lastError,
        backupRetained: args.backupRetained,
      });
      if (!apply || apply.draftId !== args.draftId) {
        throw new Error(`DbResource apply '${args.id}' changed before completion.`);
      }
      const draft = await txDbResourceDraftUpdateStatus(portal, {
        id: args.draftId,
        status: args.draftStatus,
        expectedStatus: 'applying',
        lastError: args.lastError,
      });
      if (!draft) throw new Error(`DbResource draft '${args.draftId}' changed before completion.`);
      return { apply, draft };
    },
  });
}

export async function txDbResourceApplyUpdate(
  portal: TPortal,
  args: TArgsApplyUpdate,
): Promise<TDbResourceApplyRun | null> {
  const terminal = ['succeeded', 'failed', 'recovered'].includes(args.status);
  const predicates = ['id = ?'];
  const parameters: Array<string | boolean | null> = [
    args.status,
    serializedJson(args.lastError),
    args.backupRetained ?? null,
    terminal,
    args.id,
  ];
  if (args.expectedStatus !== undefined) {
    predicates.push('status = ?');
    parameters.push(args.expectedStatus);
  }
  const result = await (await portal.db.prepare(`
    UPDATE db_resource_apply_runs
    SET
      status = ?,
      last_error_json = ?,
      backup_retained = COALESCE(?, backup_retained),
      completed_at_sec = CASE
        WHEN ? THEN COALESCE(completed_at_sec, CURRENT_TIMESTAMP)
        ELSE NULL
      END
    WHERE ${predicates.join(' AND ')}
  `)).run(...parameters);
  return result.changes === 0 ? null : fxDbResourceApplyGet(portal, { id: args.id });
}
