// Auto-generated file - do not edit
import migration0 from './migrations/000-initial.sql' with { type: "file" };
import migration1 from './migrations/001-widget-revision-sequence.sql' with { type: "file" };
import migration2 from './migrations/002-function-runtime.sql' with { type: "file" };
import migration3 from './migrations/003-widget-instance-projection.sql' with { type: "file" };
import migration4 from './migrations/004-agent-authoring.sql' with { type: "file" };

const embeddedMigrationPaths = new Map<string, string>([
  ["000-initial.sql", migration0],
  ["001-widget-revision-sequence.sql", migration1],
  ["002-function-runtime.sql", migration2],
  ["003-widget-instance-projection.sql", migration3],
  ["004-agent-authoring.sql", migration4],
]);

export function listEmbeddedMigrationFiles(): string[] {
  return [...embeddedMigrationPaths.keys()];
}

export function getEmbeddedMigrationPath(relativePath: string): string | null {
  return embeddedMigrationPaths.get(relativePath) ?? null;
}
