import { afterEach, describe, expect, test } from "bun:test";
import { connect, type Database } from "@tursodatabase/database";
import type { TCanvasItemSnapshot } from "@vibecanvas/canvas-contract";
import {
  CanvasItemStoreError,
  CanvasItemStoreTurso,
} from "../CanvasItemStoreTurso";
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from "../CONSTANTS";
import {
  WIDGET_CAPSULE_ARTIFACT_HASH,
  WIDGET_CAPSULE_BUILD_IDENTITY_JSON,
  WIDGET_CAPSULE_BUILD_POLICY_ID,
  WIDGET_CAPSULE_CAPABILITY_DIGEST,
  WIDGET_CAPSULE_CHANNEL_DIGEST,
  WIDGET_CAPSULE_RUNTIME_JSON,
  widgetManifestV3Json,
} from "./widget-capsule-fixture";

type TCanvasItem = TCanvasItemSnapshot["item"];

const ORG_A = DEFAULT_OSS_ORGANIZATION_ID;
const ACCOUNT_A = DEFAULT_OSS_ACCOUNT_ID;
const ORG_B = "canvas-store-org-b";
const CANVAS_A = "canvas-store-a";
const CANVAS_A_SECOND = "canvas-store-a-second";
const CANVAS_B = "canvas-store-b";

const TENANT_A = {
  orgId: ORG_A,
  accountId: ACCOUNT_A,
  cellId: "cell-a",
  placementEpoch: 1,
  roles: ["owner"],
  capabilities: ["*"],
  requestId: "canvas-store-a",
} as const;

const TENANT_B = {
  ...TENANT_A,
  orgId: ORG_B,
  cellId: "cell-b",
  requestId: "canvas-store-b",
} as const;

const transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

const databases: Database[] = [];

function group(
  id: string,
  parentId: string | null = null,
  orderKey = "A",
): TCanvasItem {
  return {
    id,
    parentId,
    orderKey,
    kind: "group",
    transform,
  };
}

function rect(
  id: string,
  parentId: string | null = null,
  orderKey = "A",
): TCanvasItem {
  return {
    id,
    parentId,
    orderKey,
    kind: "rect",
    transform,
    size: { width: 100, height: 60 },
  };
}

function widget(
  id: string,
  parentId: string | null,
  orderKey: string,
  instanceId = "instance-a",
  definitionId = "definition-a",
  revisionId = "revision-a",
): TCanvasItem {
  return {
    id,
    parentId,
    orderKey,
    kind: "widget-frame",
    transform,
    size: { width: 320, height: 240 },
    extensions: {
      "vibecanvas:widget": {
        schemaVersion: 1,
        type: "widget-instance",
        instanceId,
        definitionId,
        revisionId,
      },
    },
  };
}

async function openDatabase(): Promise<Database> {
  const database = await connect(":memory:", {
    experimental: ["custom_types", "generated_columns"] as never,
  });
  databases.push(database);
  await database.exec("PRAGMA foreign_keys = ON");
  await database.exec("PRAGMA ignore_check_constraints = 0");
  await database.exec(
    await Bun.file(new URL("../migrations/000-initial.sql", import.meta.url)).text(),
  );
  return database;
}

async function seedOrganizationB(database: Database): Promise<void> {
  await (await database.prepare(`
    INSERT INTO organizations (
      id, slug, name, status, created_at_ms, updated_at_ms
    ) VALUES (?, 'canvas-store-b', 'Canvas Store B', 'active', 0, 0)
  `)).run(ORG_B);
  await (await database.prepare(`
    INSERT INTO organization_memberships (
      org_id, account_id, role, status, is_billable_seat, created_at_ms, updated_at_ms
    ) VALUES (?, ?, 'owner', 'active', 1, 0, 0)
  `)).run(ORG_B, ACCOUNT_A);
}

async function seedCanvas(
  database: Database,
  orgId: string,
  canvasId: string,
): Promise<void> {
  await (await database.prepare(`
    INSERT INTO canvases (
      org_id,
      id,
      name,
      access_policy,
      created_by_account_id,
      created_at_ms,
      updated_at_ms
    ) VALUES (?, ?, ?, 'restricted', ?, 1, 1)
  `)).run(orgId, canvasId, canvasId, ACCOUNT_A);
  await (await database.prepare(`
    INSERT INTO canvas_members (
      org_id, canvas_id, account_id, role, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, 'owner', 1, 1)
  `)).run(orgId, canvasId, ACCOUNT_A);
}

