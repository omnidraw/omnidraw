import type { Database } from '@tursodatabase/database';
import {
  DATABASE_APPLICATION_ID,
  DATABASE_SCHEMA_VERSION,
  MIGRATION_CHECKSUM_HEX_LENGTH,
} from '../CONSTANTS';
import type {
  TDatabasePreflightResult,
  TMigrationChecksum,
  TMigrationLedgerRow,
} from './migration-types';
import type {
  TExpectedDatabaseSchemaContract,
} from '../schema/expected-schema';
import { fxVerifyDatabaseSchemaContract } from './fx.database-schema-contract';

type TPortal = {
  Bun: Pick<typeof Bun, 'CryptoHasher'>;
  db: Database;
};

type TArgs = {
  expectedSchemaContracts: readonly TExpectedDatabaseSchemaContract[];
  migrations: readonly TMigrationChecksum[];
};

type TPragmaTableListRow = {
  schema: string;
  name: string;
  type: string;
  strict: number;
};

type TSchemaObjectRow = {
  name: string;
  type: 'table' | 'trigger' | 'view';
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

function assertMigrationRegistry(migrations: readonly TMigrationChecksum[]): void {
  if (migrations.length !== DATABASE_SCHEMA_VERSION + 1) {
    throw new Error(
      `Expected ${DATABASE_SCHEMA_VERSION + 1} registered migrations through version `
        + `${DATABASE_SCHEMA_VERSION}, found ${migrations.length}.`,
    );
  }

  for (const [index, migration] of migrations.entries()) {
    const expectedPrefix = `${String(index).padStart(3, '0')}-`;
    if (
      migration.version !== index
      || !migration.name.startsWith(expectedPrefix)
      || migration.name.length > 200
    ) {
      throw new Error(`Registered migration ${index} is not a contiguous immutable migration.`);
    }
    if (!/^[0-9a-f]{64}$/.test(migration.checksumSha256)) {
      throw new Error(
        `Expected migration ${index} to have a ${MIGRATION_CHECKSUM_HEX_LENGTH}-character `
          + 'lowercase SHA-256 checksum.',
      );
    }
  }
}

async function fxPreflightMigrationState(
  portal: TPortal,
  args: TArgs,
): Promise<TDatabasePreflightResult> {
  assertMigrationRegistry(args.migrations);
  if (args.expectedSchemaContracts.length !== args.migrations.length) {
    throw new Error(
      `Expected ${args.migrations.length} versioned schema contracts, found `
        + `${args.expectedSchemaContracts.length}.`,
    );
  }
  for (const [version, contract] of args.expectedSchemaContracts.entries()) {
    if (
      contract.version !== version
      || !/^[0-9a-f]{64}$/.test(contract.fingerprintSha256)
    ) {
      throw new Error(
        `Checked-in schema contract ${version} must have its contiguous version and lowercase `
          + 'SHA-256 fingerprint.',
      );
    }
  }

  const [applicationIdRow, userVersionRow, tableRows, schemaObjectRows] = await Promise.all([
    (await portal.db.prepare('PRAGMA application_id')).get() as Promise<Record<string, unknown> | undefined>,
    (await portal.db.prepare('PRAGMA user_version')).get() as Promise<Record<string, unknown> | undefined>,
    (await portal.db.prepare('PRAGMA table_list')).all() as Promise<TPragmaTableListRow[]>,
    (await portal.db.prepare(`
      SELECT type, name
      FROM sqlite_schema
      WHERE type IN ('table', 'view', 'trigger')
        AND name NOT GLOB 'sqlite_*'
      ORDER BY type, name
    `)).all() as Promise<TSchemaObjectRow[]>,
  ]);
  const applicationId = rowNumber(applicationIdRow, 'application_id');
  const userVersion = rowNumber(userVersionRow, 'user_version');
  const mainSchemaRows = tableRows
    .filter((row) => row.schema === 'main' && !row.name.startsWith('sqlite_'));
  const userSchemaRows = mainSchemaRows
    .filter((row) => !row.name.startsWith('__turso_internal_'));
  const unsupportedTableRows = mainSchemaRows
    .filter((row) => row.type !== 'table' && row.type !== 'view')
    .map((row) => `${row.type}:${row.name}`)
    .sort((left, right) => left.localeCompare(right));
  if (unsupportedTableRows.length > 0) {
    throw refusal(
      `found unsupported main-schema table-list objects [${unsupportedTableRows.join(', ')}].`,
    );
  }
  const applicationTables = userSchemaRows
    .filter((row) => row.type === 'table')
    .sort((left, right) => left.name.localeCompare(right.name));
  const tableListApplicationTableNames = applicationTables.map((row) => row.name);
  const applicationTableNames = schemaObjectRows
    .filter((row) => row.type === 'table' && !row.name.startsWith('__turso_internal_'))
    .map((row) => row.name);
  const applicationViews = schemaObjectRows
    .filter((row) => row.type === 'view')
    .map((row) => row.name);
  const applicationTriggers = schemaObjectRows
    .filter((row) => row.type === 'trigger')
    .map((row) => row.name);

  if (
    schemaObjectRows.length === 0
    && mainSchemaRows.length === 0
    && applicationId === 0
    && userVersion === 0
  ) {
    return { status: 'empty' };
  }

  if (applicationId !== DATABASE_APPLICATION_ID) {
    throw refusal(
      applicationId === 0
        ? `found a non-empty unknown or actor-era database with tables `
          + `[${applicationTableNames.join(', ')}], views [${applicationViews.join(', ')}], `
          + `and triggers [${applicationTriggers.join(', ')}].`
        : `application_id is ${applicationId}, expected ${DATABASE_APPLICATION_ID}.`,
    );
  }

  if (userVersion < 0 || userVersion > DATABASE_SCHEMA_VERSION) {
    throw refusal(
      `managed database user_version is ${userVersion}, but this binary supports versions 0 through `
        + `${DATABASE_SCHEMA_VERSION}; the database is newer than this binary or corrupt.`,
    );
  }

  const expectedSchemaContract = args.expectedSchemaContracts[userVersion];
  if (!expectedSchemaContract) {
    throw new Error(`Missing checked-in schema contract for database version ${userVersion}.`);
  }
  const expectedTableNames = Object.keys(expectedSchemaContract.tables)
    .sort((left, right) => left.localeCompare(right));
  if (
    !sameStrings(applicationTableNames, expectedTableNames)
    || !sameStrings(tableListApplicationTableNames, expectedTableNames)
  ) {
    throw refusal(
      `managed schema table manifest differs; found [${applicationTableNames.join(', ')}], `
        + `table-list [${tableListApplicationTableNames.join(', ')}], expected `
        + `[${expectedTableNames.join(', ')}].`,
    );
  }

  const expectedViews = [...expectedSchemaContract.objects.views]
    .sort((left, right) => left.localeCompare(right));
  const expectedTriggers = [...expectedSchemaContract.objects.triggers]
    .sort((left, right) => left.localeCompare(right));
  if (
    !sameStrings(applicationViews, expectedViews)
    || !sameStrings(applicationTriggers, expectedTriggers)
  ) {
    throw refusal(
      `managed schema object manifest differs; found views [${applicationViews.join(', ')}] and `
        + `triggers [${applicationTriggers.join(', ')}], expected views `
        + `[${expectedViews.join(', ')}] and triggers [${expectedTriggers.join(', ')}].`,
    );
  }

  const nonStrictTables = applicationTables.filter((row) => row.strict !== 1).map((row) => row.name);
  if (nonStrictTables.length > 0) {
    throw refusal(`managed schema has non-STRICT application tables [${nonStrictTables.join(', ')}].`);
  }

  let schemaContract;
  try {
    schemaContract = await fxVerifyDatabaseSchemaContract(
      { Bun: portal.Bun, db: portal.db },
      {
        expectedFingerprintSha256: expectedSchemaContract.fingerprintSha256,
        expectedIndexes: expectedSchemaContract.indexes,
        expectedSchema: expectedSchemaContract.tables,
      },
    );
  } catch (error) {
    throw refusal(
      `managed schema contract cannot be read (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (!schemaContract.valid) {
    throw refusal(`managed schema contract differs: ${schemaContract.reason}.`);
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

  const expectedLedgerRows = userVersion + 1;
  if (ledgerRows.length !== expectedLedgerRows) {
    throw refusal(
      `managed migration ledger has ${ledgerRows.length} rows for user_version ${userVersion}; `
        + `expected contiguous versions 0 through ${userVersion}.`,
    );
  }

  for (let version = 0; version <= userVersion; version += 1) {
    const migration = ledgerRows[version];
    const expected = args.migrations[version];
    if (!migration || !expected || migration.version !== version) {
      throw refusal(`managed migration ledger is missing contiguous version ${version}.`);
    }
    if (
      migration.name !== expected.name
      || migration.checksum_sha256 !== expected.checksumSha256
      || typeof migration.application_version !== 'string'
      || migration.application_version.trim().length === 0
      || migration.application_version.trim().length > 100
      || !Number.isSafeInteger(migration.applied_at_ms)
      || migration.applied_at_ms < 0
    ) {
      throw refusal(
        `managed migration ledger metadata or immutable SHA-256 checksum for version ${version} `
          + 'does not match this binary.',
      );
    }
  }

  const appliedMigrations = Object.freeze([...ledgerRows]);
  return userVersion === DATABASE_SCHEMA_VERSION
    ? { status: 'ready', currentVersion: userVersion, appliedMigrations }
    : { status: 'pending', currentVersion: userVersion, appliedMigrations };
}

export { fxPreflightMigrationState };
export type { TArgs as TMigrationPreflightArgs };
