import type { Database } from '@tursodatabase/database';
import {
  DATABASE_APPLICATION_ID,
  DATABASE_SCHEMA_VERSION,
} from '../CONSTANTS';
import { MIGRATION_FILES } from '../migrations/CONSTANTS';
import { txRunDatabaseTransaction } from '../tx.run-database-transaction';
import { fnFindTopLevelMigrationTransactionControl } from './fn.migration-sql-transaction-control';
import { fxReadDatabaseChecks } from './fx.database-checks';
import { fxReadMigrationFile } from './fx.migration-file';
import { fxPreflightMigrationState } from './fx.migration-state';
import type { TMigrationChecksum } from './migration-types';
import type {
  TExpectedDatabaseSchemaContract,
} from '../schema/expected-schema';
import {
  txAssertDatabasePragmas,
  txDefaultRunPragmas,
} from './tx.pragma';

type TPortal = {
  Bun: Pick<typeof Bun, 'CryptoHasher' | 'file'>;
  TextDecoder: typeof TextDecoder;
  db: Database;
};

type TArgs = {
  applicationVersion: string;
  appliedAtMs: number;
  expectedSchemaContracts: readonly TExpectedDatabaseSchemaContract[];
};

type TResolvedMigration = TMigrationChecksum & Readonly<{
  sql: string;
}>;

async function assertDatabaseChecks(db: Database): Promise<void> {
  const checks = await fxReadDatabaseChecks({ db }, {});
  if (!checks.ok) throw new Error(checks.failureMessage ?? 'Database integrity checks failed.');
}

async function resolveMigrations(portal: TPortal): Promise<readonly TResolvedMigration[]> {
  return Promise.all(MIGRATION_FILES.map(async (migration) => {
    const file = await fxReadMigrationFile(
      { Bun: portal.Bun, TextDecoder: portal.TextDecoder },
      { path: migration.path },
    );
    return {
      version: migration.version,
      name: migration.name,
      checksumSha256: file.checksumSha256,
      sql: file.sql,
    };
  }));
}

async function txRunMigrations(portal: TPortal, args: TArgs): Promise<{ applied: boolean }> {
  if (!args.applicationVersion.trim()) {
    throw new Error('Migration applicationVersion must not be empty.');
  }
  if (!Number.isSafeInteger(args.appliedAtMs) || args.appliedAtMs < 0) {
    throw new Error('Migration appliedAtMs must be a non-negative safe integer.');
  }

  const migrations = await resolveMigrations(portal);
  for (const migration of migrations) {
    const transactionControl = fnFindTopLevelMigrationTransactionControl(migration.sql);
    if (transactionControl) {
      throw new Error(
        `Refusing migration ${migration.name}: top-level transaction control statement `
          + `${transactionControl} would escape the managed migration transaction.`,
      );
    }
  }
  const preflightArgs = {
    migrations,
    expectedSchemaContracts: args.expectedSchemaContracts,
  } as const;
  const initialState = await fxPreflightMigrationState(
    { Bun: portal.Bun, db: portal.db },
    preflightArgs,
  );
  const initialVersion = initialState.status === 'empty' ? null : initialState.currentVersion;

  // Integrity checks must run before write-affecting connection pragmas. A
  // corrupt managed prefix is evidence to preserve, not a database to upgrade.
  await assertDatabaseChecks(portal.db);

  await txDefaultRunPragmas(
    { db: portal.db },
    { expectedUserVersion: initialVersion },
  );
  await txAssertDatabasePragmas(
    { db: portal.db },
    { expectedUserVersion: initialVersion },
  );

  if (initialState.status === 'ready') return { applied: false };

  const applied = await txRunDatabaseTransaction({ database: portal.db }, {
    foreignKeyEnforcement: 'disabled',
    operation: async () => {
      // The read-only preflight preserves unknown databases. Rechecking after the
      // immediate writer lock makes concurrent starters observe one ledger owner.
      const lockedState = await fxPreflightMigrationState(
        { Bun: portal.Bun, db: portal.db },
        preflightArgs,
      );
      await assertDatabaseChecks(portal.db);
      if (lockedState.status === 'ready') {
        await txAssertDatabasePragmas(
          { db: portal.db },
          { expectedForeignKeys: 0, expectedUserVersion: DATABASE_SCHEMA_VERSION },
        );
        return false;
      }

      const appliedCount = lockedState.status === 'empty'
        ? 0
        : lockedState.appliedMigrations.length;

      for (const migration of migrations.slice(appliedCount)) {
        await portal.db.exec(migration.sql);
        await (await portal.db.prepare(`
          INSERT INTO schema_migrations (
            version,
            name,
            checksum_sha256,
            applied_at_ms,
            application_version
          ) VALUES (?, ?, ?, ?, ?)
        `)).run(
          migration.version,
          migration.name,
          migration.checksumSha256,
          args.appliedAtMs,
          args.applicationVersion,
        );
      }
      await portal.db.exec(`
        PRAGMA application_id = ${DATABASE_APPLICATION_ID};
        PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
      `);

      // Validate the exact uncommitted result while the immediate lock is still
      // held. Throwing here rolls DDL, ledger, and header metadata back together.
      await txAssertDatabasePragmas(
        { db: portal.db },
        { expectedForeignKeys: 0, expectedUserVersion: DATABASE_SCHEMA_VERSION },
      );
      const committedState = await fxPreflightMigrationState(
        { Bun: portal.Bun, db: portal.db },
        preflightArgs,
      );
      if (committedState.status !== 'ready') {
        throw new Error(
          'Database migration transaction did not produce the latest valid managed migration state.',
        );
      }
      await assertDatabaseChecks(portal.db);
      return true;
    },
  });

  await txAssertDatabasePragmas(
    { db: portal.db },
    { expectedUserVersion: DATABASE_SCHEMA_VERSION },
  );
  const finalState = await fxPreflightMigrationState(
    { Bun: portal.Bun, db: portal.db },
    preflightArgs,
  );
  if (finalState.status !== 'ready') {
    throw new Error('Database migration completed without the latest valid managed migration state.');
  }
  await assertDatabaseChecks(portal.db);

  return { applied };
}

export { txRunMigrations };
