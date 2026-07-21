import type { Database } from '@tursodatabase/database';
import {
  DATABASE_APPLICATION_ID,
  DATABASE_SCHEMA_VERSION,
} from '../CONSTANTS';
import { INITIAL_MIGRATION } from '../migrations/CONSTANTS';
import { fxReadMigrationFile } from './fx.migration-file';
import { fxPreflightMigrationState } from './fx.migration-state';
import {
  txAssertDatabasePragmas,
  txDefaultRunPragmas,
} from './tx.pragma';

type TPortal = {
  Bun: Pick<typeof Bun, 'CryptoHasher' | 'file'>;
  db: Database;
};

type TArgs = {
  applicationVersion: string;
  appliedAtMs: number;
  expectedApplicationTables: readonly string[];
};

type TImmediateTransaction = (() => Promise<void>) & {
  immediate: () => Promise<void>;
};

async function assertDatabaseChecks(db: Database): Promise<void> {
  const [integrityRow, quickRow] = await Promise.all([
    (await db.prepare('PRAGMA integrity_check')).get(),
    (await db.prepare('PRAGMA quick_check')).get(),
  ]) as [Record<string, unknown> | undefined, Record<string, unknown> | undefined];

  if (integrityRow?.integrity_check !== 'ok') {
    throw new Error(`Database integrity_check failed: ${String(integrityRow?.integrity_check)}.`);
  }
  if (quickRow?.quick_check !== 'ok') {
    throw new Error(`Database quick_check failed: ${String(quickRow?.quick_check)}.`);
  }
}

async function txRunMigrations(portal: TPortal, args: TArgs): Promise<{ applied: boolean }> {
  if (!args.applicationVersion.trim()) {
    throw new Error('Migration applicationVersion must not be empty.');
  }
  if (!Number.isSafeInteger(args.appliedAtMs) || args.appliedAtMs < 0) {
    throw new Error('Migration appliedAtMs must be a non-negative safe integer.');
  }

  const migrationFile = await fxReadMigrationFile(
    { Bun: portal.Bun },
    { path: INITIAL_MIGRATION.path },
  );
  const preflightArgs = {
    checksumSha256: migrationFile.checksumSha256,
    expectedApplicationTables: args.expectedApplicationTables,
  } as const;
  const initialState = await fxPreflightMigrationState({ db: portal.db }, preflightArgs);

  await txDefaultRunPragmas(
    { db: portal.db },
    {
      expectApplicationMetadata: initialState.status === 'ready',
    },
  );
  await txAssertDatabasePragmas(
    { db: portal.db },
    {
      expectApplicationMetadata: initialState.status === 'ready',
    },
  );

  if (initialState.status === 'ready') {
    await assertDatabaseChecks(portal.db);
    return { applied: false };
  }

  const transaction = portal.db.transaction(async () => {
    await portal.db.exec(migrationFile.sql);
    const insertMigration = await portal.db.prepare(`
      INSERT INTO schema_migrations (
        version,
        name,
        checksum_sha256,
        applied_at_ms,
        application_version
      ) VALUES (?, ?, ?, ?, ?)
    `);
    await insertMigration.run(
      DATABASE_SCHEMA_VERSION,
      INITIAL_MIGRATION.name,
      migrationFile.checksumSha256,
      args.appliedAtMs,
      args.applicationVersion,
    );
    await portal.db.exec(`
      PRAGMA application_id = ${DATABASE_APPLICATION_ID};
      PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
    `);
  }) as TImmediateTransaction;

  await transaction.immediate();

  await txAssertDatabasePragmas(
    { db: portal.db },
    {
      expectApplicationMetadata: true,
    },
  );
  const finalState = await fxPreflightMigrationState({ db: portal.db }, preflightArgs);
  if (finalState.status !== 'ready') {
    throw new Error('Fresh database bootstrap completed without a valid managed migration state.');
  }
  await assertDatabaseChecks(portal.db);

  return { applied: true };
}

export { txRunMigrations };
