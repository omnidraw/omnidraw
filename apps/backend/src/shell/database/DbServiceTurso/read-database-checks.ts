import { DATABASE_STATEMENTS } from '../statement-registry';
/**
 * @file Read complete Turso integrity and quick-check diagnostics.
 */
import type { Database } from '@tursodatabase/database';

type TEffects = {
  db: Database;
};

type TArgs = Record<string, never>;

type TDatabaseChecks = Readonly<{
  ok: boolean;
  integrity: readonly string[];
  quick: readonly string[];
  failureMessage: string | null;
}>;

function checkValues(
  rows: readonly Record<string, unknown>[],
  field: 'integrity_check' | 'quick_check',
): string[] {
  return rows.map((row) => {
    const value = row[field];
    return typeof value === 'string' ? value : String(value);
  });
}

function failed(values: readonly string[]): boolean {
  return values.length !== 1 || values[0] !== 'ok';
}

async function readDatabaseChecks(
  effects: TEffects,
  args: TArgs,
): Promise<TDatabaseChecks> {
  void args;
  const integrity = checkValues(
    await (await effects.db.prepare(DATABASE_STATEMENTS.databaseCheckReadPragmaIntegrityCheck)).all() as Record<string, unknown>[],
    'integrity_check',
  );
  const quick = checkValues(
    await (await effects.db.prepare(DATABASE_STATEMENTS.databaseCheckReadPragmaQuickCheck)).all() as Record<string, unknown>[],
    'quick_check',
  );
  const failures: string[] = [];
  if (failed(integrity)) failures.push(`integrity_check failed: ${integrity.join('; ')}`);
  if (failed(quick)) failures.push(`quick_check failed: ${quick.join('; ')}`);

  return {
    ok: failures.length === 0,
    integrity,
    quick,
    failureMessage: failures.length === 0 ? null : `Database ${failures.join('. ')}.`,
  };
}

export { readDatabaseChecks };
export type { TDatabaseChecks };
