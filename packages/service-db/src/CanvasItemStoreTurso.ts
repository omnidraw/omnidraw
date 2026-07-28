import type { Database } from "@tursodatabase/database";
import {
  CANVAS_COMMAND_MAX_OPERATIONS,
  CANVAS_QUERY_DEFAULT_LIMIT,
  CANVAS_QUERY_MAX_LIMIT,
  fnAssertValidCanvasItems,
  type TCanvasItemPage,
  type TCanvasItemQuery,
  type TCanvasItemQueryCursor,
  type TCanvasItemSnapshot,
  type TCanvasSnapshot,
} from "@vibecanvas/canvas-contract";
import type { TTenantContext } from "@vibecanvas/tenant-core";
import { txRunDatabaseTransaction } from "./tx.run-database-transaction";

type TCanvasItem = TCanvasItemSnapshot["item"];

export type TCanvasItemStoreMutation =
  | Readonly<{
      type: "insert";
      item: TCanvasItem;
    }>
  | Readonly<{
      type: "replace";
      item: TCanvasItem;
      expectedItemRevision: number;
    }>
  | Readonly<{
      type: "delete";
      itemId: string;
      expectedItemRevision: number;
    }>;

export type TCanvasItemStoreApplyRequest = Readonly<{
  canvasId: string;
  expectedCanvasRevision: number;
  mutations: readonly TCanvasItemStoreMutation[];
  nowMs: number;
}>;

export type TCanvasItemStoreApplyResult =
  | Readonly<{
      status: "committed";
      revision: number;
      changedItems: readonly TCanvasItemSnapshot[];
      deletedItemIds: readonly string[];
    }>
  | Readonly<{
      status: "revision-conflict";
      revision: number;
    }>;

export type TLocatedCanvasItem = Readonly<{
  canvasId: string;
  item: TCanvasItemSnapshot;
}>;

export type TCanvasItemStoreErrorCode =
  | "CANVAS_NOT_FOUND"
  | "CANVAS_ITEM_BATCH_INVALID"
  | "CANVAS_ITEM_CONFLICT"
  | "CANVAS_ITEM_ROW_INVALID"
  | "CANVAS_ITEM_QUERY_INVALID";

export class CanvasItemStoreError extends Error {
  constructor(
    readonly code: TCanvasItemStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CanvasItemStoreError";
  }
}

type TStoredCanvasItemRow = Readonly<{
  canvas_id?: string;
  id: string;
  item_json: string;
  item_revision: unknown;
  created_at_ms: unknown;
  updated_at_ms: unknown;
  kind: string;
  parent_id: string | null;
  order_key: string;
  widget_instance_id: string | null;
  definition_id: string | null;
  revision_id: string | null;
}>;

type TWidgetInstanceMetadataRow = Readonly<{
  canvas_id: string;
  element_id: string;
  id: string;
}>;

type TWidgetInstanceIdentity = Readonly<{
  definitionId: string;
  instanceId: string;
  revisionId: string;
}>;

const ITEM_SELECT = `
  SELECT
    canvas_id,
    id,
    item_json,
    item_revision,
    created_at_ms,
    updated_at_ms,
    kind,
    parent_id,
    order_key,
    widget_instance_id,
    definition_id,
    revision_id
  FROM canvas_items
`;

function nonNegativeSafeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new CanvasItemStoreError(
      "CANVAS_ITEM_ROW_INVALID",
      `${label} must be a non-negative safe integer.`,
    );
  }
  return parsed;
}

function parseItemRow(row: TStoredCanvasItemRow): TCanvasItemSnapshot {
  let item: unknown;
  try {
    item = JSON.parse(row.item_json);
  } catch {
    throw new CanvasItemStoreError(
      "CANVAS_ITEM_ROW_INVALID",
      `Canvas item '${row.id}' does not contain decodable JSON.`,
    );
  }
  if (
    typeof item !== "object"
    || item === null
    || !("id" in item)
    || item.id !== row.id
  ) {
    throw new CanvasItemStoreError(
      "CANVAS_ITEM_ROW_INVALID",
      `Canvas item '${row.id}' does not match its stored row identity.`,
    );
  }
  return {
    id: row.id,
    item: item as TCanvasItem,
    itemRevision: nonNegativeSafeInteger(row.item_revision, "Canvas item revision"),
    createdAtMs: nonNegativeSafeInteger(row.created_at_ms, "Canvas item creation time"),
    updatedAtMs: nonNegativeSafeInteger(row.updated_at_ms, "Canvas item update time"),
  };
}

