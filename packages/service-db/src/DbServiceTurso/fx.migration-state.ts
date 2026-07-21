import type { Database } from '@tursodatabase/database';
import {
  DATABASE_APPLICATION_ID,
  DATABASE_SCHEMA_VERSION,
  INITIAL_MIGRATION_NAME,
  MIGRATION_CHECKSUM_HEX_LENGTH,
} from '../CONSTANTS';
import type {
  TDatabasePreflightResult,
  TMigrationLedgerRow,
} from './migration-types';

type TPortal = {
  db: Database;
};

type TArgs = {
  checksumSha256: string;
  expectedApplicationTables: readonly string[];
};

type TPragmaTableListRow = {
  schema: string;
  name: string;
  type: string;
  strict: number;
};

function rowNumber(row: Record<string, unknown> | undefined, field: string): number {
  const value = row?.[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`Database preflight could not read integer PRAGMA ${field}.`);
  }
  return value;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function refusal(reason: string): Error {
  return new Error(
    `Refusing to open Vibecanvas database: ${reason} `
      + 'The database was inspected read-only and was not modified. '
      + 'Actor-era and unknown databases are not migrated; select a fresh Vibecanvas home.',
  );
}

async function fxPreflightMigrationState(
  portal: TPortal,
  args: TArgs,
): Promise<TDatabasePreflightResult> {
  if (!/^[0-9a-f]{64}$/.test(args.checksumSha256)) {
    throw new Error(`Expected a ${MIGRATION_CHECKSUM_HEX_LENGTH}-character lowercase SHA-256 checksum.`);
  }

  const [applicationIdRow, userVersionRow, tableRows] = await Promise.all([
    (await portal.db.prepare('PRAGMA application_id')).get() as Promise<Record<string, unknown> | undefined>,
    (await portal.db.prepare('PRAGMA user_version')).get() as Promise<Record<string, unknown> | undefined>,
    (await portal.db.prepare('PRAGMA table_list')).all() as Promise<TPragmaTableListRow[]>,
  ]);
  const applicationId = rowNumber(applicationIdRow, 'application_id');
  const userVersion = rowNumber(userVersionRow, 'user_version');
  const applicationTables = tableRows
    .filter((row) => row.schema === 'main' && row.type === 'table' && !row.name.startsWith('sqlite_'))
    .sort((left, right) => left.name.localeCompare(right.name));
  const applicationTableNames = applicationTables.map((row) => row.name);

  if (applicationTableNames.length === 0 && applicationId === 0 && userVersion === 0) {
    return { status: 'empty' };
  }

  if (applicationId !== DATABASE_APPLICATION_ID) {
    throw refusal(
      applicationId === 0
        ? `found a non-empty unknown or actor-era database with tables [${applicationTableNames.join(', ')}].`
        : `application_id is ${applicationId}, expected ${DATABASE_APPLICATION_ID}.`,
    );
  }

  if (userVersion !== DATABASE_SCHEMA_VERSION) {
    throw refusal(
      `managed database user_version is ${userVersion}, expected ${DATABASE_SCHEMA_VERSION}; `
        + 'the database is partial, newer than this binary, or corrupt.',
    );
  }

  const expectedTableNames = [...args.expectedApplicationTables].sort((left, right) => left.localeCompare(right));
  if (!sameStrings(applicationTableNames, expectedTableNames)) {
    throw refusal(
      `managed schema table manifest differs; found [${applicationTableNames.join(', ')}], `
        + `expected [${expectedTableNames.join(', ')}].`,
    );
  }

  const nonStrictTables = applicationTables.filter((row) => row.strict !== 1).map((row) => row.name);
  if (nonStrictTables.length > 0) {
    throw refusal(`managed schema has non-STRICT application tables [${nonStrictTables.join(', ')}].`);
  }

  let ledgerRows: TMigrationLedgerRow[];
  try {
    ledgerRows = await (
      await portal.db.prepare(`
        SELECT version, name, checksum_sha256, applied_at_ms, application_version
        FROM schema_migrations
        ORDER BY version
      `)
    ).all() as TMigrationLedgerRow[];
  } catch (error) {
    throw refusal(`managed migration ledger cannot be read (${error instanceof Error ? error.message : String(error)}).`);
  }

  if (ledgerRows.length !== 1) {
    throw refusal(`managed migration ledger has ${ledgerRows.length} rows; expected exactly one baseline row.`);
  }

  const migration = ledgerRows[0];
  if (
    migration.version !== DATABASE_SCHEMA_VERSION
    || migration.name !== INITIAL_MIGRATION_NAME
    || migration.checksum_sha256 !== args.checksumSha256
    || typeof migration.application_version !== 'string'
    || migration.application_version.length === 0
    || !Number.isSafeInteger(migration.applied_at_ms)
    || migration.applied_at_ms < 0
  ) {
    throw refusal('managed migration ledger metadata or immutable SHA-256 checksum does not match this binary.');
  }

  return { status: 'ready', migration };
}

export { fxPreflightMigrationState };
export type { TArgs as TMigrationPreflightArgs };
