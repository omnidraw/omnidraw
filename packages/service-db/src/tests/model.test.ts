import { describe, expect, test } from "bun:test";
import { ZActorDefinition } from "../model";

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
});