function widgetInstanceIdentity(
  row: TStoredCanvasItemRow,
): TWidgetInstanceIdentity | null {
  if (
    row.widget_instance_id === null
    && row.definition_id === null
    && row.revision_id === null
  ) {
    return null;
  }
  if (
    row.widget_instance_id === null
    || row.definition_id === null
    || row.revision_id === null
  ) {
    throw new CanvasItemStoreError(
      "CANVAS_ITEM_ROW_INVALID",
      `Canvas item '${row.id}' has an incomplete widget identity projection.`,
    );
  }
  return {
    instanceId: row.widget_instance_id,
    definitionId: row.definition_id,
    revisionId: row.revision_id,
  };
}

function compareItems(
  left: TCanvasItemSnapshot,
  right: TCanvasItemSnapshot,
): number {
  return left.item.orderKey.localeCompare(right.item.orderKey)
    || left.id.localeCompare(right.id);
}

function orderHierarchy(
  items: readonly TCanvasItemSnapshot[],
): readonly TCanvasItemSnapshot[] {
  const byParent = new Map<string | null, TCanvasItemSnapshot[]>();
  for (const item of items) {
    const siblings = byParent.get(item.item.parentId) ?? [];
    siblings.push(item);
    byParent.set(item.item.parentId, siblings);
  }
  for (const siblings of byParent.values()) siblings.sort(compareItems);

  const ordered: TCanvasItemSnapshot[] = [];
  const visited = new Set<string>();
  const visit = (item: TCanvasItemSnapshot): void => {
    if (visited.has(item.id)) {
      throw new CanvasItemStoreError(
        "CANVAS_ITEM_ROW_INVALID",
        `Canvas item hierarchy visits '${item.id}' more than once.`,
      );
    }
    visited.add(item.id);
    ordered.push(item);
    for (const child of byParent.get(item.id) ?? []) visit(child);
  };
  for (const root of byParent.get(null) ?? []) visit(root);
  if (ordered.length !== items.length) {
    throw new CanvasItemStoreError(
      "CANVAS_ITEM_ROW_INVALID",
      "Canvas item hierarchy is disconnected or cyclic.",
    );
  }
  return ordered;
}

function queryLimit(query: TCanvasItemQuery): number {
  const limit = query.limit ?? CANVAS_QUERY_DEFAULT_LIMIT;
  if (
    !Number.isSafeInteger(limit)
    || limit < 1
    || limit > CANVAS_QUERY_MAX_LIMIT
  ) {
    throw new CanvasItemStoreError(
      "CANVAS_ITEM_QUERY_INVALID",
      `Canvas item query limit must be between 1 and ${CANVAS_QUERY_MAX_LIMIT}.`,
    );
  }
  return limit;
}

function assertCursorType(
  cursor: TCanvasItemQueryCursor | undefined,
  expected: TCanvasItemQueryCursor["type"],
): void {
  if (cursor !== undefined && cursor.type !== expected) {
    throw new CanvasItemStoreError(
      "CANVAS_ITEM_QUERY_INVALID",
      `Canvas item query requires a '${expected}' cursor.`,
    );
  }
}

function nextCursor(
  query: TCanvasItemQuery,
  row: TStoredCanvasItemRow,
): TCanvasItemQueryCursor {
  if (query.filter.type === "parent") {
    return {
      type: "parent-order",
      orderKey: row.order_key,
      id: row.id,
    };
  }
  if (query.filter.type === "widget-definition") {
    if (row.revision_id === null || row.widget_instance_id === null) {
      throw new CanvasItemStoreError(
        "CANVAS_ITEM_ROW_INVALID",
        "Widget definition query returned an item without complete identity.",
      );
    }
    return {
      type: "widget-identity",
      revisionId: row.revision_id,
      instanceId: row.widget_instance_id,
      id: row.id,
    };
  }
  return { type: "id", id: row.id };
}

