// Auto-generated file - do not edit
import migration0 from './migrations/000-initial.sql' with { type: "file" };
import migration1 from './migrations/001-widget-revision-sequence.sql' with { type: "file" };

const embeddedMigrationPaths = new Map<string, string>([
  ["000-initial.sql", migration0],
  ["001-widget-revision-sequence.sql", migration1],
]);

export function listEmbeddedMigrationFiles(): string[] {
  return [...embeddedMigrationPaths.keys()];
}

export function getEmbeddedMigrationPath(relativePath: string): string | null {
  return embeddedMigrationPaths.get(relativePath) ?? null;
}
