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
} from "@omnidraw/canvas-contract";
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
      revision: number | null;
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
  canvas_id: string;
  id: string;
  item_json: string;
  item_revision: unknown;
  created_at_sec: unknown;
  updated_at_sec: unknown;
  kind: string;
  parent_id: string | null;
  order_key: string;
  widget_instance_id: string | null;
  widget_key: string | null;
}>;

type TWidgetInstanceIdentity = Readonly<{
  instanceId: string;
  widgetKey: string;
}>;

type TCanvasImageResourceClaim = Readonly<{
  resourceId: string;
  url: string;
  mimeType: string;
}>;

const ITEM_SELECT = `
  SELECT
    canvas_id,
    id,
    item_json,
    item_revision,
    created_at_sec,
    updated_at_sec,
    kind,
    parent_id,
    order_key,
    widget_instance_id,
    widget_key
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

function wholeSecondTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
  ) {
    throw new CanvasItemStoreError(
      "CANVAS_ITEM_ROW_INVALID",
      `${label} must be a UTC whole-second timestamp.`,
    );
  }
  return value;
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
  widgetInstanceIdentity(row);
  return {
    id: row.id,
    item: item as TCanvasItem,
    itemRevision: nonNegativeSafeInteger(row.item_revision, "Canvas item revision"),
    createdAtSec: wholeSecondTimestamp(row.created_at_sec, "Canvas item creation time"),
    updatedAtSec: wholeSecondTimestamp(row.updated_at_sec, "Canvas item update time"),
  };
}

function widgetInstanceIdentity(
  row: TStoredCanvasItemRow,
): TWidgetInstanceIdentity | null {
  if (
    row.widget_instance_id === null
    && row.widget_key === null
  ) {
    return null;
  }
  if (
    row.widget_instance_id === null
    || row.widget_key === null
  ) {
    throw new CanvasItemStoreError(
      "CANVAS_ITEM_ROW_INVALID",
      `Canvas item '${row.id}' has an incomplete widget identity projection.`,
    );
  }
  return {
    instanceId: row.widget_instance_id,
    widgetKey: row.widget_key,
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
  if (query.filter.type === "widget-key") {
    if (row.widget_instance_id === null) {
      throw new CanvasItemStoreError(
        "CANVAS_ITEM_ROW_INVALID",
        "Widget-key query returned an item without complete identity.",
      );
    }
    return {
      type: "widget-identity",
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

/** Single-user JSONB persistence used by the authoritative CanvasService. */
export class CanvasItemStoreTurso {
  constructor(private readonly database: Database) {}

  async getRevision(
    request: Readonly<{ canvasId: string }>,
  ): Promise<number | null> {
    const row = await (await this.database.prepare(`
      SELECT revision
      FROM canvases
      WHERE id = ?
    `)).get(request.canvasId) as { revision: unknown } | null;
    if (!row) return null;
    return nonNegativeSafeInteger(row.revision, "Canvas revision");
  }

  getSnapshot(
    request: Readonly<{ canvasId: string }>,
  ): Promise<TCanvasSnapshot | null> {
    return txRunDatabaseTransaction({ database: this.database }, {
      mode: "deferred",
      operation: async () => {
        const revision = await this.getRevision(request);
        if (revision === null) return null;
        const rows = await (await this.database.prepare(`
          ${ITEM_SELECT}
          WHERE canvas_id = ?
          ORDER BY id ASC
        `)).all(request.canvasId) as TStoredCanvasItemRow[];
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
    query: TCanvasItemQuery,
  ): Promise<TCanvasItemPage> {
    const limit = queryLimit(query);
    const parameters: Array<string | number | null> = [
      query.canvasId,
    ];
    let predicate = "canvas_id = ?";
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
      case "widget-key": {
        assertCursorType(query.cursor, "widget-identity");
        predicate += " AND widget_key = ?";
        parameters.push(query.filter.widgetKey);
        ordering = "widget_instance_id ASC, id ASC";
        if (query.cursor?.type === "widget-identity") {
          predicate += `
            AND (
              widget_instance_id > ?
              OR (widget_instance_id = ? AND id > ?)
            )
          `;
          parameters.push(
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

  async queryImageResourceClaims(
    request: Readonly<{
      canvasId: string;
      resourceIds: readonly string[];
      excludeItemIds: readonly string[];
      limit: number;
    }>,
  ): Promise<readonly TCanvasImageResourceClaim[]> {
    const resourceIds = [...new Set(request.resourceIds)];
    const excludeItemIds = [...new Set(request.excludeItemIds)];
    if (
      resourceIds.length < 1
      || resourceIds.some((resourceId) => (
        typeof resourceId !== "string" || resourceId.length === 0
      ))
      || excludeItemIds.some((itemId) => (
        typeof itemId !== "string" || itemId.length === 0
      ))
      || !Number.isSafeInteger(request.limit)
      || request.limit < 1
    ) {
      throw new CanvasItemStoreError(
        "CANVAS_ITEM_QUERY_INVALID",
        "Image resource claim queries require resource IDs and a positive limit.",
      );
    }

    const resourcePath = "json_extract(item_json, '$.resourceId')";
    const urlPath = "json_extract(item_json, '$.extensions.\"omnidraw:image\".url')";
    const mimeTypePath = "json_extract(item_json, '$.extensions.\"omnidraw:image\".mimeType')";
    const parameters: Array<string | number> = [
      request.canvasId,
      ...resourceIds,
    ];
    let exclusions = "";
    if (excludeItemIds.length > 0) {
      exclusions = `AND id NOT IN (${excludeItemIds.map(() => "?").join(", ")})`;
      parameters.push(...excludeItemIds);
    }
    parameters.push(request.limit);
    const rows = await (await this.database.prepare(`
      SELECT DISTINCT
        ${resourcePath} AS resource_id,
        ${urlPath} AS url,
        ${mimeTypePath} AS mime_type
      FROM canvas_items
      WHERE canvas_id = ?
        AND kind = 'image'
        AND ${resourcePath} IN (${resourceIds.map(() => "?").join(", ")})
        ${exclusions}
      ORDER BY resource_id, url, mime_type
      LIMIT ?
    `)).all(...parameters) as Array<{
      resource_id: unknown;
      url: unknown;
      mime_type: unknown;
    }>;
    return rows.map((row) => {
      if (
        typeof row.resource_id !== "string"
        || row.resource_id.length === 0
        || typeof row.url !== "string"
        || row.url.trim().length === 0
        || typeof row.mime_type !== "string"
        || row.mime_type.length === 0
      ) {
        throw new CanvasItemStoreError(
          "CANVAS_ITEM_ROW_INVALID",
          "A stored image resource claim is invalid.",
        );
      }
      return {
        resourceId: row.resource_id,
        url: row.url,
        mimeType: row.mime_type,
      };
    });
  }

  async findByWidgetInstance(
    request: Readonly<{ instanceId: string }>,
  ): Promise<TLocatedCanvasItem | null> {
    const row = await (await this.database.prepare(`
      ${ITEM_SELECT}
      WHERE widget_instance_id = ?
    `)).get(request.instanceId) as TStoredCanvasItemRow | null;
    if (!row?.canvas_id) return null;
    return {
      canvasId: row.canvas_id,
      item: parseItemRow(row),
    };
  }

  applyMutations(
    request: TCanvasItemStoreApplyRequest,
  ): Promise<TCanvasItemStoreApplyResult> {
    assertApplyRequest(request);
    return txRunDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        const canvas = await (await this.database.prepare(`
          UPDATE canvases
          SET
            revision = revision + 1,
            updated_at_sec = CURRENT_TIMESTAMP
          WHERE id = ? AND revision = ?
          RETURNING revision
        `)).get(
          request.canvasId,
          request.expectedCanvasRevision,
        ) as { revision: unknown } | null;

        if (!canvas) {
          const current = await (await this.database.prepare(`
            SELECT revision
            FROM canvases
            WHERE id = ?
          `)).get(request.canvasId) as { revision: unknown } | null;
          if (!current) {
            return { status: "revision-conflict", revision: null };
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
                canvas_id,
                id,
                item_json,
                item_revision
              )
              VALUES (?, ?, ?, 0)
              ON CONFLICT (canvas_id, id) DO NOTHING
              RETURNING
                canvas_id,
                id,
                item_json,
                item_revision,
                created_at_sec,
                updated_at_sec,
                kind,
                parent_id,
                order_key,
                widget_instance_id,
                widget_key
            `)).get(
              request.canvasId,
              mutation.item.id,
              serializeItem(mutation.item),
            ) as TStoredCanvasItemRow | null;
            if (!row) {
              throw new CanvasItemStoreError(
                "CANVAS_ITEM_CONFLICT",
                `Canvas item '${mutation.item.id}' already exists.`,
              );
            }
            changedItems.push(parseItemRow(row));
            continue;
          }

          if (mutation.type === "replace") {
            const row = await (await this.database.prepare(`
              UPDATE canvas_items
              SET
                item_json = ?,
                item_revision = item_revision + 1,
                updated_at_sec = CURRENT_TIMESTAMP
              WHERE
                canvas_id = ?
                AND id = ?
                AND item_revision = ?
              RETURNING
                canvas_id,
                id,
                item_json,
                item_revision,
                created_at_sec,
                updated_at_sec,
                kind,
                parent_id,
                order_key,
                widget_instance_id,
                widget_key
            `)).get(
              serializeItem(mutation.item),
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
            changedItems.push(parseItemRow(row));
            continue;
          }

          const deleted = await (await this.database.prepare(`
            DELETE FROM canvas_items
            WHERE
              canvas_id = ?
              AND id = ?
              AND item_revision = ?
            RETURNING id
          `)).get(
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
