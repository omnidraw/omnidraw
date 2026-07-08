import path000 from "./migration-files/000-add-automerge.sql" with { type: "file" }
import path001 from "./migration-files/001-add-auth-tables.sql" with { type: "file" }
import path002 from "./migration-files/002-add-canvas.sql" with { type: "file" }
import path003 from "./migration-files/003-add-media-files.sql" with { type: "file" }
import path004 from "./migration-files/004-add-filesystems.sql" with { type: "file" }
import path005 from "./migration-files/005-add-actor.sql" with { type: "file" }
import path006 from "./migration-files/006-add-key-value.sql" with { type: "file" }

type TSql = {
  type: 'sql',
  path: string,
}

export function listMigrationFiles(): TSql[] {

  return [
    { type: 'sql', path: path000 },
    { type: 'sql', path: path001 },
    { type: 'sql', path: path002 },
    { type: 'sql', path: path003 },
    { type: 'sql', path: path004 },
    { type: 'sql', path: path005 },
    { type: 'sql', path: path006 },
  ]
}
