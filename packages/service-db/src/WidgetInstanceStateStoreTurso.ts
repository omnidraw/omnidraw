import type { Database } from '@tursodatabase/database';
import { txRunDatabaseTransaction } from './tx.run-database-transaction';

export type TWidgetSerializableJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly TWidgetSerializableJsonValue[]
  | Readonly<{ [key: string]: TWidgetSerializableJsonValue }>;

export type TWidgetStateInstanceIdentity = Readonly<{
  canvasId: string;
  elementId: string;
  widgetInstanceId: string;
}>;

export type TWidgetStateStoredSnapshot = Readonly<{
  version: number;
  state: TWidgetSerializableJsonValue;
}>;

export type TWidgetStateStoreReadResult =
  | Readonly<{ status: 'found'; snapshot: TWidgetStateStoredSnapshot }>
  | Readonly<{ status: 'unavailable' }>;

export type TWidgetStateStoreChangeResult =
  | Readonly<{ status: 'changed'; snapshot: TWidgetStateStoredSnapshot }>
  | Readonly<{ status: 'conflict'; snapshot: TWidgetStateStoredSnapshot }>
  | Readonly<{ status: 'unavailable' }>;

export type TWidgetStateStoreReadArgs = Readonly<{
  identity: TWidgetStateInstanceIdentity;
  initialSnapshot: TWidgetStateStoredSnapshot;
}>;

export type TWidgetStateStoreChangeArgs = TWidgetStateStoreReadArgs & Readonly<{
  expectedVersion: number;
  state: TWidgetSerializableJsonValue;
}>;

type TStoredStateRow = Readonly<{
  version: unknown;
  state_json: unknown;
}>;

/** Transactional state keyed to one exact current canvas widget instance. */
export class WidgetInstanceStateStoreTurso {
  constructor(private readonly database: Database) {}

  getAuthorizedExactInstance(
    args: TWidgetStateStoreReadArgs,
  ): Promise<TWidgetStateStoreReadResult> {
    return txRunDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        if (!await this.#isExactInstance(args.identity)) return { status: 'unavailable' };
        await this.#initialize(args);
        return {
          status: 'found',
          snapshot: await this.#readSnapshot(args.identity),
        };
      },
    });
  }

  compareAndSwapAuthorizedExactInstance(
    args: TWidgetStateStoreChangeArgs,
  ): Promise<TWidgetStateStoreChangeResult> {
    return txRunDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        if (!await this.#isExactInstance(args.identity)) return { status: 'unavailable' };
        await this.#initialize(args);
        const row = await (await this.database.prepare(`
          UPDATE widget_instance_states
          SET
            version = version + 1,
            state_json = ?,
            updated_at_sec = CURRENT_TIMESTAMP
          WHERE canvas_id = ?
            AND element_id = ?
            AND instance_id = ?
            AND version = ?
          RETURNING version, state_json
        `)).get(
          this.#encode(args.state),
          args.identity.canvasId,
          args.identity.elementId,
          args.identity.widgetInstanceId,
          args.expectedVersion,
        ) as TStoredStateRow | null;
        if (row) return { status: 'changed', snapshot: this.#snapshot(row) };
        return {
          status: 'conflict',
          snapshot: await this.#readSnapshot(args.identity),
        };
      },
    });
  }

  async #isExactInstance(identity: TWidgetStateInstanceIdentity): Promise<boolean> {
    const row = await (await this.database.prepare(`
      SELECT 1 AS present
      FROM canvas_items
      WHERE canvas_id = ?
        AND id = ?
        AND widget_instance_id = ?
      LIMIT 1
    `)).get(
      identity.canvasId,
      identity.elementId,
      identity.widgetInstanceId,
    );
    return row !== undefined && row !== null;
  }

  async #initialize(args: TWidgetStateStoreReadArgs): Promise<void> {
    await (await this.database.prepare(`
      INSERT INTO widget_instance_states (
        canvas_id,
        element_id,
        instance_id,
        version,
        state_json
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (canvas_id, element_id) DO UPDATE SET
        instance_id = excluded.instance_id,
        version = excluded.version,
        state_json = excluded.state_json,
        created_at_sec = CURRENT_TIMESTAMP,
        updated_at_sec = CURRENT_TIMESTAMP
      WHERE widget_instance_states.instance_id <> excluded.instance_id
    `)).run(
      args.identity.canvasId,
      args.identity.elementId,
      args.identity.widgetInstanceId,
      args.initialSnapshot.version,
      this.#encode(args.initialSnapshot.state),
    );
  }

  async #readSnapshot(
    identity: TWidgetStateInstanceIdentity,
  ): Promise<TWidgetStateStoredSnapshot> {
    const row = await (await this.database.prepare(`
      SELECT version, state_json
      FROM widget_instance_states
      WHERE canvas_id = ?
        AND element_id = ?
        AND instance_id = ?
    `)).get(
      identity.canvasId,
      identity.elementId,
      identity.widgetInstanceId,
    ) as TStoredStateRow | null;
    if (!row) throw new Error('Widget state initialization failed.');
    return this.#snapshot(row);
  }

  #snapshot(row: TStoredStateRow): TWidgetStateStoredSnapshot {
    const version = Number(row.version);
    if (!Number.isSafeInteger(version) || version < 1 || typeof row.state_json !== 'string') {
      throw new TypeError('Stored widget state is invalid.');
    }
    return Object.freeze({
      version,
      state: JSON.parse(row.state_json) as TWidgetSerializableJsonValue,
    });
  }

  #encode(state: TWidgetSerializableJsonValue): string {
    const encoded = JSON.stringify(state);
    if (encoded === undefined) throw new TypeError('Widget state is not serializable JSON.');
    return encoded;
  }
}
