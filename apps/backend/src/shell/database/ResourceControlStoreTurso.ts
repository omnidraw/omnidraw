import {
  DATABASE_STATEMENTS,
  databaseParameterPlaceholders,
  renderDatabaseStatement,
} from './statement-registry';
import type { Database } from '@tursodatabase/database';
import type {
  IResourceControlStore,
  TCreateDbResourceApplyRequest,
  TCreateDbResourceBackupRequest,
  TCreateDbResourceDraftChangeRequest,
  TCreateDbResourceDraftRequest,
  TCreateResourceRequest,
  TDbResourceApplyRun,
  TDbResourceBackup,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TDbResourceDraftStatus,
  TReserveResourcePlacementRequest,
  TResourceDescriptor,
  TResourceId,
  TResourceListFilter,
  TResourcePlacement,
  TSafeResourceError,
  TUpdateResourcePlacementRequest,
  TUpdateResourceStateRequest,
} from '#backend/shell/resources';
import { fnNormalizeResourceName, fnResourceNameKey } from '#backend/core/database/fn.resource-name';
import {
  fnResourceControlStoreDbApply,
  fnResourceControlStoreDbBackup,
  fnResourceControlStoreDbDraft,
  fnResourceControlStoreDbDraftChange,
  fnResourceControlStoreDescriptor,
  fnResourceControlStorePlacement,
  fnResourceControlStoreSerializeJson,
} from './ResourceControlStoreTurso/fn.resource-control-store-row';
import {
  runDatabaseTransaction,
  runDatabaseWrite,
} from './run-database-transaction';

type TExpectedStatus = string | readonly string[];

const DB_DRAFT_LIST_DEFAULT_LIMIT = 50;
const DB_DRAFT_LIST_MAX_LIMIT = 200;
const DB_APPLY_LIST_DEFAULT_LIMIT = 20;
const DB_APPLY_LIST_MAX_LIMIT = 100;

