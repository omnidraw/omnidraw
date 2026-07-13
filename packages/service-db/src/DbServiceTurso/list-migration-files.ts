/// <reference path="../assets.d.ts" />

import path000 from "./migration-files/000-add-automerge.sql" with { type: "file" }
import path001 from "./migration-files/001-add-auth-tables.sql" with { type: "file" }
import path002 from "./migration-files/002-add-canvas.sql" with { type: "file" }
import path003 from "./migration-files/003-add-media-files.sql" with { type: "file" }
import path004 from "./migration-files/004-add-filesystems.sql" with { type: "file" }
import path005 from "./migration-files/005-add-actor.sql" with { type: "file" }
import path006 from "./migration-files/006-add-key-value.sql" with { type: "file" }
import path007 from "./migration-files/007-add-actor-instance-error.sql" with { type: "file" }
import path008 from "./migration-files/008-add-tool-groups.sql" with { type: "file" }
import path009 from "./migration-files/009-add-actor-resources.sql" with { type: "file" }
import path010 from "./migration-files/010-add-actor-resource-key-values.sql" with { type: "file" }
import path011 from "./migration-files/011-add-db-resources.sql" with { type: "file" }
import path012 from "./migration-files/012-replace-db-resource-migrations.sql" with { type: "file" }
import path013 from "./migration-files/013-add-db-resource-restore-source.sql" with { type: "file" }

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
    { type: 'sql', path: path007 },
    { type: 'sql', path: path008 },
    { type: 'sql', path: path009 },
    { type: 'sql', path: path010 },
    { type: 'sql', path: path011 },
    { type: 'sql', path: path012 },
    { type: 'sql', path: path013 },
  ]
}
