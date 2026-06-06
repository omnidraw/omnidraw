import type { Database } from '@tursodatabase/database';

type TPortal = {
  db: Database
};
type TArgs = { };

export async function txDefaultRunPragmas(portal: TPortal, args: TArgs) {
  portal.db.exec(`
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = FULL;
PRAGMA cache_size = 10000;
-- 2 = MEMORY
PRAGMA temp_store = 2;
`);
}