function resourceNameError(
  code: 'RESOURCE_NAME_INVALID' | 'RESOURCE_NAME_CONFLICT',
  message: string,
): Error {
  return Object.assign(new Error(message), { code });
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function assertTimestampSec(value: string, label: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new TypeError(`${label} must be a canonical UTC whole-second timestamp.`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    month < 1
    || month > 12
    || day < 1
    || day > (daysInMonth[month - 1] ?? 0)
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    throw new TypeError(`${label} must be a valid UTC whole-second timestamp.`);
  }
}

function assertNullableTimestampSec(value: string | null, label: string): void {
  if (value !== null) assertTimestampSec(value, label);
}

/** Turso-backed implementation of the single-user resource control-plane SPI. */
export class ResourceControlStoreTurso implements IResourceControlStore {
  constructor(private readonly database: Database) {}

  async listResources(
    filter: TResourceListFilter = {},
  ): Promise<readonly TResourceDescriptor[]> {
    const parameters: string[] = [];
    if (filter.kind !== undefined) {
      parameters.push(filter.kind);
    }
    if (filter.status !== undefined) {
      parameters.push(filter.status);
    }
    const statement = filter.kind === undefined
      ? filter.status === undefined
        ? DATABASE_STATEMENTS.resourceControlListAll
        : DATABASE_STATEMENTS.resourceControlListByStatus
      : filter.status === undefined
        ? DATABASE_STATEMENTS.resourceControlListByKind
        : DATABASE_STATEMENTS.resourceControlListByKindAndStatus;
    const rows = await (await this.database.prepare(statement)).all(...parameters);
    return rows.map(fnResourceControlStoreDescriptor);
  }

  async getResource(resourceId: TResourceId): Promise<TResourceDescriptor | null> {
    const row = await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlReadResourceCatalog)).get(resourceId);
    return row ? fnResourceControlStoreDescriptor(row) : null;
  }

  async createResource(request: TCreateResourceRequest): Promise<TResourceDescriptor> {
    try {
      return await runDatabaseTransaction({ database: this.database }, {
        operation: async () => {
          const name = await this.#availableResourceName(request.name);
          await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlInsertResourceCatalog)).run(request.id, request.kind, name);
          await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlInsertResourcePlacements)).run(
            request.id,
            request.cellId,
            request.placementEpoch,
            request.storageKey,
          );
          const created = await this.getResource(request.id);
          if (!created) throw new Error(`Failed to create resource '${request.id}'.`);
          return created;
        },
      });
    } catch (error) {
      this.#rethrowResourceNameConflict(error, request.name);
    }
  }

  async renameResource(
    request: Readonly<{ resourceId: TResourceId; name: string }>,
  ): Promise<TResourceDescriptor | null> {
    try {
      return await runDatabaseTransaction({ database: this.database }, {
        operation: async () => {
          if (!await this.getResource(request.resourceId)) return null;
          const name = await this.#availableResourceName(request.name, request.resourceId);
          const result = await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlUpdateResourceCatalog)).run(name, request.resourceId);
          return result.changes === 0 ? null : this.getResource(request.resourceId);
        },
      });
    } catch (error) {
      this.#rethrowResourceNameConflict(error, request.name);
    }
  }

  async updateResourceState(
    request: TUpdateResourceStateRequest,
  ): Promise<TResourceDescriptor | null> {
    const expected = this.#expectedStatuses(request.expectedStatus);
    if (expected.length === 0) return null;
    const result = await this.#runWrite(async () => (
      (await this.database.prepare(renderDatabaseStatement('resourceControlUpdateState', {
        __EXPECTED_STATUSES__: databaseParameterPlaceholders(expected.length),
      }))).run(
        request.status,
        fnResourceControlStoreSerializeJson(request.lastError),
        request.resourceId,
        ...expected,
      )
    ));
    return result.changes === 0 ? null : this.getResource(request.resourceId);
  }

  async deleteResource(resourceId: TResourceId): Promise<boolean> {
    return runDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        const eligible = await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlReadResourceCatalog2)).get(resourceId);
        if (!eligible) return false;
        await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlDeleteDbResourceBackups)).run(resourceId);
        await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlUpdateDbResourceApplyRuns)).run(resourceId);
        await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlDeleteDbResourceApplyRuns)).run(resourceId);
        const result = await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlDeleteResourceCatalog)).run(resourceId);
        return result.changes > 0;
      },
    });
  }

  async getPlacement(resourceId: TResourceId): Promise<TResourcePlacement | null> {
    const row = await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlReadResourcePlacements)).get(resourceId);
    return row ? fnResourceControlStorePlacement(row) : null;
  }

  async reservePlacement(request: TReserveResourcePlacementRequest): Promise<TResourcePlacement> {
    await this.#runWrite(async () => (
      (await this.database.prepare(DATABASE_STATEMENTS.resourceControlInsertResourcePlacements)).run(
        request.resourceId,
        request.cellId,
        request.placementEpoch,
        request.storageKey,
      )
    ));
    const placement = await this.getPlacement(request.resourceId);
    if (!placement) throw new Error(`Failed to reserve placement for resource '${request.resourceId}'.`);
    return placement;
  }

  async updatePlacement(
    request: TUpdateResourcePlacementRequest,
  ): Promise<TResourcePlacement | null> {
    const result = await this.#runWrite(async () => (
      (await this.database.prepare(DATABASE_STATEMENTS.resourceControlUpdateResourcePlacements)).run(
        request.cellId,
        request.placementEpoch,
        request.storageKey,
        request.status,
        request.resourceId,
        request.expectedEpoch,
      )
    ));
    return result.changes === 0 ? null : this.getPlacement(request.resourceId);
  }

  async deletePlacement(resourceId: TResourceId): Promise<boolean> {
    const result = await this.#runWrite(async () => (
      (await this.database.prepare(DATABASE_STATEMENTS.resourceControlDeleteResourcePlacements))
        .run(resourceId)
    ));
    return result.changes > 0;
  }

  async createDbDraft(draft: TCreateDbResourceDraftRequest): Promise<TDbResourceDraft> {
    assertNullableTimestampSec(draft.appliedAtSec, 'DB resource draft appliedAtSec');
    await runDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        await this.#assertDbResource(draft.resourceId, ['ready']);
        await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlInsertDbResourceDrafts)).run(
          draft.id,
          draft.resourceId,
          draft.name,
          draft.status,
          fnResourceControlStoreSerializeJson(draft.lastError),
          draft.appliedAtSec,
        );
      },
    });
    const stored = await this.getDbDraft(draft.id);
    if (!stored) throw new Error(`Failed to create DB resource draft '${draft.id}'.`);
    return stored;
  }

  async getDbDraft(draftId: string): Promise<TDbResourceDraft | null> {
    const row = await (await this.database.prepare(DATABASE_STATEMENTS.dbResourceReadReadDbResourceDrafts)).get(draftId);
    return row ? fnResourceControlStoreDbDraft(row) : null;
  }

  async listDbDrafts(
    request: Readonly<{ resourceId: TResourceId; status?: TDbResourceDraftStatus; limit?: number }>,
  ): Promise<readonly TDbResourceDraft[]> {
    const limit = this.#listLimit(
      request.limit,
      DB_DRAFT_LIST_DEFAULT_LIMIT,
      DB_DRAFT_LIST_MAX_LIMIT,
      'DB resource draft',
    );
    const rows = request.status === undefined
      ? await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlReadDbResourceDrafts)).all(request.resourceId, limit)
      : await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlReadDbResourceDrafts2)).all(request.resourceId, request.status, limit);
    return rows.map(fnResourceControlStoreDbDraft);
  }

  async updateDbDraft(request: Readonly<{
    draftId: string;
    expectedStatus: TDbResourceDraftStatus | readonly TDbResourceDraftStatus[];
    status: TDbResourceDraftStatus;
    lastError: TSafeResourceError | null;
    appliedAtSec: string | null;
  }>): Promise<TDbResourceDraft | null> {
    assertNullableTimestampSec(request.appliedAtSec, 'DB resource draft appliedAtSec');
    const expected = this.#expectedStatuses(request.expectedStatus);
    if (expected.length === 0) return null;
    const result = await this.#runWrite(async () => (
      (await this.database.prepare(renderDatabaseStatement('resourceControlUpdateDraft', {
        __EXPECTED_STATUSES__: databaseParameterPlaceholders(expected.length),
      }))).run(
        request.status,
        fnResourceControlStoreSerializeJson(request.lastError),
        request.appliedAtSec,
        request.draftId,
        ...expected,
      )
    ));
    return result.changes === 0 ? null : this.getDbDraft(request.draftId);
  }

  async appendDbDraftChange(
    change: TCreateDbResourceDraftChangeRequest,
  ): Promise<TDbResourceDraftChange> {
    await this.#runWrite(async () => (
      (await this.database.prepare(DATABASE_STATEMENTS.dbResourceWriteInsertDbResourceDraftChanges)).run(
        change.draftId,
        change.sequence,
        change.kind,
        fnResourceControlStoreSerializeJson(change.operation),
        change.sql,
      )
    ));
    const row = await (await this.database.prepare(DATABASE_STATEMENTS.dbResourceWriteReadDbResourceDraftChanges2)).get(change.draftId, change.sequence);
    if (!row) throw new Error(`Failed to append DB resource draft change '${change.sequence}'.`);
    return fnResourceControlStoreDbDraftChange(row);
  }

  async listDbDraftChanges(draftId: string): Promise<readonly TDbResourceDraftChange[]> {
    const rows = await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlReadDbResourceDraftChanges)).all(draftId);
    return rows.map(fnResourceControlStoreDbDraftChange);
  }

  async createDbApply(apply: TCreateDbResourceApplyRequest): Promise<TDbResourceApplyRun> {
    assertNullableTimestampSec(apply.completedAtSec, 'DB resource apply completedAtSec');
    await runDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        await this.#assertDbResource(apply.resourceId, ['ready', 'migrating']);
        await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlInsertDbResourceApplyRuns)).run(
          apply.id,
          apply.resourceId,
          apply.draftId,
          apply.sourceApplyId,
          apply.status,
          fnResourceControlStoreSerializeJson(apply.lastError),
          apply.backupRetained,
          apply.completedAtSec,
        );
      },
    });
    const stored = await this.getDbApply(apply.id);
    if (!stored) throw new Error(`Failed to create DB resource apply run '${apply.id}'.`);
    return stored;
  }

  async getDbApply(applyId: string): Promise<TDbResourceApplyRun | null> {
    const row = await (await this.database.prepare(DATABASE_STATEMENTS.dbResourceReadReadDbResourceApplyRuns)).get(applyId);
    return row ? fnResourceControlStoreDbApply(row) : null;
  }

  async listDbApplies(
    request: Readonly<{ resourceId: TResourceId; limit?: number }>,
  ): Promise<readonly TDbResourceApplyRun[]> {
    const limit = this.#listLimit(
      request.limit,
      DB_APPLY_LIST_DEFAULT_LIMIT,
      DB_APPLY_LIST_MAX_LIMIT,
      'DB resource apply',
    );
    const rows = await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlReadDbResourceApplyRuns)).all(request.resourceId, limit);
    return rows.map(fnResourceControlStoreDbApply);
  }

  async updateDbApply(request: Readonly<{
    applyId: string;
    expectedStatus: TDbResourceApplyRun['status'] | readonly TDbResourceApplyRun['status'][];
    status: TDbResourceApplyRun['status'];
    lastError: TSafeResourceError | null;
    backupRetained: boolean;
    completedAtSec: string | null;
  }>): Promise<TDbResourceApplyRun | null> {
    assertNullableTimestampSec(request.completedAtSec, 'DB resource apply completedAtSec');
    const expected = this.#expectedStatuses(request.expectedStatus);
    if (expected.length === 0) return null;
    const result = await this.#runWrite(async () => (
      (await this.database.prepare(renderDatabaseStatement('resourceControlUpdateApply', {
        __EXPECTED_STATUSES__: databaseParameterPlaceholders(expected.length),
      }))).run(
        request.status,
        fnResourceControlStoreSerializeJson(request.lastError),
        request.backupRetained,
        request.completedAtSec,
        request.applyId,
        ...expected,
      )
    ));
    return result.changes === 0 ? null : this.getDbApply(request.applyId);
  }

  async createDbBackup(backup: TCreateDbResourceBackupRequest): Promise<TDbResourceBackup> {
    assertTimestampSec(backup.verifiedAtSec, 'DB resource backup verifiedAtSec');
    assertNullableTimestampSec(backup.deleteAfterSec, 'DB resource backup deleteAfterSec');
    await runDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        await this.#assertDbResource(backup.resourceId, ['ready', 'migrating']);
        await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlInsertDbResourceBackups)).run(
          backup.id,
          backup.resourceId,
          backup.applyRunId,
          backup.storageKey,
          backup.digestSha256,
          backup.byteSize,
          backup.state,
          backup.verifiedAtSec,
          backup.deleteAfterSec,
        );
      },
    });
    const stored = await this.getDbBackup({
      resourceId: backup.resourceId,
      applyRunId: backup.applyRunId,
    });
    if (!stored) throw new Error(`Failed to create DB resource backup '${backup.id}'.`);
    return stored;
  }

  async getDbBackup(
    request: Readonly<{ resourceId: TResourceId; applyRunId: string }>,
  ): Promise<TDbResourceBackup | null> {
    const row = await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlReadDbResourceBackups)).get(request.resourceId, request.applyRunId);
    return row ? fnResourceControlStoreDbBackup(row) : null;
  }

  async listDbBackups(resourceId: TResourceId): Promise<readonly TDbResourceBackup[]> {
    const rows = await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlReadDbResourceBackups2)).all(resourceId);
    return rows.map(fnResourceControlStoreDbBackup);
  }

  async updateDbBackup(backup: TDbResourceBackup): Promise<TDbResourceBackup | null> {
    assertTimestampSec(backup.verifiedAtSec, 'DB resource backup verifiedAtSec');
    assertNullableTimestampSec(backup.deleteAfterSec, 'DB resource backup deleteAfterSec');
    const result = await this.#runWrite(async () => (
      (await this.database.prepare(DATABASE_STATEMENTS.resourceControlUpdateDbResourceBackups)).run(
        backup.resourceId,
        backup.applyRunId,
        backup.storageKey,
        backup.digestSha256,
        backup.byteSize,
        backup.state,
        backup.verifiedAtSec,
        backup.deleteAfterSec,
        backup.id,
      )
    ));
    if (result.changes === 0) return null;
    return this.getDbBackup({
      resourceId: backup.resourceId,
      applyRunId: backup.applyRunId,
    });
  }

  async #availableResourceName(
    candidate: string,
    excludingResourceId?: string,
  ): Promise<string> {
    const normalized = fnNormalizeResourceName(candidate);
    if (!normalized.ok) throw resourceNameError(normalized.code, normalized.message);
    const rows = await (await this.database.prepare(DATABASE_STATEMENTS.resourceControlReadResourceCatalog3)).all() as { id: string; name: string }[];
    if (rows.some((row) => (
      row.id !== excludingResourceId
      && fnResourceNameKey(row.name) === normalized.value.key
    ))) {
      throw resourceNameError(
        'RESOURCE_NAME_CONFLICT',
        `Resource name '${normalized.value.name}' is already in use.`,
      );
    }
    return normalized.value.name;
  }

  async #assertDbResource(resourceId: TResourceId, allowedStatuses: readonly string[]): Promise<void> {
    const row = await (await this.database.prepare(DATABASE_STATEMENTS.dbResourceWriteReadResourceCatalog)).get(resourceId) as { kind?: unknown; status?: unknown } | null;
    if (
      row?.kind !== 'db'
      || typeof row.status !== 'string'
      || !allowedStatuses.includes(row.status)
    ) {
      throw new Error(`Resource '${resourceId}' is not an available DbResource.`);
    }
  }

  #runWrite<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    return runDatabaseWrite({ database: this.database }, { operation });
  }

  #rethrowResourceNameConflict(error: unknown, name: string): never {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE constraint failed: resource_catalog.name')) {
      throw resourceNameError('RESOURCE_NAME_CONFLICT', `Resource name '${name}' is already in use.`);
    }
    throw error;
  }

  #expectedStatuses(status: TExpectedStatus): readonly string[] {
    return typeof status === 'string' ? [status] : status;
  }

  #listLimit(limit: number | undefined, fallback: number, maximum: number, label: string): number {
    const resolved = limit ?? fallback;
    if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
      throw new RangeError(`${label} list limit must be between 1 and ${maximum}.`);
    }
    return resolved;
  }
}
