import { DATABASE_STATEMENTS } from '../statement-registry';
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
import { runDatabaseTransaction } from '../run-database-transaction';
import { fnSerializeJsonValue } from './fn.json';
import { fnParseDbResourceDraftChangeRow } from './fn.db-resource';
import { getDbResourceApply, getDbResourceDraft } from './read-db-resource';

type TEffects = { db: Database };
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
  effects: TEffects,
  resourceId: string,
  allowedStatuses: readonly string[],
): Promise<void> {
  const resource = await (await effects.db.prepare(DATABASE_STATEMENTS.dbResourceWriteReadResourceCatalog)).get(resourceId) as { kind?: unknown; status?: unknown } | null;
  if (!resource || resource.kind !== 'db' || !allowedStatuses.includes(String(resource.status))) {
    throw new Error(`Resource '${resourceId}' is not an available DbResource.`);
  }
}

export async function createDbResourceDraft(
  effects: TEffects,
  args: TArgsDraftCreate,
): Promise<TDbResourceDraft> {
  await requireDbResource(effects, args.resourceId, ['ready']);
  await (await effects.db.prepare(DATABASE_STATEMENTS.dbResourceWriteInsertDbResourceDrafts)).run(args.id, args.resourceId, args.name);
  const draft = await getDbResourceDraft(effects, { id: args.id });
  if (!draft) throw new Error(`Failed to create DbResource draft '${args.id}'.`);
  return draft;
}

export async function renameDbResourceDraft(
  effects: TEffects,
  args: TArgsDraftRename,
): Promise<TDbResourceDraft | null> {
  const result = await (await effects.db.prepare(DATABASE_STATEMENTS.dbResourceWriteUpdateDbResourceDrafts)).run(args.name, args.id);
  return result.changes === 0 ? null : getDbResourceDraft(effects, { id: args.id });
}

export async function updateDbResourceDraftStatus(
  effects: TEffects,
  args: TArgsDraftUpdateStatus,
): Promise<TDbResourceDraft | null> {
  const parameters: Array<string | null> = [
    args.status,
    serializedJson(args.lastError),
    args.status,
    args.id,
  ];
  if (args.expectedStatus !== undefined) {
    parameters.push(args.expectedStatus);
  }
  const result = await (await effects.db.prepare(
    args.expectedStatus === undefined
      ? DATABASE_STATEMENTS.dbResourceWriteUpdateDraftStatus
      : DATABASE_STATEMENTS.dbResourceWriteUpdateDraftStatusExpected,
  )).run(...parameters);
  return result.changes === 0 ? null : getDbResourceDraft(effects, { id: args.id });
}

export async function appendDbResourceDraftChange(
  effects: TEffects,
  args: TArgsDraftAppendChange,
): Promise<TDbResourceDraftChange> {
  return runDatabaseTransaction({ database: effects.db }, {
    mode: 'deferred',
    operation: async () => {
      const draft = await getDbResourceDraft(effects, { id: args.draftId });
      if (!draft || draft.status !== 'editing') {
        throw new Error(`DbResource draft '${args.draftId}' is not editable.`);
      }
      const sequenceRow = await (await effects.db.prepare(DATABASE_STATEMENTS.dbResourceWriteReadDbResourceDraftChanges)).get(args.draftId) as { next_sequence: number } | undefined;
      if ((sequenceRow?.next_sequence ?? 1) !== args.sequence) {
        throw new Error(`DbResource draft '${args.draftId}' physical and control sequences diverged.`);
      }
      await (await effects.db.prepare(DATABASE_STATEMENTS.dbResourceWriteInsertDbResourceDraftChanges)).run(
        args.draftId,
        args.sequence,
        args.kind,
        serializedJson(args.operation),
        args.sql,
      );
      const row = await (await effects.db.prepare(DATABASE_STATEMENTS.dbResourceWriteReadDbResourceDraftChanges2)).get(args.draftId, args.sequence);
      if (row == null) throw new Error('Failed to persist DbResource draft change.');
      return fnParseDbResourceDraftChangeRow(row);
    },
  });
}

export async function discardDbResourceDraft(
  effects: TEffects,
  args: TArgsDraftDiscard,
): Promise<TDbResourceDraft | null> {
  const result = await (await effects.db.prepare(DATABASE_STATEMENTS.dbResourceWriteUpdateDbResourceDrafts2)).run(serializedJson(args.lastError), args.id);
  return result.changes === 0 ? null : getDbResourceDraft(effects, { id: args.id });
}

