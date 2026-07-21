import type { Database } from '@tursodatabase/database';
import {
  DATABASE_APPLICATION_ID,
  DATABASE_JOURNAL_MODE,
  DATABASE_SCHEMA_VERSION,
} from '../CONSTANTS';

type TPortal = {
  db: Database;
};

type TArgs = {
  expectApplicationMetadata: boolean;
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

async function txDefaultRunPragmas(portal: TPortal, args: TArgs): Promise<void> {
  await portal.db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA ignore_check_constraints = 0;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = FULL;
    PRAGMA cache_size = 10000;
    PRAGMA temp_store = 2;
  `);
}

async function txAssertDatabasePragmas(portal: TPortal, args: TArgs): Promise<void> {
  const entries = await Promise.all([
    (await portal.db.prepare('PRAGMA foreign_keys')).get(),
    (await portal.db.prepare('PRAGMA ignore_check_constraints')).get(),
    (await portal.db.prepare('PRAGMA journal_mode')).get(),
    (await portal.db.prepare('PRAGMA busy_timeout')).get(),
    (await portal.db.prepare('PRAGMA synchronous')).get(),
    (await portal.db.prepare('PRAGMA cache_size')).get(),
    (await portal.db.prepare('PRAGMA temp_store')).get(),
    (await portal.db.prepare('PRAGMA application_id')).get(),
    (await portal.db.prepare('PRAGMA user_version')).get(),
  ]) as Array<Record<string, unknown> | undefined>;

  expectedValue(entries[0], 'foreign_keys', 1);
  expectedValue(entries[1], 'ignore_check_constraints', 0);
  expectedValue(entries[2], 'journal_mode', DATABASE_JOURNAL_MODE);
  expectedValue(entries[3], 'busy_timeout', 5000);
  expectedValue(entries[4], 'synchronous', 2);
  expectedValue(entries[5], 'cache_size', 10000);
  expectedValue(entries[6], 'temp_store', 2);

  if (args.expectApplicationMetadata) {
    expectedValue(entries[7], 'application_id', DATABASE_APPLICATION_ID);
    expectedValue(entries[8], 'user_version', DATABASE_SCHEMA_VERSION);
  }
}

export { txAssertDatabasePragmas, txDefaultRunPragmas };
