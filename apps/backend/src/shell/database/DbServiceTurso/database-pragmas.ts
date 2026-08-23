import { DATABASE_STATEMENTS } from '../statement-registry';
import type { Database } from '@tursodatabase/database';
import {
  DATABASE_APPLICATION_ID,
  DATABASE_JOURNAL_MODE,
} from '../CONSTANTS';
import { runDatabaseWrite } from '../run-database-transaction';

type TEffects = {
  db: Database;
};

type TArgs = {
  expectedForeignKeys?: 0 | 1;
  expectedUserVersion: number | null;
};

function expectedValue(
  row: Record<string, unknown> | undefined,
  field: string,
  expected: number | string,
): void {
  const actual = row?.[field];
  if (actual !== expected) {
    throw new Error(`Database PRAGMA ${field} is ${String(actual)}, expected ${String(expected)}.`);
  }
}

async function applyDefaultDatabasePragmas(effects: TEffects, args: TArgs): Promise<void> {
  await runDatabaseWrite({ database: effects.db }, {
    operation: async () => {
      await effects.db.exec(DATABASE_STATEMENTS.pragmaSetForeignKeysOn);
      await effects.db.exec(DATABASE_STATEMENTS.pragmaSetIgnoreCheckConstraints);
      await effects.db.exec(DATABASE_STATEMENTS.pragmaSetJournalModeWal);
      await effects.db.exec(DATABASE_STATEMENTS.pragmaSetBusyTimeout);
      await effects.db.exec(DATABASE_STATEMENTS.pragmaSetSynchronousFull);
      await effects.db.exec(DATABASE_STATEMENTS.pragmaSetCacheSize);
      await effects.db.exec(DATABASE_STATEMENTS.pragmaSetTempStoreMemory);
    },
  });
}

async function assertDatabasePragmas(effects: TEffects, args: TArgs): Promise<void> {
  const entries = await Promise.all([
    (await effects.db.prepare(DATABASE_STATEMENTS.pragmaReadPragmaForeignKeys)).get(),
    (await effects.db.prepare(DATABASE_STATEMENTS.pragmaReadPragmaIgnoreCheckConstraints)).get(),
    (await effects.db.prepare(DATABASE_STATEMENTS.pragmaReadPragmaJournalMode)).get(),
    (await effects.db.prepare(DATABASE_STATEMENTS.pragmaReadPragmaBusyTimeout)).get(),
    (await effects.db.prepare(DATABASE_STATEMENTS.pragmaReadPragmaSynchronous)).get(),
    (await effects.db.prepare(DATABASE_STATEMENTS.pragmaReadPragmaCacheSize)).get(),
    (await effects.db.prepare(DATABASE_STATEMENTS.pragmaReadPragmaTempStore)).get(),
    (await effects.db.prepare(DATABASE_STATEMENTS.migrationStateReadPragmaApplicationId)).get(),
    (await effects.db.prepare(DATABASE_STATEMENTS.migrationStateReadPragmaUserVersion)).get(),
  ]) as Array<Record<string, unknown> | undefined>;

  expectedValue(entries[0], 'foreign_keys', args.expectedForeignKeys ?? 1);
  expectedValue(entries[1], 'ignore_check_constraints', 0);
  expectedValue(entries[2], 'journal_mode', DATABASE_JOURNAL_MODE);
  expectedValue(entries[3], 'busy_timeout', 5000);
  expectedValue(entries[4], 'synchronous', 2);
  expectedValue(entries[5], 'cache_size', 10000);
  expectedValue(entries[6], 'temp_store', 2);

  if (args.expectedUserVersion !== null) {
    expectedValue(entries[7], 'application_id', DATABASE_APPLICATION_ID);
    expectedValue(entries[8], 'user_version', args.expectedUserVersion);
  }
}

export { assertDatabasePragmas, applyDefaultDatabasePragmas };
