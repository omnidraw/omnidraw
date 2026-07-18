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
import path011 from "./migration-files/011-add-db-resources.sql" with { type: "file" }
import path012 from "./migration-files/012-replace-db-resource-migrations.sql" with { type: "file" }
import path013 from "./migration-files/013-add-db-resource-restore-source.sql" with { type: "file" }
import { AGENT_STORAGE_MIGRATION_NAME, AGENT_STORAGE_MIGRATION_VERSION, runAgentStorageMigration } from './migration-files/014-migrate-agent-storage';
import path015 from "./migration-files/015-add-actor-resource-name-keys.sql" with { type: "file" }
import type { TMigration } from './migration-types';

export function listMigrationFiles(): TMigration[] {

  return [
    { type: 'sql', name: '000-add-automerge.sql', path: path000 },
    { type: 'sql', name: '001-add-auth-tables.sql', path: path001 },
    { type: 'sql', name: '002-add-canvas.sql', path: path002 },
    { type: 'sql', name: '003-add-media-files.sql', path: path003 },
    { type: 'sql', name: '004-add-filesystems.sql', path: path004 },
    { type: 'sql', name: '005-add-actor.sql', path: path005 },
    { type: 'sql', name: '006-add-key-value.sql', path: path006 },
    { type: 'sql', name: '007-add-actor-instance-error.sql', path: path007 },
    { type: 'sql', name: '008-add-tool-groups.sql', path: path008 },
    { type: 'sql', name: '009-add-actor-resources.sql', path: path009 },
    { type: 'sql', name: '011-add-db-resources.sql', path: path011 },
    { type: 'sql', name: '012-replace-db-resource-migrations.sql', path: path012 },
    { type: 'sql', name: '013-add-db-resource-restore-source.sql', path: path013 },
    { type: 'typescript', name: AGENT_STORAGE_MIGRATION_NAME, version: AGENT_STORAGE_MIGRATION_VERSION, run: runAgentStorageMigration },
    {
      type: 'sql',
      name: '015-add-actor-resource-name-keys.sql',
      path: path015,
      legacyNames: ['014-add-actor-resource-name-keys.sql'],
    },
  ]
}
