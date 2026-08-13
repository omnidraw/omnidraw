import {
  DATABASE_STATEMENTS,
  renderDatabaseStatement,
} from '../statement-registry';
import type { Database } from '@tursodatabase/database';
import {
  DATABASE_APPLICATION_ID,
  DATABASE_SCHEMA_VERSION,
} from '../CONSTANTS';
import { MIGRATION_FILES } from '../migrations/CONSTANTS';
import { runDatabaseTransaction } from '../run-database-transaction';
import { fnFindTopLevelMigrationTransactionControl } from './fn.migration-sql-transaction-control';
import { readDatabaseChecks } from './read-database-checks';
import { readMigrationFile } from './read-migration-file';
import { preflightMigrationState } from './preflight-migration-state';
import type { TMigrationChecksum } from './migration-types';
import type {
  TExpectedDatabaseSchemaContract,
} from '../schema/expected-schema';
import {
  assertDatabasePragmas,
  applyDefaultDatabasePragmas,
} from './database-pragmas';

type TEffects = {
  Bun: Pick<typeof Bun, 'CryptoHasher' | 'file'>;
  TextDecoder: typeof TextDecoder;
  db: Database;
};

type TArgs = {
  applicationVersion: string;
  expectedSchemaContracts: readonly TExpectedDatabaseSchemaContract[];
};

type TResolvedMigration = TMigrationChecksum & Readonly<{
  sql: string;
}>;

async function assertDatabaseChecks(db: Database): Promise<void> {
  const checks = await readDatabaseChecks({ db }, {});
  if (!checks.ok) throw new Error(checks.failureMessage ?? 'Database integrity checks failed.');
}

async function resolveMigrations(effects: TEffects): Promise<readonly TResolvedMigration[]> {
  return Promise.all(MIGRATION_FILES.map(async (migration) => {
    const file = await readMigrationFile(
      { Bun: effects.Bun, TextDecoder: effects.TextDecoder },
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

async function runMigrations(effects: TEffects, args: TArgs): Promise<{ applied: boolean }> {
  if (!args.applicationVersion.trim()) {
    throw new Error('Migration applicationVersion must not be empty.');
  }
  const migrations = await resolveMigrations(effects);
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
  const initialState = await preflightMigrationState(
    { Bun: effects.Bun, db: effects.db },
    preflightArgs,
  );
  const initialVersion = initialState.status === 'empty' ? null : initialState.currentVersion;

  // Integrity checks must run before write-affecting connection pragmas. A
  // corrupt managed prefix is evidence to preserve, not a database to upgrade.
  await assertDatabaseChecks(effects.db);

  await applyDefaultDatabasePragmas(
    { db: effects.db },
    { expectedUserVersion: initialVersion },
  );
  await assertDatabasePragmas(
    { db: effects.db },
    { expectedUserVersion: initialVersion },
  );

  if (initialState.status === 'ready') return { applied: false };

  const applied = await runDatabaseTransaction({ database: effects.db }, {
    foreignKeyEnforcement: 'disabled',
    operation: async () => {
      // The read-only preflight preserves unknown databases. Rechecking after the
      // immediate writer lock makes concurrent starters observe one ledger owner.
      const lockedState = await preflightMigrationState(
        { Bun: effects.Bun, db: effects.db },
        preflightArgs,
      );
      await assertDatabaseChecks(effects.db);
      if (lockedState.status === 'ready') {
        await assertDatabasePragmas(
          { db: effects.db },
          { expectedForeignKeys: 0, expectedUserVersion: DATABASE_SCHEMA_VERSION },
        );
        return false;
      }

      for (const migration of migrations) {
        await effects.db.exec(migration.sql);
        await (await effects.db.prepare(DATABASE_STATEMENTS.migrationInsertLedgerEntry)).run(
          migration.version,
          migration.name,
          migration.checksumSha256,
          args.applicationVersion,
        );
      }
      await effects.db.exec(renderDatabaseStatement('migrationSetApplicationId', {
        __APPLICATION_ID__: String(DATABASE_APPLICATION_ID),
      }));
      await effects.db.exec(renderDatabaseStatement('migrationSetUserVersion', {
        __USER_VERSION__: String(DATABASE_SCHEMA_VERSION),
      }));

      // Validate the exact uncommitted result while the immediate lock is still
      // held. Throwing here rolls DDL, ledger, and header metadata back together.
      await assertDatabasePragmas(
        { db: effects.db },
        { expectedForeignKeys: 0, expectedUserVersion: DATABASE_SCHEMA_VERSION },
      );
      const committedState = await preflightMigrationState(
        { Bun: effects.Bun, db: effects.db },
        preflightArgs,
      );
      if (committedState.status !== 'ready') {
        throw new Error(
          'Database migration transaction did not produce the latest valid managed migration state.',
        );
      }
      await assertDatabaseChecks(effects.db);
      return true;
    },
  });

  await assertDatabasePragmas(
    { db: effects.db },
    { expectedUserVersion: DATABASE_SCHEMA_VERSION },
  );
  const finalState = await preflightMigrationState(
    { Bun: effects.Bun, db: effects.db },
    preflightArgs,
  );
  if (finalState.status !== 'ready') {
    throw new Error('Database migration completed without the latest valid managed migration state.');
  }
  await assertDatabaseChecks(effects.db);

  return { applied };
}

export { runMigrations };
