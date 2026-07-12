import { describe, expect, test } from "bun:test";
import { ZActorDefinition, ZActorResource, ZActorResourceBinding, ZActorResourceKeyValue, ZDbResourceConfiguration, ZDbResourceMigrationBlock, ZDbResourceSchema, ZDbResourceSchemaMigration } from "../model";

describe("model", () => {
  test("accepts relative manifest paths", () => {
    const parsed = ZActorDefinition.safeParse({
      name: "Counter",
      slug: "counter",
      url: null,
      description: null,
      manifest_path: "widgets/counter/vibecanvas.json",
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00",
    });

    expect(parsed.success).toBe(true);
  });

  test("rejects absolute manifest paths", () => {
    const parsed = ZActorDefinition.safeParse({
      name: "Counter",
      slug: "counter",
      url: null,
      description: null,
      manifest_path: "/actors/counter/vibecanvas.json",
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00",
    });

    expect(parsed.success).toBe(false);
  });

  test("rejects traversal manifest paths", () => {
    const parsed = ZActorDefinition.safeParse({
      name: "Counter",
      slug: "counter",
      url: null,
      description: null,
      manifest_path: "widgets/../counter/vibecanvas.json",
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00",
    });

    expect(parsed.success).toBe(false);
  });

  test("rejects backslash manifest paths", () => {
    const parsed = ZActorDefinition.safeParse({
      name: "Counter",
      slug: "counter",
      url: null,
      description: null,
      manifest_path: "widgets\\counter\\vibecanvas.json",
      created_at: "2026-01-01 00:00:00",
      updated_at: "2026-01-01 00:00:00",
    });

    expect(parsed.success).toBe(false);
  });

  test("parses actor resource and DbResource control rows", () => {
    const timestamps = { created_at: "2026-01-01 00:00:00", updated_at: "2026-01-01 00:00:00" };

    expect(ZActorResource.safeParse({
      id: "resource",
      kind: "secretStore",
      name: "Credentials",
      status: "ready",
      last_error: null,
      ...timestamps,
    }).success).toBe(true);
    expect(ZActorResourceBinding.parse({
      actor_definition_name: "Widget",
      slot_name: "credentials",
      resource_id: "resource",
      allow_read: 1,
      allow_write: 0,
      ...timestamps,
    })).toMatchObject({ allow_read: true, allow_write: false });
    expect(ZActorResourceKeyValue.safeParse({
      resource_id: "resource",
      key: "token",
      value: null,
      revision: 1,
      ...timestamps,
    }).success).toBe(true);
    expect(ZDbResourceSchema.safeParse({
      id: "notes",
      name: "Notes",
      description: null,
      status: "published",
      ...timestamps,
    }).success).toBe(true);
    expect(ZDbResourceSchemaMigration.safeParse({
      schema_id: "notes",
      version: 1,
      name: "initial",
      sql: "CREATE TABLE notes (id TEXT);",
      checksum: "sha256:abc",
      status: "published",
      created_at: timestamps.created_at,
      published_at: timestamps.updated_at,
    }).success).toBe(true);
    expect(ZDbResourceConfiguration.safeParse({
      resource_id: "resource",
      schema_id: "notes",
      applied_version: 0,
      target_version: 1,
      ...timestamps,
    }).success).toBe(true);
    expect(ZDbResourceMigrationBlock.parse({
      resource_id: "resource",
      actor_instance_id: "actor",
      reason: "versionMismatch",
      restart_when_compatible: 1,
      expected_schema_id: "notes",
      expected_version: 1,
      actual_schema_id: "notes",
      actual_version: 2,
      ...timestamps,
    })).toMatchObject({ restart_when_compatible: true });
  });

  test("rejects invalid resource revisions, versions, and lifecycle discriminants", () => {
    const timestamps = { created_at: "2026-01-01 00:00:00", updated_at: "2026-01-01 00:00:00" };
    expect(ZActorResourceKeyValue.safeParse({
      resource_id: "resource",
      key: "key",
      value: true,
      revision: 0,
      ...timestamps,
    }).success).toBe(false);
    expect(ZDbResourceConfiguration.safeParse({
      resource_id: "resource",
      schema_id: "notes",
      applied_version: -1,
      target_version: 0,
      ...timestamps,
    }).success).toBe(false);
    expect(ZDbResourceSchema.safeParse({
      id: "notes",
      name: "Notes",
      description: null,
      status: "active",
      ...timestamps,
    }).success).toBe(false);
  });
});
