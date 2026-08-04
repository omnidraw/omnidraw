import type { Database } from '@tursodatabase/database';
import type {
  TExpectedDomain,
  TExpectedForeignKey,
  TExpectedIndexManifest,
  TExpectedSchema,
} from '../schema/expected-schema';
import { fnSerializeDatabaseSchemaFingerprint } from './fn.database-schema-fingerprint';

type TPortal = {
  Bun: Pick<typeof Bun, 'CryptoHasher'>;
  db: Database;
};

type TArgs = {
  expectedDomains: readonly TExpectedDomain[];
  expectedFingerprintSha256: string;
  expectedIndexes: TExpectedIndexManifest;
  expectedSchema: TExpectedSchema;
};

type TResult = Readonly<{ valid: true }> | Readonly<{
  valid: false;
  reason: string;
}>;

type TColumnRow = {
  hidden: number;
  name: string;
  notnull: number;
  pk: number;
  type: string;
};

type TForeignKeyRow = {
  from: string;
  id: number;
  on_delete: string;
  seq: number;
  table: string;
  to: string;
};

type TIndexListRow = {
  name: string;
  origin: string;
  partial: number;
  unique: number;
};

type TIndexInfoRow = {
  name: string;
  seqno: number;
};

type TSchemaObjectRow = {
  name: string;
  sql: string | null;
  table_name: string;
  type: 'index' | 'table' | 'trigger' | 'view';
};

type TDomainRow = {
  name: string;
  sql: string;
};

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function columnSet(columns: readonly string[]): string {
  return columns.join('\u0000');
}

function generatedColumnKind(hidden: number): string {
  if (hidden === 0) return "none";
  if (hidden === 2) return "virtual";
  if (hidden === 3) return "stored";
  return `unknown:${hidden}`;
}

function canonicalForeignKey(foreignKey: TExpectedForeignKey): string {
  return [
    columnSet(foreignKey.columns),
    foreignKey.referencesTable,
    columnSet(foreignKey.referencesColumns),
    foreignKey.onDelete,
  ].join('\u0001');
}

async function indexColumns(db: Database, index: string): Promise<readonly string[]> {
  const rows = await (
    await db.prepare(`PRAGMA index_info(${identifier(index)})`)
  ).all() as TIndexInfoRow[];
  return rows
    .toSorted((left, right) => left.seqno - right.seqno)
    .map((row) => row.name);
}

async function actualForeignKeys(db: Database, table: string): Promise<readonly string[]> {
  const rows = await (
    await db.prepare(`PRAGMA foreign_key_list(${identifier(table)})`)
  ).all() as TForeignKeyRow[];
  const groups = new Map<number, TForeignKeyRow[]>();
  for (const row of rows) groups.set(row.id, [...(groups.get(row.id) ?? []), row]);

  return [...groups.values()].map((group) => {
    const ordered = group.toSorted((left, right) => left.seq - right.seq);
    const first = ordered[0];
    if (!first) return '';
    return canonicalForeignKey({
      columns: ordered.map((row) => row.from),
      referencesTable: first.table,
      referencesColumns: ordered.map((row) => row.to),
      onDelete: first.on_delete as TExpectedForeignKey['onDelete'],
    });
  }).toSorted();
}

async function hasForeignKeyOrphan(
  db: Database,
  table: string,
  foreignKey: TExpectedForeignKey,
): Promise<boolean> {
  const childAlias = identifier('child_row');
  const parentAlias = identifier('parent_row');
  const childValuesPresent = foreignKey.columns
    .map((column) => `${childAlias}.${identifier(column)} IS NOT NULL`)
    .join(' AND ');
  const parentMatches = foreignKey.columns
    .map((column, index) => (
      `${parentAlias}.${identifier(foreignKey.referencesColumns[index]!)} = `
        + `${childAlias}.${identifier(column)}`
    ))
    .join(' AND ');
  const row = await (await db.prepare(`
    SELECT 1 AS violation
    FROM ${identifier(table)} AS ${childAlias}
    WHERE ${childValuesPresent}
      AND NOT EXISTS (
        SELECT 1
        FROM ${identifier(foreignKey.referencesTable)} AS ${parentAlias}
        WHERE ${parentMatches}
      )
    LIMIT 1
  `)).get();
  return row !== undefined && row !== null;
}

