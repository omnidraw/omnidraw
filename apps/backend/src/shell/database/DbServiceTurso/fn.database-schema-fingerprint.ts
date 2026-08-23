type TDatabaseSchemaObjectRow = Readonly<{
  name: string;
  sql: string | null;
  tableName: string;
  type: 'domain' | 'index' | 'table' | 'trigger' | 'view';
}>;

const DATABASE_SCHEMA_FINGERPRINT_FORMAT_VERSION = 1;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fnSerializeDatabaseSchemaFingerprint(
  rows: readonly TDatabaseSchemaObjectRow[],
): string {
  const objects = rows
    .toSorted((left, right) => (
      compareCodeUnits(left.type, right.type)
      || compareCodeUnits(left.name, right.name)
      || compareCodeUnits(left.tableName, right.tableName)
    ))
    .map((row) => [row.type, row.name, row.tableName, row.sql] as const);

  return JSON.stringify({
    formatVersion: DATABASE_SCHEMA_FINGERPRINT_FORMAT_VERSION,
    objects,
  });
}

export { fnSerializeDatabaseSchemaFingerprint };
export type { TDatabaseSchemaObjectRow };