function serializeItem(item: TCanvasItem): string {
  const serialized = JSON.stringify(item);
  if (serialized === undefined) {
    throw new CanvasItemStoreError(
      "CANVAS_ITEM_BATCH_INVALID",
      "Canvas items must be JSON serializable.",
    );
  }
  return serialized;
}

function assertApplyRequest(request: TCanvasItemStoreApplyRequest): void {
  nonNegativeSafeInteger(request.expectedCanvasRevision, "Expected canvas revision");
  nonNegativeSafeInteger(request.nowMs, "Canvas mutation timestamp");
  if (
    request.mutations.length < 1
    || request.mutations.length > CANVAS_COMMAND_MAX_OPERATIONS
  ) {
    throw new CanvasItemStoreError(
      "CANVAS_ITEM_BATCH_INVALID",
      `Canvas item mutation batches must contain 1 to ${CANVAS_COMMAND_MAX_OPERATIONS} operations.`,
    );
  }
  const itemIds = new Set<string>();
  for (const mutation of request.mutations) {
    const itemId = mutation.type === "delete" ? mutation.itemId : mutation.item.id;
    if (typeof itemId !== "string" || itemId.length === 0 || itemIds.has(itemId)) {
      throw new CanvasItemStoreError(
        "CANVAS_ITEM_BATCH_INVALID",
        "Canvas item mutation targets must be non-empty and unique within a batch.",
      );
    }
    itemIds.add(itemId);
    if (mutation.type !== "insert") {
      nonNegativeSafeInteger(mutation.expectedItemRevision, "Expected canvas item revision");
    }
  }
}

/** Tenant-qualified JSONB persistence used by the authoritative CanvasService. */
export class CanvasItemStoreTurso {
  constructor(private readonly database: Database) {}

