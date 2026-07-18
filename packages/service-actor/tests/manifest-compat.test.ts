import { describe, expect, test } from "bun:test";
import { fnNormalizeVibecanvasJson } from "../src/core/fn.normalize-actor-manifest";
import type { TTransition, TVibecanvasJson } from "../src/core/types";
import { ZVibecanvasJson } from "../src/core/vibecanvasjson.zod";

function manifestWithTransition(transition: TTransition): TVibecanvasJson {
  return {
    slug: "compat",
    name: "Compat",
    actor: {
      relFunctionPath: "./actor/functions.ts",
      initialState: "ready",
      initialData: {},
      states: {
        ready: { on: { go: transition } },
        busy: { on: {} },
        waiting: { on: {} },
        error: { on: {} },
      },
      inputMsgSchema: { go: true },
    },
    widget: {
      relWidgetDir: "./widget",
      tool: { label: "Compat", behavior: { type: "action" } },
    },
  };
}

describe("actor manifest compatibility", () => {
  test("keeps manifests without resource declarations source-compatible", () => {
    const manifest = manifestWithTransition({ func: [], targetState: "busy" });

    const parsed = ZVibecanvasJson.safeParse(manifest);

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.actor.resources).toBeUndefined();
  });

  test("accepts optional persisted widget kind while keeping legacy manifests compatible", () => {
    const legacy = manifestWithTransition({ func: [], targetState: "busy" });
    const widget = { ...legacy, kind: "widget" as const };
    const actorWidget = { ...legacy, kind: "actor-widget" as const };

    expect(ZVibecanvasJson.safeParse(legacy).success).toBe(true);
    expect(ZVibecanvasJson.safeParse(widget)).toMatchObject({ success: true, data: { kind: "widget" } });
    expect(ZVibecanvasJson.safeParse(actorWidget)).toMatchObject({ success: true, data: { kind: "actor-widget" } });
    expect(ZVibecanvasJson.safeParse({ ...legacy, kind: "unknown" }).success).toBe(false);
  });

  test("normalizes new and single-target legacy transitions", () => {
    const modern = fnNormalizeVibecanvasJson(manifestWithTransition({ func: [], targetState: "busy" }));
    const legacy = fnNormalizeVibecanvasJson(manifestWithTransition({ func: [], allowedTargetStates: ["busy"] }));

    expect(modern.manifest.actor.states.ready?.on.go?.targetState).toBe("busy");
    expect(legacy.manifest.actor.states.ready?.on.go?.targetState).toBe("busy");
    expect(modern.warnings).toEqual([]);
    expect(legacy.warnings).toEqual([]);
  });

  test("preserves legacy zero and multiple target behavior as a self transition", () => {
    const empty = fnNormalizeVibecanvasJson(manifestWithTransition({ func: [], allowedTargetStates: [] }));
    const multiple = fnNormalizeVibecanvasJson(manifestWithTransition({ func: [], allowedTargetStates: ["busy", "waiting"] }));

    expect(empty.manifest.actor.states.ready?.on.go?.targetState).toBe("ready");
    expect(multiple.manifest.actor.states.ready?.on.go?.targetState).toBe("ready");
    expect(empty.warnings).toHaveLength(1);
    expect(multiple.warnings).toHaveLength(1);
  });

  test("accepts either transition form but rejects ambiguous transitions", () => {
    expect(ZVibecanvasJson.safeParse(manifestWithTransition({ func: [], targetState: "busy" })).success).toBe(true);
    expect(ZVibecanvasJson.safeParse(manifestWithTransition({ func: [], allowedTargetStates: ["busy"] })).success).toBe(true);
    expect(ZVibecanvasJson.safeParse(manifestWithTransition({
      func: [],
      targetState: "busy",
      allowedTargetStates: ["busy"],
    })).success).toBe(false);
  });

  test("validates activity interval bounds", () => {
    const manifest = manifestWithTransition({ func: [], targetState: "busy" });
    manifest.actor.states.busy = {
      on: {},
      activity: { everyMs: 999, func: ["fn.tick"] },
    };
    expect(ZVibecanvasJson.safeParse(manifest).success).toBe(false);
    manifest.actor.states.busy.activity = { everyMs: 1_000, func: ["fn.tick"] };
    expect(ZVibecanvasJson.safeParse(manifest).success).toBe(true);
  });

  test("accepts kv and secretStore slots and preserves exact slot names", () => {
    const manifest = manifestWithTransition({ func: [], targetState: "busy" });
    Object.assign(manifest.actor, { resources: {
      "User Preferences": { kind: "kv", required: true, scope: ["read", "write"] },
      credentials: { kind: "secretStore", required: false, scope: ["read"] },
    } });

    const parsed = ZVibecanvasJson.safeParse(manifest);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(Object.keys(parsed.data.actor.resources ?? {})).toEqual(["User Preferences", "credentials"]);
    expect(parsed.data.actor.resources).toEqual(manifest.actor.resources);
  });

  test("requires explicit required and a non-empty duplicate-free permission scope", () => {
    const manifest = manifestWithTransition({ func: [], targetState: "busy" });
    const parseSlot = (slot: unknown) => ZVibecanvasJson.safeParse({
      ...manifest,
      actor: { ...manifest.actor, resources: { storage: slot } },
    });

    expect(parseSlot({ kind: "kv", scope: ["read"] }).success).toBe(false);
    expect(parseSlot({ kind: "kv", required: true, scope: [] }).success).toBe(false);
    expect(parseSlot({ kind: "kv", required: true, scope: ["read", "read"] }).success).toBe(false);
    expect(parseSlot({ kind: "kv", required: true, scope: ["admin"] }).success).toBe(false);
    expect(parseSlot({ kind: "unknown", required: true, scope: ["read"] }).success).toBe(false);
  });

  test("rejects blank and overlong resource slot names without normalizing names", () => {
    const manifest = manifestWithTransition({ func: [], targetState: "busy" });
    const parseName = (name: string) => ZVibecanvasJson.safeParse({
      ...manifest,
      actor: {
        ...manifest.actor,
        resources: { [name]: { kind: "kv", required: true, scope: ["read"] } },
      },
    });

    expect(parseName("").success).toBe(false);
    expect(parseName("   ").success).toBe(false);
    expect(parseName("x".repeat(129)).success).toBe(false);
    expect(parseName(" Storage ").success).toBe(true);
  });

  test("accepts schema-agnostic db slots with named operations", () => {
    const manifest = manifestWithTransition({ func: [], targetState: "busy" });
    Object.assign(manifest.actor, { resources: {
      empty: {
        kind: "db",
        required: true,
        scope: ["read"],
      },
      notes: {
        kind: "db",
        required: true,
        scope: ["read", "write"],
        operations: {
          listNotes: {
            effect: "read",
            sql: "SELECT ';' AS marker FROM notes; -- one trailing terminator",
            result: "rows",
          },
          renameNote: {
            effect: "write",
            sql: "UPDATE notes SET title = :title WHERE id = :id",
            parameters: {
              id: { type: "string" },
              title: { type: "string", required: true, nullable: false },
            },
            result: "execute",
          },
        },
      },
    } });

    const parsed = ZVibecanvasJson.safeParse(manifest);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const empty = parsed.data.actor.resources?.empty;
    const notes = parsed.data.actor.resources?.notes;
    expect(empty?.kind === "db" && empty.arbitrarySql).toBe(false);
    expect(notes?.kind === "db" && notes.operations?.renameNote?.parameters?.id).toEqual({
      type: "string",
      required: true,
      nullable: false,
    });
  });

  test("rejects invalid db operation effects, identifiers, and parameter declarations", () => {
    const manifest = manifestWithTransition({ func: [], targetState: "busy" });
    const parseRequirement = (requirement: unknown) => ZVibecanvasJson.safeParse({
      ...manifest,
      actor: { ...manifest.actor, resources: { database: requirement } },
    });
    const base = {
      kind: "db",
      required: true,
      scope: ["read"],
    };

    expect(parseRequirement({
      ...base,
      operations: { mutate: { effect: "write", sql: "DELETE FROM notes", result: "execute" } },
    }).success).toBe(false);
    expect(parseRequirement({
      ...base,
      operations: { " ": { effect: "read", sql: "SELECT 1", result: "rows" } },
    }).success).toBe(false);
    expect(parseRequirement({
      ...base,
      operations: {
        read: {
          effect: "read",
          sql: "SELECT :value",
          result: "rows",
          parameters: { value: { type: "date" } },
        },
      },
    }).success).toBe(false);
  });

  test("rejects empty or multiple named SQL statements but permits semicolons in SQL literals", () => {
    const manifest = manifestWithTransition({ func: [], targetState: "busy" });
    const parseSql = (sql: string) => ZVibecanvasJson.safeParse({
      ...manifest,
      actor: {
        ...manifest.actor,
        resources: {
          database: {
            kind: "db",
            required: true,
            scope: ["read"],
            operations: { query: { effect: "read", sql, result: "rows" } },
          },
        },
      },
    });

    expect(parseSql("  -- no statement").success).toBe(false);
    expect(parseSql("SELECT 1; SELECT 2").success).toBe(false);
    expect(parseSql("SELECT 1;;").success).toBe(false);
    expect(parseSql("SELECT ';not a terminator' AS value").success).toBe(true);
    expect(parseSql("SELECT \"semi;colon\" FROM notes /* ; */;").success).toBe(true);
  });

  test("normalization preserves resource requirements", () => {
    const manifest = manifestWithTransition({ func: [], allowedTargetStates: ["busy"] });
    Object.assign(manifest.actor, { resources: {
      storage: { kind: "kv", required: true, scope: ["read", "write"] },
    } });

    const normalized = fnNormalizeVibecanvasJson(manifest);

    expect(normalized.manifest.actor.resources).toEqual(manifest.actor.resources);
  });

  test("rejects legacy db schema declarations", () => {
    const manifest = manifestWithTransition({ func: [], targetState: "busy" });
    Object.assign(manifest.actor, { resources: {
      primary: { kind: "db", required: true, scope: ["read"], schema: { id: "notes", version: 2 } },
      secondary: { kind: "db", required: false, scope: ["write"], schema: { id: "archive", version: 1 } },
    } });

    expect(ZVibecanvasJson.safeParse(manifest).success).toBe(false);
  });
});
