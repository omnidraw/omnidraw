import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { eq } from 'drizzle-orm';
import { dirname, join, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { txRunDatabaseMigrations } from '../core/tx.migrations';
import type { IDbConfig } from '../interface';
import type {
  IDbService,
  TCanvasInsertArgs,
  TCanvasRecord,
  TCreateFileArgs,
  TFileRecord,
  TFilesystemInsertArgs,
  TFilesystemRecord,
  TGetFileArgs,
  TGetFullCanvasResult,
} from '../IDbService';
import * as schema from '../schema';
import { fxGetFile } from './fx.get-file';
import { txCreateFile } from './tx.create-file';

export type TDbSchema = typeof schema;
export type TDrizzleDb = BunSQLiteDatabase<TDbSchema>;

function configureSqlite(sqlite: Database) {
  sqlite.run('PRAGMA foreign_keys = ON');
  sqlite.run('PRAGMA journal_mode = WAL');
  sqlite.run('PRAGMA busy_timeout = 5000');
  sqlite.run('PRAGMA synchronous = NORMAL');
  sqlite.run('PRAGMA cache_size = 10000');
  sqlite.run('PRAGMA temp_store = MEMORY');
  sqlite.run('PRAGMA mmap_size = 268435456');
}

export class DbServiceBunSqlite implements IDbService {
  readonly name = 'db' as const;
  readonly sqlite: Database;
  readonly drizzle: TDrizzleDb;
  #startPromise: Promise<void> | null = null;
  #stopped = false;

  constructor(private readonly config: IDbConfig) {
    this.sqlite = new Database(config.databasePath);
    configureSqlite(this.sqlite);

    this.drizzle = drizzle({ client: this.sqlite, schema });
  }

  start(): Promise<void> {
    if (this.#stopped) {
      throw new Error('Database service has been stopped');
    }

    if (this.#startPromise !== null) {
      return this.#startPromise;
    }

    this.#startPromise = txRunDatabaseMigrations({
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
          return await import('../embedded-migrations');
        } catch {
          return null;
        }
      },
      migrate,
      log: (message) => console.log(message),
    }, {
      dataDir: this.config.dataDir,
      cacheDir: this.config.cacheDir,
      db: this.drizzle,
      sqlite: this.sqlite,
      silent: this.config.silentMigrations,
    }).catch((error) => {
      this.#startPromise = null;
      throw error;
    });

    return this.#startPromise;
  }

  canvas = {
    listAll: () => this.drizzle.query.canvas.findMany().sync() as TCanvasRecord[],
    findByName: (name: string) => this.drizzle.query.canvas.findFirst({ where: eq(schema.canvas.name, name) }).sync() as TCanvasRecord | null,
    create: (args: TCanvasInsertArgs) => this.drizzle.insert(schema.canvas).values(args).returning().all()[0]!,
    renameById: (args: { id: string, name: string }) => this.drizzle.update(schema.canvas).set({ name: args.name }).where(eq(schema.canvas.id, args.id)).returning().all()[0]!,
    deleteById: (args: { id: string }) => this.drizzle.delete(schema.canvas).where(eq(schema.canvas.id, args.id)).returning().all(),
  };

  file = {
    listAll: () => this.drizzle.query.files.findMany().sync() as TFileRecord[],
    create: (args: TCreateFileArgs) => txCreateFile(this, args),
    get: (args: TGetFileArgs) => fxGetFile(this, args),
    deleteById: (args: { id: string }) => this.drizzle.delete(schema.files).where(eq(schema.files.id, args.id)).run(),
  };

  filesystem = {
    listAll: () => this.drizzle.query.filesystems.findMany().sync() as TFilesystemRecord[],
    findById: (id: string) => this.drizzle.query.filesystems.findFirst({ where: eq(schema.filesystems.id, id) }).sync() as TFilesystemRecord | null,
    findByMachineId: (machineId: string) => this.drizzle.query.filesystems.findFirst({ where: eq(schema.filesystems.machine_id, machineId) }).sync() as TFilesystemRecord | null,
    create: (args: TFilesystemInsertArgs) => this.drizzle.insert(schema.filesystems).values(args).returning().all()[0]!,
    updateById: (args: { id: string; label?: string; kind?: 'local' | 'remote'; home_path?: string | null }) => this.drizzle
      .update(schema.filesystems)
      .set({
        ...(args.label !== undefined ? { label: args.label } : {}),
        ...(args.kind !== undefined ? { kind: args.kind } : {}),
        ...(args.home_path !== undefined ? { home_path: args.home_path } : {}),
        updated_at: new Date(),
      })
      .where(eq(schema.filesystems.id, args.id))
      .returning()
      .all()[0]!,
  };

  async stop() {
    if (this.#stopped) {
      return;
    }

    this.#stopped = true;
    await this.#startPromise?.catch(() => undefined);
    this.sqlite.close();
  }

  getFullCanvas(id: string): TGetFullCanvasResult | null {
    const canvas = this.drizzle.query.canvas.findFirst({
      where: eq(schema.canvas.id, id),
    }).sync();

    if (!canvas) {
      return null;
    }

    return {
      canvas,
    };
  }
}

export async function createSqliteDb(config: IDbConfig): Promise<DbServiceBunSqlite> {
  const dbService = new DbServiceBunSqlite(config);
  await dbService.start();
  return dbService;
}