  async #activateWidgetInstance(
    tenant: TTenantContext,
    request: Readonly<{
      canvasId: string;
      itemRow: TStoredCanvasItemRow;
      nowMs: number;
    }>,
  ): Promise<void> {
    const identity = widgetInstanceIdentity(request.itemRow);
    if (identity === null) return;

    try {
      const matches = await (await this.database.prepare(`
        SELECT id, canvas_id, element_id
        FROM widget_instances
        WHERE org_id = ?
          AND (
            id = ?
            OR (canvas_id = ? AND element_id = ?)
          )
        ORDER BY id ASC
      `)).all(
        tenant.orgId,
        identity.instanceId,
        request.canvasId,
        request.itemRow.id,
      ) as TWidgetInstanceMetadataRow[];

      if (matches.length > 1) {
        throw new CanvasItemStoreError(
          "CANVAS_ITEM_CONFLICT",
          `Widget identity '${identity.instanceId}' conflicts with existing metadata.`,
        );
      }

      const existing = matches[0];
      if (existing === undefined) {
        await (await this.database.prepare(`
          INSERT INTO widget_instances (
            org_id,
            id,
            canvas_id,
            element_id,
            definition_id,
            revision_id,
            status,
            created_at_ms,
            updated_at_ms
          )
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
        `)).run(
          tenant.orgId,
          identity.instanceId,
          request.canvasId,
          request.itemRow.id,
          identity.definitionId,
          identity.revisionId,
          request.nowMs,
          request.nowMs,
        );
        return;
      }

      const updated = await (await this.database.prepare(`
        UPDATE widget_instances
        SET
          id = ?,
          canvas_id = ?,
          element_id = ?,
          definition_id = ?,
          revision_id = ?,
          status = 'active',
          updated_at_ms = max(updated_at_ms, ?)
        WHERE org_id = ? AND id = ?
      `)).run(
        identity.instanceId,
        request.canvasId,
        request.itemRow.id,
        identity.definitionId,
        identity.revisionId,
        request.nowMs,
        tenant.orgId,
        existing.id,
      );
      if (updated.changes !== 1) {
        throw new CanvasItemStoreError(
          "CANVAS_ITEM_CONFLICT",
          `Widget identity '${identity.instanceId}' metadata changed concurrently.`,
        );
      }
    } catch (error) {
      if (error instanceof CanvasItemStoreError) throw error;
      throw new CanvasItemStoreError(
        "CANVAS_ITEM_CONFLICT",
        `Widget identity '${identity.instanceId}' cannot safely replace existing metadata.`,
      );
    }
  }

  async #archiveWidgetInstance(
    tenant: TTenantContext,
    request: Readonly<{
      canvasId: string;
      elementId: string;
      nowMs: number;
    }>,
  ): Promise<void> {
    await (await this.database.prepare(`
      UPDATE widget_instances
      SET
        status = 'archived',
        updated_at_ms = max(updated_at_ms, ?)
      WHERE org_id = ? AND canvas_id = ? AND element_id = ?
    `)).run(
      request.nowMs,
      tenant.orgId,
      request.canvasId,
      request.elementId,
    );
  }

  async getRevision(
    tenant: TTenantContext,
    request: Readonly<{ canvasId: string }>,
  ): Promise<number> {
    const row = await (await this.database.prepare(`
      SELECT revision
      FROM canvases
      WHERE org_id = ? AND id = ?
    `)).get(tenant.orgId, request.canvasId) as { revision: unknown } | null;
    if (!row) {
      throw new CanvasItemStoreError(
        "CANVAS_NOT_FOUND",
        "Canvas was not found in the tenant.",
      );
    }
    return nonNegativeSafeInteger(row.revision, "Canvas revision");
  }

  getSnapshot(
    tenant: TTenantContext,
    request: Readonly<{ canvasId: string }>,
  ): Promise<TCanvasSnapshot> {
    return txRunDatabaseTransaction({ database: this.database }, {
      mode: "deferred",
      operation: async () => {
        const revision = await this.getRevision(tenant, request);
        const rows = await (await this.database.prepare(`
          ${ITEM_SELECT}
          WHERE org_id = ? AND canvas_id = ?
          ORDER BY id ASC
        `)).all(tenant.orgId, request.canvasId) as TStoredCanvasItemRow[];
        const items = rows.map(parseItemRow);
        fnAssertValidCanvasItems(items.map((item) => item.item));
        return {
          canvasId: request.canvasId,
          revision,
          items: orderHierarchy(items),
        };
      },
    });
  }

  async queryItems(
    tenant: TTenantContext,
    query: TCanvasItemQuery,
  ): Promise<TCanvasItemPage> {
    const limit = queryLimit(query);
    const parameters: Array<string | number | null> = [
      tenant.orgId,
      query.canvasId,
    ];
    let predicate = "org_id = ? AND canvas_id = ?";
    let ordering = "id ASC";

    switch (query.filter.type) {
      case "all": {
        assertCursorType(query.cursor, "id");
        if (query.cursor?.type === "id") {
          predicate += " AND id > ?";
          parameters.push(query.cursor.id);
        }
        break;
      }
      case "ids": {
        assertCursorType(query.cursor, "id");
        const ids = [...new Set(query.filter.ids)];
        if (ids.length < 1 || ids.length > CANVAS_QUERY_MAX_LIMIT) {
          throw new CanvasItemStoreError(
            "CANVAS_ITEM_QUERY_INVALID",
            `ID queries must contain 1 to ${CANVAS_QUERY_MAX_LIMIT} unique IDs.`,
          );
        }
        predicate += ` AND id IN (${ids.map(() => "?").join(", ")})`;
        parameters.push(...ids);
        if (query.cursor?.type === "id") {
          predicate += " AND id > ?";
          parameters.push(query.cursor.id);
        }
        break;
      }
      case "kind": {
        assertCursorType(query.cursor, "id");
        predicate += " AND kind = ?";
        parameters.push(query.filter.kind);
        if (query.cursor?.type === "id") {
          predicate += " AND id > ?";
          parameters.push(query.cursor.id);
        }
        break;
      }
      case "parent": {
        assertCursorType(query.cursor, "parent-order");
        if (query.filter.parentId === null) {
          predicate += " AND parent_id IS NULL";
        } else {
          predicate += " AND parent_id = ?";
          parameters.push(query.filter.parentId);
        }
        ordering = "order_key ASC, id ASC";
        if (query.cursor?.type === "parent-order") {
          predicate += `
            AND (
              order_key > ?
              OR (order_key = ? AND id > ?)
            )
          `;
          parameters.push(
            query.cursor.orderKey,
            query.cursor.orderKey,
            query.cursor.id,
          );
        }
        break;
      }
      case "widget-instance": {
        if (query.cursor !== undefined) {
          throw new CanvasItemStoreError(
            "CANVAS_ITEM_QUERY_INVALID",
            "Widget-instance lookup does not accept a cursor.",
          );
        }
        predicate += " AND widget_instance_id = ?";
        parameters.push(query.filter.instanceId);
        break;
      }
      case "widget-definition": {
        assertCursorType(query.cursor, "widget-identity");
        predicate += " AND definition_id = ?";
        parameters.push(query.filter.definitionId);
        ordering = "revision_id ASC, widget_instance_id ASC, id ASC";
        if (query.filter.revisionId !== undefined) {
          predicate += " AND revision_id = ?";
          parameters.push(query.filter.revisionId);
        }
        if (query.cursor?.type === "widget-identity") {
          predicate += `
            AND (
              revision_id > ?
              OR (
                revision_id = ?
                AND (
                  widget_instance_id > ?
                  OR (widget_instance_id = ? AND id > ?)
                )
              )
            )
          `;
          parameters.push(
            query.cursor.revisionId,
            query.cursor.revisionId,
            query.cursor.instanceId,
            query.cursor.instanceId,
            query.cursor.id,
          );
        }
        break;
      }
    }

    parameters.push(limit + 1);
    const rows = await (await this.database.prepare(`
      ${ITEM_SELECT}
      WHERE ${predicate}
      ORDER BY ${ordering}
      LIMIT ?
    `)).all(...parameters) as TStoredCanvasItemRow[];
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    return {
      items: pageRows.map(parseItemRow),
      nextCursor: hasNext ? nextCursor(query, pageRows.at(-1)!) : null,
    };
  }

  async findByWidgetInstance(
    tenant: TTenantContext,
    request: Readonly<{ instanceId: string }>,
  ): Promise<TLocatedCanvasItem | null> {
    const row = await (await this.database.prepare(`
      ${ITEM_SELECT}
      WHERE org_id = ? AND widget_instance_id = ?
    `)).get(tenant.orgId, request.instanceId) as TStoredCanvasItemRow | null;
    if (!row?.canvas_id) return null;
    return {
      canvasId: row.canvas_id,
      item: parseItemRow(row),
    };
  }

  applyMutations(
    tenant: TTenantContext,
    request: TCanvasItemStoreApplyRequest,
  ): Promise<TCanvasItemStoreApplyResult> {
    assertApplyRequest(request);
    return txRunDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        const canvas = await (await this.database.prepare(`
          UPDATE canvases
          SET
            revision = revision + 1,
            updated_at_ms = max(updated_at_ms, ?)
          WHERE org_id = ? AND id = ? AND revision = ?
          RETURNING revision
        `)).get(
          request.nowMs,
          tenant.orgId,
          request.canvasId,
          request.expectedCanvasRevision,
        ) as { revision: unknown } | null;

        if (!canvas) {
          const current = await (await this.database.prepare(`
            SELECT revision
            FROM canvases
            WHERE org_id = ? AND id = ?
          `)).get(tenant.orgId, request.canvasId) as { revision: unknown } | null;
          if (!current) {
            throw new CanvasItemStoreError(
              "CANVAS_NOT_FOUND",
              "Canvas was not found in the tenant.",
            );
          }
          return {
            status: "revision-conflict",
            revision: nonNegativeSafeInteger(current.revision, "Canvas revision"),
          };
        }

        const changedItems: TCanvasItemSnapshot[] = [];
        const deletedItemIds: string[] = [];
        for (const mutation of request.mutations) {
          if (mutation.type === "insert") {
            const row = await (await this.database.prepare(`
              INSERT INTO canvas_items (
                org_id,
                canvas_id,
                id,
                item_json,
                item_revision,
                created_at_ms,
                updated_at_ms
              )
              VALUES (?, ?, ?, ?, 0, ?, ?)
              ON CONFLICT (org_id, canvas_id, id) DO NOTHING
              RETURNING
                canvas_id,
                id,
                item_json,
                item_revision,
                created_at_ms,
                updated_at_ms,
                kind,
                parent_id,
                order_key,
                widget_instance_id,
                definition_id,
                revision_id
            `)).get(
              tenant.orgId,
              request.canvasId,
              mutation.item.id,
              serializeItem(mutation.item),
              request.nowMs,
              request.nowMs,
            ) as TStoredCanvasItemRow | null;
            if (!row) {
              throw new CanvasItemStoreError(
                "CANVAS_ITEM_CONFLICT",
                `Canvas item '${mutation.item.id}' already exists.`,
              );
            }
            await this.#activateWidgetInstance(tenant, {
              canvasId: request.canvasId,
              itemRow: row,
              nowMs: request.nowMs,
            });
            changedItems.push(parseItemRow(row));
            continue;
          }

          if (mutation.type === "replace") {
            const row = await (await this.database.prepare(`
              UPDATE canvas_items
              SET
                item_json = ?,
                item_revision = item_revision + 1,
                updated_at_ms = max(updated_at_ms, ?)
              WHERE
                org_id = ?
                AND canvas_id = ?
                AND id = ?
                AND item_revision = ?
              RETURNING
                canvas_id,
                id,
                item_json,
                item_revision,
                created_at_ms,
                updated_at_ms,
                kind,
                parent_id,
                order_key,
                widget_instance_id,
                definition_id,
                revision_id
            `)).get(
              serializeItem(mutation.item),
              request.nowMs,
              tenant.orgId,
              request.canvasId,
              mutation.item.id,
              mutation.expectedItemRevision,
            ) as TStoredCanvasItemRow | null;
            if (!row) {
              throw new CanvasItemStoreError(
                "CANVAS_ITEM_CONFLICT",
                `Canvas item '${mutation.item.id}' does not match the expected revision.`,
              );
            }
            if (widgetInstanceIdentity(row) === null) {
              await this.#archiveWidgetInstance(tenant, {
                canvasId: request.canvasId,
                elementId: row.id,
                nowMs: request.nowMs,
              });
            } else {
              await this.#activateWidgetInstance(tenant, {
                canvasId: request.canvasId,
                itemRow: row,
                nowMs: request.nowMs,
              });
            }
            changedItems.push(parseItemRow(row));
            continue;
          }

          const deleted = await (await this.database.prepare(`
            DELETE FROM canvas_items
            WHERE
              org_id = ?
              AND canvas_id = ?
              AND id = ?
              AND item_revision = ?
            RETURNING id
          `)).get(
            tenant.orgId,
            request.canvasId,
            mutation.itemId,
            mutation.expectedItemRevision,
          ) as { id: string } | null;
          if (!deleted) {
            throw new CanvasItemStoreError(
              "CANVAS_ITEM_CONFLICT",
              `Canvas item '${mutation.itemId}' does not match the expected revision.`,
            );
          }
          await this.#archiveWidgetInstance(tenant, {
            canvasId: request.canvasId,
            elementId: deleted.id,
            nowMs: request.nowMs,
          });
          deletedItemIds.push(deleted.id);
        }

        return {
          status: "committed",
          revision: nonNegativeSafeInteger(canvas.revision, "Canvas revision"),
          changedItems,
          deletedItemIds,
        };
      },
    });
  }
}