async function seedWidgetRevision(
  database: Database,
  orgId: string,
  args: Readonly<{
    definitionId: string;
    digestCharacter: string;
    revisionId: string;
    suffix: string;
  }>,
): Promise<void> {
  const artifactId = `ui-artifact-${args.suffix}`;
  await (await database.prepare(`
    INSERT INTO artifact_references (
      org_id,
      id,
      kind,
      digest_sha256,
      byte_size,
      retention_state,
      retain_until_ms,
      created_at_ms
    ) VALUES (?, ?, 'ui', ?, 1, 'pinned', NULL, 1)
  `)).run(
    orgId,
    artifactId,
    args.digestCharacter.repeat(64),
  );
  await (await database.prepare(`
    INSERT INTO widget_definitions (
      org_id,
      id,
      slug,
      name,
      status,
      active_revision_id,
      created_at_ms,
      updated_at_ms
    ) VALUES (?, ?, ?, ?, 'draft', NULL, 1, 1)
  `)).run(
    orgId,
    args.definitionId,
    `widget-${args.suffix}`,
    `Widget ${args.suffix}`,
  );
  await (await database.prepare(`
    INSERT INTO widget_definition_revisions (
      org_id,
      id,
      definition_id,
      revision_number,
      ui_artifact_id,
      ui_artifact_kind,
      manifest_json,
      contract_digest_sha256,
      created_at_ms,
      ui_runtime_json,
      capsule_artifact_hash,
      capability_contract_digest_sha256,
      channel_contract_digest_sha256,
      capsule_build_identity_json,
      build_policy_id,
      contract_format_version
    ) VALUES (?, ?, ?, 1, ?, 'ui', ?, ?, 1, ?, ?, ?, ?, ?, ?, 3)
  `)).run(
    orgId,
    args.revisionId,
    args.definitionId,
    artifactId,
    widgetManifestV3Json({
      name: `Widget ${args.suffix}`,
      slug: `widget-${args.suffix}`,
    }),
    "c".repeat(64),
    WIDGET_CAPSULE_RUNTIME_JSON,
    WIDGET_CAPSULE_ARTIFACT_HASH,
    WIDGET_CAPSULE_CAPABILITY_DIGEST,
    WIDGET_CAPSULE_CHANNEL_DIGEST,
    WIDGET_CAPSULE_BUILD_IDENTITY_JSON,
    WIDGET_CAPSULE_BUILD_POLICY_ID,
  );
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("CanvasItemStoreTurso", () => {
  test("commits JSONB items and serves bounded indexed queries", async () => {
    const database = await openDatabase();
    await seedCanvas(database, ORG_A, CANVAS_A);
    await seedWidgetRevision(database, ORG_A, {
      definitionId: "definition-a",
      digestCharacter: "a",
      revisionId: "revision-a",
      suffix: "a",
    });
    const store = new CanvasItemStoreTurso(database);

    expect(await store.getRevision(TENANT_A, { canvasId: CANVAS_A })).toBe(0);
    expect(await store.applyMutations(TENANT_A, {
      canvasId: CANVAS_A,
      expectedCanvasRevision: 0,
      nowMs: 10,
      mutations: [
        { type: "insert", item: group("root") },
        { type: "insert", item: rect("child", "root", "A") },
        { type: "insert", item: widget("widget", "root", "B") },
      ],
    })).toMatchObject({
      status: "committed",
      revision: 1,
      changedItems: [
        { id: "root", itemRevision: 0 },
        { id: "child", itemRevision: 0 },
        { id: "widget", itemRevision: 0 },
      ],
      deletedItemIds: [],
    });

    expect(await (await database.prepare(`
      SELECT
        typeof(item_json) AS storage_type,
        kind,
        parent_id,
        order_key,
        widget_instance_id,
        definition_id,
        revision_id
      FROM canvas_items
      WHERE org_id = ? AND canvas_id = ? AND id = 'widget'
    `)).get(ORG_A, CANVAS_A)).toEqual({
      storage_type: "blob",
      kind: "widget-frame",
      parent_id: "root",
      order_key: "B",
      widget_instance_id: "instance-a",
      definition_id: "definition-a",
      revision_id: "revision-a",
    });
    expect(await (await database.prepare(`
      SELECT
        id,
        canvas_id,
        element_id,
        definition_id,
        revision_id,
        status
      FROM widget_instances
      WHERE org_id = ? AND id = 'instance-a'
    `)).get(ORG_A)).toEqual({
      id: "instance-a",
      canvas_id: CANVAS_A,
      element_id: "widget",
      definition_id: "definition-a",
      revision_id: "revision-a",
      status: "active",
    });

    const firstChildren = await store.queryItems(TENANT_A, {
      canvasId: CANVAS_A,
      filter: { type: "parent", parentId: "root" },
      limit: 1,
    });
    expect(firstChildren.items.map((item) => item.id)).toEqual(["child"]);
    expect(firstChildren.nextCursor).toEqual({
      type: "parent-order",
      orderKey: "A",
      id: "child",
    });
    expect((await store.queryItems(TENANT_A, {
      canvasId: CANVAS_A,
      filter: { type: "parent", parentId: "root" },
      limit: 1,
      cursor: firstChildren.nextCursor ?? undefined,
    })).items.map((item) => item.id)).toEqual(["widget"]);

    expect((await store.queryItems(TENANT_A, {
      canvasId: CANVAS_A,
      filter: {
        type: "widget-definition",
        definitionId: "definition-a",
        revisionId: "revision-a",
      },
    })).items.map((item) => item.id)).toEqual(["widget"]);
    expect(await store.findByWidgetInstance(TENANT_A, {
      instanceId: "instance-a",
    })).toMatchObject({
      canvasId: CANVAS_A,
      item: { id: "widget" },
    });

    expect(await store.getSnapshot(TENANT_A, {
      canvasId: CANVAS_A,
    })).toMatchObject({
      canvasId: CANVAS_A,
      revision: 1,
      items: [
        { id: "root" },
        { id: "child" },
        { id: "widget" },
      ],
    });
  });

  test("rolls back a whole mutation batch on revision and item conflicts", async () => {
    const database = await openDatabase();
    await seedCanvas(database, ORG_A, CANVAS_A);
    const store = new CanvasItemStoreTurso(database);

    await store.applyMutations(TENANT_A, {
      canvasId: CANVAS_A,
      expectedCanvasRevision: 0,
      nowMs: 10,
      mutations: [
        { type: "insert", item: group("root") },
        { type: "insert", item: rect("child", "root") },
      ],
    });

    expect(await store.applyMutations(TENANT_A, {
      canvasId: CANVAS_A,
      expectedCanvasRevision: 0,
      nowMs: 20,
      mutations: [{ type: "insert", item: rect("stale") }],
    })).toEqual({ status: "revision-conflict", revision: 1 });

    const conflicting = store.applyMutations(TENANT_A, {
      canvasId: CANVAS_A,
      expectedCanvasRevision: 1,
      nowMs: 20,
      mutations: [
        { type: "insert", item: rect("rolled-back") },
        {
          type: "replace",
          item: rect("child", "root", "B"),
          expectedItemRevision: 99,
        },
      ],
    });
    await expect(conflicting).rejects.toMatchObject({
      name: CanvasItemStoreError.name,
      code: "CANVAS_ITEM_CONFLICT",
    });

    expect(await store.getRevision(TENANT_A, { canvasId: CANVAS_A })).toBe(1);
    expect((await store.queryItems(TENANT_A, {
      canvasId: CANVAS_A,
      filter: { type: "ids", ids: ["rolled-back"] },
    })).items).toEqual([]);

    expect(await store.applyMutations(TENANT_A, {
      canvasId: CANVAS_A,
      expectedCanvasRevision: 1,
      nowMs: 30,
      mutations: [{
        type: "replace",
        item: rect("child", "root", "B"),
        expectedItemRevision: 0,
      }],
    })).toMatchObject({
      status: "committed",
      revision: 2,
      changedItems: [{ id: "child", itemRevision: 1 }],
    });
    expect(await store.applyMutations(TENANT_A, {
      canvasId: CANVAS_A,
      expectedCanvasRevision: 2,
      nowMs: 40,
      mutations: [{
        type: "delete",
        itemId: "child",
        expectedItemRevision: 1,
      }],
    })).toEqual({
      status: "committed",
      revision: 3,
      changedItems: [],
      deletedItemIds: ["child"],
    });
  });

  test("synchronizes widget metadata and rolls back unsafe identity replacement", async () => {
    const database = await openDatabase();
    await seedCanvas(database, ORG_A, CANVAS_A);
    await seedWidgetRevision(database, ORG_A, {
      definitionId: "definition-a",
      digestCharacter: "a",
      revisionId: "revision-a",
      suffix: "a",
    });
    await seedWidgetRevision(database, ORG_A, {
      definitionId: "definition-b",
      digestCharacter: "b",
      revisionId: "revision-b",
      suffix: "b",
    });
    const store = new CanvasItemStoreTurso(database);

    await store.applyMutations(TENANT_A, {
      canvasId: CANVAS_A,
      expectedCanvasRevision: 0,
      nowMs: 10,
      mutations: [
        {
          type: "insert",
          item: widget("widget", null, "A"),
        },
        {
          type: "insert",
          item: widget(
            "transition",
            null,
            "B",
            "instance-transition",
          ),
        },
      ],
    });
    expect(await (await database.prepare(`
      SELECT id, element_id, definition_id, revision_id, status
      FROM widget_instances
      WHERE org_id = ?
      ORDER BY id ASC
    `)).all(ORG_A)).toEqual([
      {
        id: "instance-a",
        element_id: "widget",
        definition_id: "definition-a",
        revision_id: "revision-a",
        status: "active",
      },
      {
        id: "instance-transition",
        element_id: "transition",
        definition_id: "definition-a",
        revision_id: "revision-a",
        status: "active",
      },
    ]);

    await store.applyMutations(TENANT_A, {
      canvasId: CANVAS_A,
      expectedCanvasRevision: 1,
      nowMs: 20,
      mutations: [{
        type: "replace",
        item: widget(
          "widget",
          null,
          "A",
          "instance-a",
          "definition-b",
          "revision-b",
        ),
        expectedItemRevision: 0,
      }],
    });
    expect(await (await database.prepare(`
      SELECT definition_id, revision_id, status
      FROM widget_instances
      WHERE org_id = ? AND id = 'instance-a'
    `)).get(ORG_A)).toEqual({
      definition_id: "definition-b",
      revision_id: "revision-b",
      status: "active",
    });

    await (await database.prepare(`
      INSERT INTO widget_instance_states (
        org_id,
        widget_instance_id,
        version,
        state_json,
        created_at_ms,
        updated_at_ms
      ) VALUES (?, 'instance-a', 1, jsonb('{"count":1}'), 20, 20)
    `)).run(ORG_A);

    await expect(store.applyMutations(TENANT_A, {
      canvasId: CANVAS_A,
      expectedCanvasRevision: 2,
      nowMs: 30,
      mutations: [{
        type: "replace",
        item: widget(
          "widget",
          null,
          "A",
          "instance-replacement",
          "definition-b",
          "revision-b",
        ),
        expectedItemRevision: 1,
      }],
    })).rejects.toMatchObject({
      name: CanvasItemStoreError.name,
      code: "CANVAS_ITEM_CONFLICT",
    });
    expect(await store.getRevision(TENANT_A, { canvasId: CANVAS_A })).toBe(2);
    expect((await store.queryItems(TENANT_A, {
      canvasId: CANVAS_A,
      filter: { type: "ids", ids: ["widget"] },
    })).items[0]).toMatchObject({
      itemRevision: 1,
      item: {
        extensions: {
          "vibecanvas:widget": {
            instanceId: "instance-a",
            definitionId: "definition-b",
            revisionId: "revision-b",
          },
        },
      },
    });
    expect(await (await database.prepare(`
      SELECT id, status
      FROM widget_instances
      WHERE org_id = ? AND element_id = 'widget'
    `)).get(ORG_A)).toEqual({
      id: "instance-a",
      status: "active",
    });

    await store.applyMutations(TENANT_A, {
      canvasId: CANVAS_A,
      expectedCanvasRevision: 2,
      nowMs: 40,
      mutations: [{
        type: "replace",
        item: rect("transition", null, "B"),
        expectedItemRevision: 0,
      }],
    });
    expect(await (await database.prepare(`
      SELECT status
      FROM widget_instances
      WHERE org_id = ? AND id = 'instance-transition'
    `)).get(ORG_A)).toEqual({ status: "archived" });

    await store.applyMutations(TENANT_A, {
      canvasId: CANVAS_A,
      expectedCanvasRevision: 3,
      nowMs: 50,
      mutations: [{
        type: "delete",
        itemId: "widget",
        expectedItemRevision: 1,
      }],
    });
    expect(await (await database.prepare(`
      SELECT status
      FROM widget_instances
      WHERE org_id = ? AND id = 'instance-a'
    `)).get(ORG_A)).toEqual({ status: "archived" });
    expect(await (await database.prepare(`
      SELECT count(*) AS count
      FROM widget_instance_states
      WHERE org_id = ? AND widget_instance_id = 'instance-a'
    `)).get(ORG_A)).toEqual({ count: 1 });

    await store.applyMutations(TENANT_A, {
      canvasId: CANVAS_A,
      expectedCanvasRevision: 4,
      nowMs: 60,
      mutations: [{
        type: "insert",
        item: widget(
          "widget",
          null,
          "A",
          "instance-a",
          "definition-b",
          "revision-b",
        ),
      }],
    });
    expect(await (await database.prepare(`
      SELECT definition_id, revision_id, status
      FROM widget_instances
      WHERE org_id = ? AND id = 'instance-a'
    `)).get(ORG_A)).toEqual({
      definition_id: "definition-b",
      revision_id: "revision-b",
      status: "active",
    });
  });

  test("enforces JSONB projections, widget identity uniqueness, isolation, and cascades", async () => {
    const database = await openDatabase();
    await seedOrganizationB(database);
    await seedCanvas(database, ORG_A, CANVAS_A);
    await seedCanvas(database, ORG_A, CANVAS_A_SECOND);
    await seedCanvas(database, ORG_B, CANVAS_B);
    await seedWidgetRevision(database, ORG_A, {
      definitionId: "definition-a",
      digestCharacter: "a",
      revisionId: "revision-a",
      suffix: "a",
    });
    await seedWidgetRevision(database, ORG_B, {
      definitionId: "definition-a",
      digestCharacter: "a",
      revisionId: "revision-a",
      suffix: "a",
    });
    const store = new CanvasItemStoreTurso(database);

    const insertSql = `
      INSERT INTO canvas_items (
        org_id, canvas_id, id, item_json, item_revision, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, 0, 1, 1)
    `;
    const insert = await database.prepare(insertSql);
    await expect(insert.run(
      ORG_A,
      CANVAS_A,
      "text-json",
      JSON.stringify(rect("text-json")),
    )).rejects.toThrow();
    await expect(insert.run(
      ORG_A,
      CANVAS_A,
      "invalid-jsonb",
      new Uint8Array([1, 2, 3]),
    )).rejects.toThrow();

    await expect((await database.prepare(`
      INSERT INTO canvas_items (
        org_id, canvas_id, id, item_json, item_revision, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, jsonb(?), 0, 1, 1)
    `)).run(
      ORG_A,
      CANVAS_A,
      "row-id",
      JSON.stringify(rect("json-id")),
    )).rejects.toThrow();
    await expect((await database.prepare(`
      INSERT INTO canvas_items (
        org_id, canvas_id, id, item_json, item_revision, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, jsonb(?), 0, 1, 1)
    `)).run(
      ORG_A,
      CANVAS_A,
      "incomplete-widget",
      JSON.stringify({
        ...widget("incomplete-widget", null, "A"),
        extensions: {
          "vibecanvas:widget": {
            schemaVersion: 1,
            type: "widget-instance",
            instanceId: "incomplete",
          },
        },
      }),
    )).rejects.toThrow();
    await expect((await database.prepare(`
      INSERT INTO canvas_items (
        org_id, canvas_id, id, item_json, item_revision, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, jsonb(?), 0, 1, 1)
    `)).run(
      ORG_A,
      CANVAS_A,
      "missing-widget-identity",
      JSON.stringify({
        ...widget("missing-widget-identity", null, "A"),
        extensions: {
          "vibecanvas:widget": {
            schemaVersion: 1,
            type: "widget-instance",
          },
        },
      }),
    )).rejects.toThrow();
    await store.applyMutations(TENANT_A, {
      canvasId: CANVAS_A,
      expectedCanvasRevision: 0,
      nowMs: 10,
      mutations: [{
        type: "insert",
        item: widget("widget-a", null, "A", "shared-instance"),
      }],
    });
    await expect(store.applyMutations(TENANT_A, {
      canvasId: CANVAS_A_SECOND,
      expectedCanvasRevision: 0,
      nowMs: 10,
      mutations: [{
        type: "insert",
        item: widget("widget-a-second", null, "A", "shared-instance"),
      }],
    })).rejects.toThrow();
    expect(await store.getRevision(TENANT_A, {
      canvasId: CANVAS_A_SECOND,
    })).toBe(0);

    await store.applyMutations(TENANT_B, {
      canvasId: CANVAS_B,
      expectedCanvasRevision: 0,
      nowMs: 10,
      mutations: [{
        type: "insert",
        item: widget("widget-b", null, "A", "shared-instance"),
      }],
    });
    expect(await store.findByWidgetInstance(TENANT_B, {
      instanceId: "shared-instance",
    })).toMatchObject({
      canvasId: CANVAS_B,
      item: { id: "widget-b" },
    });
    expect(await store.findByWidgetInstance({
      ...TENANT_A,
      orgId: "missing-org",
    }, {
      instanceId: "shared-instance",
    })).toBeNull();

    await (await database.prepare(`
      DELETE FROM canvases WHERE org_id = ? AND id = ?
    `)).run(ORG_B, CANVAS_B);
    expect(await (await database.prepare(`
      SELECT count(*) AS count
      FROM canvas_items
      WHERE org_id = ? AND canvas_id = ?
    `)).get(ORG_B, CANVAS_B)).toEqual({ count: 0 });
  });
});
