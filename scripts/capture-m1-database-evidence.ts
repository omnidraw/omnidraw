/**
 * @file Captures deterministic M1 Turso schema, index, foreign-key, and restart evidence.
 */
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Database } from '../packages/service-db/src/DbServiceTurso/turso-native';
import {
  EXPECTED_APPLICATION_SCHEMA_OBJECTS,
  EXPECTED_APPLICATION_TABLES,
} from '../packages/service-db/src/schema/expected-schema';
import { txRunMigrations } from '../packages/service-db/src/DbServiceTurso/tx.migrations';

const EVIDENCE_APPLIED_AT_MS = Date.UTC(2026, 6, 21);
const EVIDENCE_APPLICATION_VERSION = 'm1-evidence';

type TRow = Record<string, unknown>;

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function pragmaRows(database: Database, statement: string): Promise<TRow[]> {
  return await (await database.prepare(statement)).all() as TRow[];
}

async function pragmaRow(database: Database, statement: string): Promise<TRow | null> {
  return await (await database.prepare(statement)).get() as TRow | null;
}

async function captureCatalog(database: Database) {
  const tables = await pragmaRows(database, 'PRAGMA table_list');
  const applicationTables = tables
    .filter((row) => row.schema === 'main' && row.type === 'table' && !String(row.name).startsWith('sqlite_'))
    .sort((left, right) => String(left.name).localeCompare(String(right.name)));

  const catalog: Record<string, unknown> = {};
  for (const table of EXPECTED_APPLICATION_TABLES) {
    const identifier = quotedIdentifier(table);
    const indexes = (await pragmaRows(database, `PRAGMA index_list(${identifier})`))
      .sort((left, right) => String(left.name).localeCompare(String(right.name)));
    const indexDetails: Record<string, TRow[]> = {};
    for (const index of indexes) {
      const indexName = String(index.name);
      indexDetails[indexName] = await pragmaRows(database, `PRAGMA index_info(${quotedIdentifier(indexName)})`);
    }
    catalog[table] = {
      columns: await pragmaRows(database, `PRAGMA table_info(${identifier})`),
      foreignKeys: await pragmaRows(database, `PRAGMA foreign_key_list(${identifier})`),
      indexes,
      indexDetails,
    };
  }

  return { applicationTables, catalog };
}

async function main(): Promise<void> {
  const outputFlagIndex = Bun.argv.indexOf('--output');
  const outputPath = outputFlagIndex === -1 ? null : Bun.argv[outputFlagIndex + 1];
  if (outputFlagIndex !== -1 && !outputPath) {
    throw new Error('--output requires a file path.');
  }

  const temporaryRoot = await fs.mkdtemp(path.join(tmpdir(), 'vibecanvas-m1-evidence-'));
  const databasePath = path.join(temporaryRoot, 'main.db');
  let database: Database | null = null;
  try {
    database = new Database(databasePath);
    await database.connect();
    const bootstrap = await txRunMigrations({ db: database, Bun, TextDecoder }, {
      applicationVersion: EVIDENCE_APPLICATION_VERSION,
      appliedAtMs: EVIDENCE_APPLIED_AT_MS,
      expectedApplicationTables: EXPECTED_APPLICATION_TABLES,
      expectedSchemaObjects: EXPECTED_APPLICATION_SCHEMA_OBJECTS,
    });
    await database.close();
    database = new Database(databasePath);
    await database.connect();
    const restart = await txRunMigrations({ db: database, Bun, TextDecoder }, {
      applicationVersion: 'must-not-replace-ledger',
      appliedAtMs: EVIDENCE_APPLIED_AT_MS + 1,
      expectedApplicationTables: EXPECTED_APPLICATION_TABLES,
      expectedSchemaObjects: EXPECTED_APPLICATION_SCHEMA_OBJECTS,
    });

    const { applicationTables, catalog } = await captureCatalog(database);
    const evidence = {
      runtime: {
        bun: Bun.version,
        databasePackage: '@tursodatabase/database@0.6.1',
      },
      lifecycle: {
        freshBootstrap: bootstrap,
        secondStart: restart,
      },
      pragmas: {
        applicationId: await pragmaRow(database, 'PRAGMA application_id'),
        userVersion: await pragmaRow(database, 'PRAGMA user_version'),
        foreignKeys: await pragmaRow(database, 'PRAGMA foreign_keys'),
        ignoreCheckConstraints: await pragmaRow(database, 'PRAGMA ignore_check_constraints'),
        journalMode: await pragmaRow(database, 'PRAGMA journal_mode'),
        synchronous: await pragmaRow(database, 'PRAGMA synchronous'),
        integrityCheck: await pragmaRow(database, 'PRAGMA integrity_check'),
        quickCheck: await pragmaRow(database, 'PRAGMA quick_check'),
      },
      migrationLedger: await pragmaRows(database, 'SELECT * FROM schema_migrations ORDER BY version'),
      tableList: applicationTables,
      catalog,
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    if (outputPath) {
      await Bun.write(path.resolve(outputPath), serialized);
      console.log(`Wrote M1 database evidence to ${path.resolve(outputPath)}`);
    } else {
      console.log(serialized);
    }
  } finally {
    if (database) await database.close().catch(() => undefined);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
