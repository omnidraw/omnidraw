import { describe, expect, test } from "bun:test";
import { ZActorDefinition, ZActorResource, ZActorResourceBinding, ZActorResourceKeyValue, ZDbResourceApplyInstanceResult, ZDbResourceApplyRun, ZDbResourceDraft, ZDbResourceDraftChange } from "../model";

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
    expect(ZDbResourceDraft.safeParse({
      id: "draft",
      resource_id: "resource",
      name: "Add notes",
      status: "editing",
      last_error: null,
      ...timestamps,
      applied_at: null,
    }).success).toBe(true);
    expect(ZDbResourceDraftChange.safeParse({
      draft_id: "draft",
      sequence: 1,
      kind: "structure",
      operation: { type: "createTable", table: "notes" },
      sql: "CREATE TABLE notes (id TEXT);",
      created_at: timestamps.created_at,
    }).success).toBe(true);
    expect(ZDbResourceApplyRun.parse({
      id: "apply",
      resource_id: "resource",
      draft_id: "draft",
      source_apply_id: null,
      status: "restarting",
      last_error: null,
      backup_retained: 1,
      created_at: timestamps.created_at,
      completed_at: null,
    })).toMatchObject({ backup_retained: true });
    expect(ZDbResourceApplyInstanceResult.parse({
      apply_id: "apply",
      actor_instance_id: "actor",
      actor_definition_name: "Widget",
      was_running: 1,
      status: "restarted",
      error: null,
      updated_at: timestamps.updated_at,
    })).toMatchObject({ was_running: true });
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
    expect(ZDbResourceDraftChange.safeParse({
      draft_id: "draft",
      sequence: 0,
      kind: "structure",
      operation: null,
      sql: "SELECT 1",
      created_at: timestamps.created_at,
    }).success).toBe(false);
    expect(ZDbResourceDraft.safeParse({
      id: "draft",
      resource_id: "resource",
      name: "Draft",
      status: "published",
      last_error: null,
      ...timestamps,
      applied_at: null,
    }).success).toBe(false);
  });
});
