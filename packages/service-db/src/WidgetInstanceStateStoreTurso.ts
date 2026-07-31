import type { Database } from '@tursodatabase/database';
import type { TTenantContext } from '@omnidraw/tenant-core';
import type { TWidgetSerializableJsonValue } from '@omnidraw/widget-contract';
import type { IWidgetStateStore } from '@omnidraw/service-widget-state';
import { txRunDatabaseTransaction } from './tx.run-database-transaction';

export type TWidgetStateInstanceIdentity = Readonly<{
  orgId: string;
  canvasId: string;
  elementId: string;
  widgetInstanceId: string;
  definitionId: string;
  revisionId: string;
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
  tenant: TTenantContext;
  identity: TWidgetStateInstanceIdentity;
  initialSnapshot: TWidgetStateStoredSnapshot;
}>;

export type TWidgetStateStoreChangeArgs = TWidgetStateStoreReadArgs & Readonly<{
  expectedVersion: number;
  state: TWidgetSerializableJsonValue;
}>;

type TAuthorizedInstanceRow = Readonly<{
  authorized: unknown;
}>;

type TStoredStateRow = Readonly<{
  version: unknown;
  state_json: unknown;
}>;

/**
 * Transactional widget-state persistence. Authorization, exact widget identity,
 * lazy initialization, and CAS all share the same immediate transaction.
 */
export class WidgetInstanceStateStoreTurso implements IWidgetStateStore {
  constructor(private readonly database: Database) {}

  getAuthorizedExactInstance(
    args: TWidgetStateStoreReadArgs,
  ): Promise<TWidgetStateStoreReadResult> {
    if (!this.#tenantMatchesIdentity(args.tenant, args.identity)) {
      return Promise.resolve({ status: 'unavailable' });
    }
    return txRunDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        if (!await this.#isAuthorized(args, 'read')) {
          return { status: 'unavailable' };
        }
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
    if (!this.#tenantMatchesIdentity(args.tenant, args.identity)) {
      return Promise.resolve({ status: 'unavailable' });
    }
    return txRunDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        if (!await this.#isAuthorized(args, 'write')) {
          return { status: 'unavailable' };
        }
        await this.#initialize(args);
        const updatedAtMs = Date.now();
        const row = await (await this.database.prepare(`
          UPDATE widget_instance_states
          SET version = version + 1,
              state_json = ?,
              updated_at_ms = ?
          WHERE org_id = ?
            AND widget_instance_id = ?
            AND version = ?
          RETURNING version, state_json
        `)).get(
          this.#encode(args.state),
          updatedAtMs,
          args.identity.orgId,
          args.identity.widgetInstanceId,
          args.expectedVersion,
        ) as TStoredStateRow | null;
        if (row) {
          return { status: 'changed', snapshot: this.#snapshot(row) };
        }
        return {
          status: 'conflict',
          snapshot: await this.#readSnapshot(args.identity),
        };
      },
    });
  }

  async #isAuthorized(
    args: TWidgetStateStoreReadArgs,
    mode: 'read' | 'write',
  ): Promise<boolean> {
    const row = await (await this.database.prepare(`
      SELECT EXISTS (
        SELECT 1
        FROM widget_instances AS instance
        INNER JOIN canvas_items AS item
          ON item.org_id = instance.org_id
          AND item.canvas_id = instance.canvas_id
          AND item.id = instance.element_id
          AND item.widget_instance_id = instance.id
          AND item.definition_id = instance.definition_id
          AND item.revision_id = instance.revision_id
        INNER JOIN canvas_members AS member
          ON member.org_id = instance.org_id
          AND member.canvas_id = instance.canvas_id
          AND member.account_id = ?
        WHERE instance.org_id = ?
          AND instance.canvas_id = ?
          AND instance.element_id = ?
          AND instance.id = ?
          AND instance.definition_id = ?
          AND instance.revision_id = ?
          AND instance.status = 'active'
          AND (? = 'read' OR member.role IN ('owner', 'editor'))
      ) AS authorized
    `)).get(
      args.tenant.accountId,
      args.identity.orgId,
      args.identity.canvasId,
      args.identity.elementId,
      args.identity.widgetInstanceId,
      args.identity.definitionId,
      args.identity.revisionId,
      mode,
    ) as TAuthorizedInstanceRow | null;
    return Number(row?.authorized) === 1;
  }

  async #initialize(args: TWidgetStateStoreReadArgs): Promise<void> {
    const createdAtMs = Date.now();
    await (await this.database.prepare(`
      INSERT INTO widget_instance_states (
        org_id,
        widget_instance_id,
        version,
        state_json,
        created_at_ms,
        updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (org_id, widget_instance_id) DO NOTHING
    `)).run(
      args.identity.orgId,
      args.identity.widgetInstanceId,
      args.initialSnapshot.version,
      this.#encode(args.initialSnapshot.state),
      createdAtMs,
      createdAtMs,
    );
  }

  async #readSnapshot(
    identity: TWidgetStateInstanceIdentity,
  ): Promise<TWidgetStateStoredSnapshot> {
    const row = await (await this.database.prepare(`
      SELECT version, state_json
      FROM widget_instance_states
      WHERE org_id = ? AND widget_instance_id = ?
    `)).get(identity.orgId, identity.widgetInstanceId) as TStoredStateRow | null;
    if (!row) {
      throw new Error('Widget state initialization failed.');
    }
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
    if (encoded === undefined) {
      throw new TypeError('Widget state is not serializable JSON.');
    }
    return encoded;
  }

  #tenantMatchesIdentity(
    tenant: TTenantContext,
    identity: TWidgetStateInstanceIdentity,
  ): boolean {
    return tenant.orgId === identity.orgId
      && (tenant.canvasId === undefined || tenant.canvasId === identity.canvasId);
  }
}
