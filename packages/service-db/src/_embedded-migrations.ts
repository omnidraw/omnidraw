// Auto-generated file - do not edit

import migration000 from "./DbServiceTurso/migration-files/000-add-automerge.sql" with { type: "file" }
import migration001 from "./DbServiceTurso/migration-files/001-add-auth-tables.sql" with { type: "file" }
import migration002 from "./DbServiceTurso/migration-files/002-add-canvas.sql" with { type: "file" }
import migration003 from "./DbServiceTurso/migration-files/003-add-media-files.sql" with { type: "file" }
import migration004 from "./DbServiceTurso/migration-files/004-add-filesystems.sql" with { type: "file" }
import migration005 from "./DbServiceTurso/migration-files/005-add-actor.sql" with { type: "file" }
import migration006 from "./DbServiceTurso/migration-files/006-add-key-value.sql" with { type: "file" }
import migration007 from "./DbServiceTurso/migration-files/007-add-actor-instance-error.sql" with { type: "file" }
import migration008 from "./DbServiceTurso/migration-files/008-add-tool-groups.sql" with { type: "file" }
import migration009 from "./DbServiceTurso/migration-files/009-add-actor-resources.sql" with { type: "file" }
import migration010 from "./DbServiceTurso/migration-files/010-add-actor-resource-key-values.sql" with { type: "file" }
import migration011 from "./DbServiceTurso/migration-files/011-add-db-resources.sql" with { type: "file" }
import migration012 from "./DbServiceTurso/migration-files/012-replace-db-resource-migrations.sql" with { type: "file" }
import migration013 from "./DbServiceTurso/migration-files/013-add-db-resource-restore-source.sql" with { type: "file" }

const embeddedMigrationPaths = new Map<string, string>([
  ["000-add-automerge.sql", migration000],
  ["001-add-auth-tables.sql", migration001],
  ["002-add-canvas.sql", migration002],
  ["003-add-media-files.sql", migration003],
  ["004-add-filesystems.sql", migration004],
  ["005-add-actor.sql", migration005],
  ["006-add-key-value.sql", migration006],
  ["007-add-actor-instance-error.sql", migration007],
  ["008-add-tool-groups.sql", migration008],
  ["009-add-actor-resources.sql", migration009],
  ["010-add-actor-resource-key-values.sql", migration010],
  ["011-add-db-resources.sql", migration011],
  ["012-replace-db-resource-migrations.sql", migration012],
  ["013-add-db-resource-restore-source.sql", migration013],
])

export function getEmbeddedMigrationPath(relativePath: string): string | null {
  return embeddedMigrationPaths.get(relativePath) ?? null
}

export function listEmbeddedMigrationFiles(): string[] {
  return [...embeddedMigrationPaths.keys()]
}
