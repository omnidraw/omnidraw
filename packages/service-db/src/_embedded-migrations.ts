// Auto-generated file - do not edit
import migration0 from './migrations/000-initial.sql' with { type: "file" };

const embeddedMigrationPaths = new Map<string, string>([
  ["000-initial.sql", migration0],
]);

export function listEmbeddedMigrationFiles(): string[] {
  return [...embeddedMigrationPaths.keys()];
}

export function getEmbeddedMigrationPath(relativePath: string): string | null {
  return embeddedMigrationPaths.get(relativePath) ?? null;
}
