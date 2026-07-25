#!/usr/bin/env bun

/**
 * @file Opens the local DbResource owner, commits one WAL transaction, then
 * parks inside a second transaction after proving writer/observer isolation.
 * The parent recovery test kills this process at that explicit checkpoint.
 */

import { Database } from '@tursodatabase/database';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DbResource, type TDatabaseFactory } from '../../src/local';

const dataRoot = Bun.argv[2];
const resourceId = Bun.argv[3];

if (!dataRoot || !resourceId) {
  throw new Error('Expected resource data root and resource id.');
}

const resource = { id: resourceId, kind: 'db' as const };
const requirement = {
  kind: 'db' as const,
  required: true,
  scope: ['read', 'write'] as const,
  arbitrarySql: true,
};
const context = {
  resource,
  requirement,
  canRead: true,
  canWrite: true,
};
const controlStore = {
  dbResource: {
    draft: {
      list: async () => [],
    },
  },
};
let dbResourceExperimental: readonly string[] = [];
const databaseFactory: TDatabaseFactory = (databasePath, options) => {
  dbResourceExperimental = [...(options?.experimental ?? [])];
  return new Database(databasePath, options);
};

const provider = new DbResource({
  db: controlStore,
  dataRoot,
  databaseFactory,
});

await provider.provision(resource, {});
await provider.dispatch(context, 'execute', {
  sql: `
    CREATE TABLE recovery_rows (
      id INTEGER PRIMARY KEY,
      label TEXT NOT NULL,
      payload BLOB NOT NULL
    ) STRICT
  `,
});

const databasePath = join(dataRoot, resourceId, 'data.db');
const checkpoint = new Database(databasePath, {
  fileMustExist: true,
  // @ts-expect-error Turso runtime features are ahead of its public union.
  experimental: ['custom_types', 'triggers', 'index_method', 'strict', 'without_rowid', 'multiprocess_wal'],
});
await checkpoint.connect();
await checkpoint.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
const checkpointResult = await (await checkpoint.prepare('PRAGMA wal_checkpoint(TRUNCATE)')).get();
const journalMode = await (await checkpoint.prepare('PRAGMA journal_mode')).get();
await checkpoint.close();

await provider.dispatch(context, 'execute', {
  sql: "INSERT INTO recovery_rows (id, label, payload) VALUES (1, 'committed', x'636f6d6d6974746564')",
});

const walPath = `${databasePath}-wal`;
const committedWalBytes = (await stat(walPath)).size;
if (committedWalBytes <= 32) {
  throw new Error('Committed resource row did not produce a WAL frame after the clean checkpoint.');
}

const interruptedWriter = new Database(databasePath, {
  fileMustExist: true,
  // @ts-expect-error Turso runtime features are ahead of its public union.
  experimental: ['custom_types', 'triggers', 'index_method', 'strict', 'without_rowid', 'multiprocess_wal'],
});
await interruptedWriter.connect();
await interruptedWriter.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA busy_timeout = 5000;
  PRAGMA cache_size = 1;
  PRAGMA cache_spill = ON;
`);

type TImmediateTransaction = (() => Promise<void>) & { immediate: () => Promise<void> };
const interrupted = interruptedWriter.transaction(async () => {
  await (await interruptedWriter.prepare(`
    INSERT INTO recovery_rows (id, label, payload)
    VALUES (2, 'uncommitted', zeroblob(262144))
  `)).run();

  const writerRows = await (await interruptedWriter.prepare(
    'SELECT CAST(id AS TEXT) AS id, label FROM recovery_rows ORDER BY id',
  )).all();
  const observerRows = await provider.dispatch(context, 'query', {
    sql: 'SELECT CAST(id AS TEXT) AS id, label FROM recovery_rows ORDER BY id',
  });
  const interruptedWalBytes = (await stat(walPath)).size;
  const walBytes = await readFile(walPath);
  const walHeader = new DataView(walBytes.buffer, walBytes.byteOffset, walBytes.byteLength);
  const pageSizeHeader = walHeader.getUint32(8);
  const pageSize = pageSizeHeader === 1 ? 65_536 : pageSizeHeader;
  const committedWalFrames = (committedWalBytes - 32) / (pageSize + 24);
  const interruptedWalFrames = (interruptedWalBytes - 32) / (pageSize + 24);

  process.stdout.write(`${JSON.stringify({
    type: 'wal-crash-checkpoint',
    pid: process.pid,
    journalMode,
    checkpointResult,
    committedWalBytes,
    committedWalFrames,
    interruptedWalBytes,
    interruptedWalFrames,
    writerRows,
    observerRows,
    dbResourceExperimental,
  })}\n`);

  await new Promise<never>(() => undefined);
}) as TImmediateTransaction;

await interrupted.immediate();
