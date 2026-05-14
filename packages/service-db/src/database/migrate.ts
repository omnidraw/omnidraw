import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { dirname, join, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { txConfigPath } from '@vibecanvas/shared-functions/vibecanvas-config/tx.config-path';
import { txRunDatabaseMigrations } from '../core/tx.migrations';
import * as schema from '../schema';

const [config, configError] = txConfigPath({ fs: { existsSync, mkdirSync } });

if (configError) {
  throw new Error(configError.internalMessage);
}

if (!config) {
  throw new Error('Failed to resolve Vibecanvas database config');
}

const sqlite = new Database(config.paths.databasePath);
sqlite.run('PRAGMA foreign_keys = ON');

const db = drizzle({ client: sqlite, schema });

try {
  await txRunDatabaseMigrations({
    env: {
      VIBECANVAS_MIGRATIONS_DIR: process.env.VIBECANVAS_MIGRATIONS_DIR,
      VIBECANVAS_COMPILED: process.env.VIBECANVAS_COMPILED,
    },
    paths: {
      dirname,
      join,
      resolve,
      importMetaDir: import.meta.dir,
      execPath: process.execPath,
    },
    fs: {
      existsSync,
      mkdirSync,
      readFileSync,
      writeFileSync,
    },
    loadEmbeddedMigrationsModule: async () => {
      try {
        return await import('../_embedded-migrations');
      } catch {
        return null;
      }
    },
    migrate,
    log: (message) => console.log(message),
  }, {
    dataDir: config.paths.dataDir,
    cacheDir: config.paths.cacheDir,
    db,
    sqlite,
  });
} finally {
  sqlite.close();
}
