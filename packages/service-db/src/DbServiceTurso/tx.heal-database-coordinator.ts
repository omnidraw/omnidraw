/**
 * @file Validate the canonical DB/WAL view and quarantine stale Turso coordinator metadata.
 */
import type { Database } from '@tursodatabase/database';
import type * as FsPromises from 'node:fs/promises';
import type {
  TExpectedDatabaseSchemaContract,
} from '../schema/expected-schema';
import { fxReadDatabaseChecks } from './fx.database-checks';
import { fxPreflightMigrationState } from './fx.migration-state';
import type {
  TDatabasePreflightResult,
  TMigrationChecksum,
} from './migration-types';

type TPortal = {
  Bun: Pick<typeof Bun, 'CryptoHasher'>;
  lstat: typeof FsPromises.lstat;
  mkdir: typeof FsPromises.mkdir;
  openCanonicalDatabase: () => Database;
  rename: typeof FsPromises.rename;
  validateBeforeQuarantine: (preflight: TDatabasePreflightResult) => Promise<void>;
};

type TArgs = {
  expectedSchemaContracts: readonly TExpectedDatabaseSchemaContract[];
  migrations: readonly TMigrationChecksum[];
  quarantineDirectory: string;
  quarantinePath: string;
  tshmPath: string;
};

type TDatabaseCoordinatorHealing = Readonly<{
  preflight: TDatabasePreflightResult;
  quarantinedPath: string;
}>;

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function assertPathMissing(portal: TPortal, candidatePath: string): Promise<void> {
  try {
    await portal.lstat(candidatePath);
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
  throw new Error(`Refusing to overwrite database coordinator recovery file: ${candidatePath}`);
}

async function txHealDatabaseCoordinator(
  portal: TPortal,
  args: TArgs,
): Promise<TDatabaseCoordinatorHealing> {
  const tshmStat = await portal.lstat(args.tshmPath);
  if (!tshmStat.isFile()) {
    throw new Error(`Database coordinator is not a regular file: ${args.tshmPath}`);
  }

  await assertPathMissing(portal, args.quarantinePath);

  const database = portal.openCanonicalDatabase();
  let connected = false;
  try {
    // A write-capable legacy single-process open is the authority probe. It
    // must succeed with the coordinator still in place before that file can be
    // classified as stale rather than corrupt or actively owned.
    await database.connect();
    connected = true;
    const preflight = await fxPreflightMigrationState(
      { Bun: portal.Bun, db: database },
      {
        expectedSchemaContracts: args.expectedSchemaContracts,
        migrations: args.migrations,
      },
    );
    const checks = await fxReadDatabaseChecks({ db: database }, {});
    if (!checks.ok) {
      throw new Error(
        `Canonical database and WAL validation failed; coordinator healing is unsafe. `
          + `${checks.failureMessage ?? 'Unknown integrity failure'}`,
      );
    }
    await portal.validateBeforeQuarantine(preflight);
    await portal.mkdir(args.quarantineDirectory, { recursive: true });
    await portal.rename(args.tshmPath, args.quarantinePath);
    return { preflight, quarantinedPath: args.quarantinePath };
  } finally {
    if (connected) await database.close();
  }
}

export { txHealDatabaseCoordinator };
export type { TDatabaseCoordinatorHealing };
