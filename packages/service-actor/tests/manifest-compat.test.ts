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
});
