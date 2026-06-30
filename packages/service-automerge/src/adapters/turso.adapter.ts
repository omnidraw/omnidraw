import type {
  Chunk,
  StorageAdapterInterface,
  StorageKey,
} from '@automerge/automerge-repo';
import type { Database } from '@tursodatabase/database';

interface Options {
  separator?: string;
}

type Data = { data: Uint8Array };
type RangeData = { key: string; data: Uint8Array };

type TursoStatement = Awaited<ReturnType<Database['prepare']>>;

type PreparedStatements = {
  load: TursoStatement;
  save: TursoStatement;
  remove: TursoStatement;
  loadRange: TursoStatement;
  removeRange: TursoStatement;
};

export class TursoStorageAdapter implements StorageAdapterInterface {
  private readonly db: Database;
  private readonly separator: string;
  private readonly tableName = 'automerge_repo_data';
  private setupPromise: Promise<PreparedStatements> | null = null;

  constructor(database: Database, options?: Options) {
    this.db = database;
    this.separator = options?.separator ?? '.';
  }

  async load(keyArray: StorageKey): Promise<Uint8Array | undefined> {
    const statements = await this.setup();
    const key = this.keyToString(keyArray);
    const result = await statements.load.get(key) as Data | undefined;
    return result?.data;
  }

  async save(keyArray: StorageKey, binary: Uint8Array): Promise<void> {
    const statements = await this.setup();
    const key = this.keyToString(keyArray);
    await statements.save.run(key, binary);
  }

  async remove(keyArray: string[]): Promise<void> {
    const statements = await this.setup();
    const key = this.keyToString(keyArray);
    await statements.remove.run(key);
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    const statements = await this.setup();
    const prefix = this.keyToString(keyPrefix);
    const result = await statements.loadRange.all(`${prefix}*`) as RangeData[];
    return result.map(({ key, data }) => ({
      key: this.stringToKey(key),
      data,
    }));
  }

  async removeRange(keyPrefix: string[]): Promise<void> {
    const statements = await this.setup();
    const prefix = this.keyToString(keyPrefix);
    await statements.removeRange.run(`${prefix}*`);
  }

  private setup(): Promise<PreparedStatements> {
    this.setupPromise ??= this.setupStatements().catch((error) => {
      this.setupPromise = null;
      throw error;
    });
    return this.setupPromise;
  }

  private async setupStatements(): Promise<PreparedStatements> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        updated_at TEXT,
        data BLOB
      );
    `);

    const load = await this.db.prepare(`SELECT data FROM ${this.tableName} WHERE key = ?;`);
    const save = await this.db.prepare(`
      INSERT INTO ${this.tableName} (key, updated_at, data)
        VALUES (?, datetime(), ?)
        ON CONFLICT DO UPDATE SET data = excluded.data, updated_at = datetime();
    `);
    const remove = await this.db.prepare(`DELETE FROM ${this.tableName} WHERE key = ?;`);
    const loadRange = await this.db.prepare(`SELECT key, data FROM ${this.tableName} WHERE key GLOB ?;`);
    const removeRange = await this.db.prepare(`DELETE FROM ${this.tableName} WHERE key GLOB ?;`);

    return { load, save, remove, loadRange, removeRange };
  }

  private keyToString(key: StorageKey): string {
    return key.join(this.separator);
  }

  private stringToKey(key: string): StorageKey {
    return key.split(this.separator);
  }
}