/** Read-only exact schema, key, index, and foreign-key integrity verification. */
async function fxVerifyDatabaseSchemaContract(
  portal: TPortal,
  args: TArgs,
): Promise<TResult> {
  const [schemaObjects, domainRows] = await Promise.all([
    (await portal.db.prepare(`
      SELECT type, name, tbl_name AS table_name, sql
      FROM sqlite_schema
      WHERE type IN ('table', 'index', 'view', 'trigger')
        AND name NOT GLOB 'sqlite_*'
      ORDER BY type, name, tbl_name
    `)).all() as Promise<TSchemaObjectRow[]>,
    (await portal.db.prepare(`
      SELECT name, sql
      FROM __turso_internal_types
      ORDER BY name
    `)).all() as Promise<TDomainRow[]>,
  ]);
  const actualDomains = domainRows.map((row) => `${row.name}\u0000${row.sql}`);
  const expectedDomains = args.expectedDomains.map((row) => `${row.name}\u0000${row.sql}`);
  if (!sameStrings(actualDomains, expectedDomains)) {
    return { valid: false, reason: 'custom domain definitions differ' };
  }
  const fingerprintPayload = fnSerializeDatabaseSchemaFingerprint(
    [
      ...schemaObjects.map((row) => ({
        name: row.name,
        sql: row.sql,
        tableName: row.table_name,
        type: row.type,
      })),
      ...domainRows.map((row) => ({
        name: row.name,
        sql: row.sql,
        tableName: '__turso_internal_types',
        type: 'domain' as const,
      })),
    ],
  );
  const fingerprintSha256 = new portal.Bun.CryptoHasher('sha256')
    .update(fingerprintPayload)
    .digest('hex');
  if (fingerprintSha256 !== args.expectedFingerprintSha256) {
    return {
      valid: false,
      reason: `whole-schema SHA-256 fingerprint differs (found ${fingerprintSha256})`,
    };
  }

  for (const [table, expected] of Object.entries(args.expectedSchema)) {
    const columns = await (
      await portal.db.prepare(`PRAGMA table_xinfo(${identifier(table)})`)
    ).all() as TColumnRow[];
    const indexes = await (
      await portal.db.prepare(`PRAGMA index_list(${identifier(table)})`)
    ).all() as TIndexListRow[];
    const primaryKeyIndex = indexes.find((index) => index.origin === 'pk');
    const actualPrimaryKey = primaryKeyIndex
      ? await indexColumns(portal.db, primaryKeyIndex.name)
      : columns.filter((column) => column.pk > 0).map((column) => column.name);
    const primaryKeyPositions = new Map(
      actualPrimaryKey.map((column, index) => [column, index + 1]),
    );
    const actualColumns = columns.map((column) => [
      column.name,
      column.type,
      column.notnull === 1 ? 'required' : 'nullable',
      String(primaryKeyPositions.get(column.name) ?? 0),
      generatedColumnKind(column.hidden),
    ].join('\u0000'));
    const expectedColumns = expected.columns.map((column) => [
      column.name,
      column.type,
      column.notNull ? 'required' : 'nullable',
      String(column.primaryKeyPosition),
      column.generated,
    ].join('\u0000'));
    if (!sameStrings(actualColumns, expectedColumns)) {
      return { valid: false, reason: `table '${table}' columns or primary-key positions differ` };
    }

    if (!sameStrings(actualPrimaryKey, expected.primaryKey)) {
      return { valid: false, reason: `table '${table}' primary key differs` };
    }

    const actualUnique: string[] = [];
    for (const index of indexes.filter((candidate) => candidate.origin === 'u')) {
      actualUnique.push(columnSet(await indexColumns(portal.db, index.name)));
    }
    if (!sameStrings(
      actualUnique.toSorted(),
      expected.unique.map(columnSet).toSorted(),
    )) {
      return { valid: false, reason: `table '${table}' unique keys differ` };
    }

    const foreignKeys = await actualForeignKeys(portal.db, table);
    const expectedForeignKeys = expected.foreignKeys.map(canonicalForeignKey).toSorted();
    if (!sameStrings(foreignKeys, expectedForeignKeys)) {
      return { valid: false, reason: `table '${table}' foreign keys differ` };
    }
    for (const foreignKey of expected.foreignKeys) {
      if (await hasForeignKeyOrphan(portal.db, table, foreignKey)) {
        return {
          valid: false,
          reason: `foreign-key integrity check found an orphan in table '${table}'`,
        };
      }
    }

    if ((expected.requiredSqlFragments?.length ?? 0) > 0) {
      const row = await (await portal.db.prepare(`
        SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?
      `)).get(table) as { sql?: unknown } | undefined;
      const normalizedSql = typeof row?.sql === 'string' ? row.sql.replace(/\s+/g, '') : '';
      for (const fragment of expected.requiredSqlFragments ?? []) {
        if (!normalizedSql.includes(fragment.replace(/\s+/g, ''))) {
          return {
            valid: false,
            reason: `table '${table}' is missing required SQL contract '${fragment}'`,
          };
        }
      }
    }
  }

  const explicitIndexes = await (await portal.db.prepare(`
    SELECT name, tbl_name AS table_name
    FROM sqlite_schema
    WHERE type = 'index' AND name NOT GLOB 'sqlite_autoindex_*'
    ORDER BY name
  `)).all() as Array<{ name: string; table_name: string }>;
  const expectedIndexNames = Object.keys(args.expectedIndexes).toSorted();
  if (!sameStrings(explicitIndexes.map((index) => index.name), expectedIndexNames)) {
    return { valid: false, reason: 'explicit index name manifest differs' };
  }

  for (const [name, expected] of Object.entries(args.expectedIndexes)) {
    const schemaIndex = explicitIndexes.find((index) => index.name === name);
    if (schemaIndex?.table_name !== expected.table) {
      return { valid: false, reason: `index '${name}' table differs` };
    }
    const indexList = await (
      await portal.db.prepare(`PRAGMA index_list(${identifier(expected.table)})`)
    ).all() as TIndexListRow[];
    const actual = indexList.find((index) => index.name === name);
    if (
      !actual
      || (actual.unique === 1) !== expected.unique
      || (actual.partial === 1) !== expected.partial
    ) {
      return { valid: false, reason: `index '${name}' uniqueness or partial contract differs` };
    }
    if (!sameStrings(await indexColumns(portal.db, name), expected.columns)) {
      return { valid: false, reason: `index '${name}' columns differ` };
    }
  }

  return { valid: true };
}

export { fxVerifyDatabaseSchemaContract };
export type { TArgs as TDatabaseSchemaContractArgs, TResult as TDatabaseSchemaContractResult };