export async function createDbResourceApply(
  effects: TEffects,
  args: TArgsApplyCreate,
): Promise<TDbResourceApplyRun> {
  await requireDbResource(effects, args.resourceId, ['ready', 'migrating']);
  if (args.draftId != null) {
    const draft = await getDbResourceDraft(effects, { id: args.draftId });
    if (!draft || draft.resourceId !== args.resourceId || !['editing', 'applying'].includes(draft.status)) {
      throw new Error(`DbResource draft '${args.draftId}' is not active for resource '${args.resourceId}'.`);
    }
  }
  if (args.sourceApplyId != null) {
    const source = await getDbResourceApply(effects, { id: args.sourceApplyId });
    if (!source || source.resourceId !== args.resourceId || !source.backupRetained) {
      throw new Error(`DbResource retained backup '${args.sourceApplyId}' is unavailable.`);
    }
  }
  if (args.draftId != null && args.sourceApplyId != null) {
    throw new Error('DbResource work cannot be both a draft apply and a backup restore.');
  }
  const status = args.status ?? 'preparing';
  await (await effects.db.prepare(DATABASE_STATEMENTS.dbResourceWriteInsertDbResourceApplyRuns)).run(
    args.id,
    args.resourceId,
    args.draftId ?? null,
    args.sourceApplyId ?? null,
    status,
    status,
  );
  const apply = await getDbResourceApply(effects, { id: args.id });
  if (!apply) throw new Error(`Failed to create DbResource apply '${args.id}'.`);
  return apply;
}

export async function createDbResourceApplyFromDraft(
  effects: TEffects,
  args: TArgsApplyCreateFromDraft,
): Promise<{ apply: TDbResourceApplyRun; draft: TDbResourceDraft }> {
  return runDatabaseTransaction({ database: effects.db }, {
    mode: 'deferred',
    operation: async () => {
      await requireDbResource(effects, args.resourceId, ['ready']);
      const draft = await getDbResourceDraft(effects, { id: args.draftId });
      if (!draft || draft.resourceId !== args.resourceId || draft.status !== 'editing') {
        throw new Error(`DbResource draft '${args.draftId}' is not editable for this resource.`);
      }
      const updatedDraft = await updateDbResourceDraftStatus(effects, {
        id: args.draftId,
        status: 'applying',
        expectedStatus: 'editing',
        lastError: null,
      });
      if (!updatedDraft) throw new Error(`DbResource draft '${args.draftId}' changed before apply.`);
      const apply = await createDbResourceApply(effects, {
        id: args.id,
        resourceId: args.resourceId,
        draftId: args.draftId,
        status: 'preparing',
      });
      return { apply, draft: updatedDraft };
    },
  });
}

export async function finishDbResourceApplyWithDraft(
  effects: TEffects,
  args: TArgsApplyFinishWithDraft,
): Promise<{ apply: TDbResourceApplyRun; draft: TDbResourceDraft }> {
  return runDatabaseTransaction({ database: effects.db }, {
    mode: 'deferred',
    operation: async () => {
      const apply = await updateDbResourceApply(effects, {
        id: args.id,
        status: args.status,
        expectedStatus: args.expectedStatus,
        lastError: args.lastError,
        backupRetained: args.backupRetained,
      });
      if (!apply || apply.draftId !== args.draftId) {
        throw new Error(`DbResource apply '${args.id}' changed before completion.`);
      }
      const draft = await updateDbResourceDraftStatus(effects, {
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

export async function updateDbResourceApply(
  effects: TEffects,
  args: TArgsApplyUpdate,
): Promise<TDbResourceApplyRun | null> {
  const terminal = ['succeeded', 'failed', 'recovered'].includes(args.status);
  const parameters: Array<string | boolean | null> = [
    args.status,
    serializedJson(args.lastError),
    args.backupRetained ?? null,
    terminal,
    args.id,
  ];
  if (args.expectedStatus !== undefined) {
    parameters.push(args.expectedStatus);
  }
  const result = await (await effects.db.prepare(
    args.expectedStatus === undefined
      ? DATABASE_STATEMENTS.dbResourceWriteUpdateApply
      : DATABASE_STATEMENTS.dbResourceWriteUpdateApplyExpected,
  )).run(...parameters);
  return result.changes === 0 ? null : getDbResourceApply(effects, { id: args.id });
}
