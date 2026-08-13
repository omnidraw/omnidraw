import { DATABASE_STATEMENTS } from './statement-registry';
import type { Database } from '@tursodatabase/database';
import { runDatabaseTransaction } from './run-database-transaction';

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
    return runDatabaseTransaction({ database: this.database }, {
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
    return runDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        if (!await this.#isExactInstance(args.identity)) return { status: 'unavailable' };
        await this.#initialize(args);
        const row = await (await this.database.prepare(DATABASE_STATEMENTS.widgetStateUpdateWidgetInstanceStates)).get(
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
    const row = await (await this.database.prepare(DATABASE_STATEMENTS.widgetStateReadCanvasItems)).get(
      identity.canvasId,
      identity.elementId,
      identity.widgetInstanceId,
    );
    return row !== undefined && row !== null;
  }

  async #initialize(args: TWidgetStateStoreReadArgs): Promise<void> {
    await (await this.database.prepare(DATABASE_STATEMENTS.widgetStateInsertWidgetInstanceStates)).run(
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
    const row = await (await this.database.prepare(DATABASE_STATEMENTS.widgetStateReadWidgetInstanceStates)).get(
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
