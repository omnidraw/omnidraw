import type { TDbResourceSchemaMigration } from "../model"

export function fnDbResourceAssertContiguousMigrations(migrations: TDbResourceSchemaMigration[]): void {
  const ordered = [...migrations].sort((left, right) => left.version - right.version)
  for (const [index, migration] of ordered.entries()) {
    const expectedVersion = index + 1
    if (migration.version !== expectedVersion) {
      throw new Error(`DbResource migrations must be contiguous from version 1; expected ${expectedVersion}`)
    }
  }
}

export function fnDbResourceAssertVersions(appliedVersion: number, targetVersion: number): void {
  if (!Number.isInteger(appliedVersion) || appliedVersion < 0) {
    throw new RangeError("DbResource applied version must be a non-negative integer")
  }
  if (!Number.isInteger(targetVersion) || targetVersion < 0) {
    throw new RangeError("DbResource target version must be a non-negative integer")
  }
  if (targetVersion < appliedVersion) {
    throw new RangeError("DbResource target version cannot be lower than applied version")
  }
}
