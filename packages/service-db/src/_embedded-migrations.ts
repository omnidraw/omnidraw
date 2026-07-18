// Auto-generated file - do not edit
import migration0 from './DbServiceTurso/migration-files/000-add-automerge.sql' with { type: "file" };
import migration1 from './DbServiceTurso/migration-files/001-add-auth-tables.sql' with { type: "file" };
import migration2 from './DbServiceTurso/migration-files/002-add-canvas.sql' with { type: "file" };
import migration3 from './DbServiceTurso/migration-files/003-add-media-files.sql' with { type: "file" };
import migration4 from './DbServiceTurso/migration-files/004-add-filesystems.sql' with { type: "file" };
import migration5 from './DbServiceTurso/migration-files/005-add-actor.sql' with { type: "file" };
import migration6 from './DbServiceTurso/migration-files/006-add-key-value.sql' with { type: "file" };
import migration7 from './DbServiceTurso/migration-files/007-add-actor-instance-error.sql' with { type: "file" };
import migration8 from './DbServiceTurso/migration-files/008-add-tool-groups.sql' with { type: "file" };
import migration9 from './DbServiceTurso/migration-files/009-add-actor-resources.sql' with { type: "file" };
import migration10 from './DbServiceTurso/migration-files/011-add-db-resources.sql' with { type: "file" };
import migration11 from './DbServiceTurso/migration-files/012-replace-db-resource-migrations.sql' with { type: "file" };
import migration12 from './DbServiceTurso/migration-files/013-add-db-resource-restore-source.sql' with { type: "file" };
import migration13 from './DbServiceTurso/migration-files/015-add-actor-resource-name-keys.sql' with { type: "file" };

const embeddedMigrationPaths = new Map<string, string>([
  ["000-add-automerge.sql", migration0],
  ["001-add-auth-tables.sql", migration1],
  ["002-add-canvas.sql", migration2],
  ["003-add-media-files.sql", migration3],
  ["004-add-filesystems.sql", migration4],
  ["005-add-actor.sql", migration5],
  ["006-add-key-value.sql", migration6],
  ["007-add-actor-instance-error.sql", migration7],
  ["008-add-tool-groups.sql", migration8],
  ["009-add-actor-resources.sql", migration9],
  ["011-add-db-resources.sql", migration10],
  ["012-replace-db-resource-migrations.sql", migration11],
  ["013-add-db-resource-restore-source.sql", migration12],
  ["015-add-actor-resource-name-keys.sql", migration13],
]);

export function listEmbeddedMigrationFiles(): string[] {
  return [...embeddedMigrationPaths.keys()];
}

export function getEmbeddedMigrationPath(relativePath: string): string | null {
  return embeddedMigrationPaths.get(relativePath) ?? null;
}
