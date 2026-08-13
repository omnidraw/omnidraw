import { describe, expect, it, vi } from "vitest";
import type { IAiChatPort, TAiChatContextCatalog } from "../../../src/contracts";
import { createMentionCatalog } from "../../../src/chat/mention-catalog";
import { AiChatEffectRuntime } from "../../../src/internal/stream-lifecycle";

function testPort(read: () => TAiChatContextCatalog): IAiChatPort {
  return {
    actions: {
      getContextCatalog: vi.fn(async () => read()),
    } as IAiChatPort["actions"],
    events: async function*() {},
  };
}

describe("component mention catalog", () => {
  it("updates every subscriber from one runtime-owned catalog refresh", async () => {
    let resourceName = "Notes";
    const port = testPort(() => ({
      mentions: [{
        id: "resource:db-1",
        label: resourceName,
        kind: "Database resource",
        target: { type: "resource", resourceId: "db-1" },
        icon: { type: "resource", kind: "db" },
      }],
      resources: [{ id: "db-1", kind: "db", name: resourceName }],
    }));
    const runtime = new AiChatEffectRuntime();
    const catalog = createMentionCatalog(port, runtime);
    const first: string[][] = [];
    const second: string[][] = [];
    const unsubscribeFirst = catalog.subscribe((snapshot) => {
      first.push(snapshot.mentions.map((mention) => mention.label));
    });
    const unsubscribeSecond = catalog.subscribe((snapshot) => {
      second.push(snapshot.mentions.map((mention) => mention.label));
    });

    await vi.waitFor(() => expect(first.at(-1)).toEqual(["Notes"]));
    expect(second.at(-1)).toEqual(["Notes"]);
    expect(port.actions.getContextCatalog).toHaveBeenCalledTimes(1);

    resourceName = "Renamed notes";
    catalog.refresh();
    await vi.waitFor(() => expect(first.at(-1)).toEqual(["Renamed notes"]));

    expect(second.at(-1)).toEqual(["Renamed notes"]);
    unsubscribeFirst();
    unsubscribeSecond();
    catalog.dispose();
    await runtime.dispose();
  });

  it("rejects a stale catalog completion after disposal", async () => {
    let resolveCatalog: ((catalog: TAiChatContextCatalog) => void) | undefined;
    const port = testPort(() => ({ mentions: [], resources: [] }));
    port.actions.getContextCatalog = vi.fn(() => new Promise<TAiChatContextCatalog>((resolve) => {
      resolveCatalog = resolve;
    }));
    const runtime = new AiChatEffectRuntime();
    const catalog = createMentionCatalog(port, runtime);
    const listener = vi.fn();
    catalog.subscribe(listener);
    await vi.waitFor(() => expect(resolveCatalog).toBeTypeOf("function"));

    catalog.dispose();
    resolveCatalog?.({
      mentions: [{
        id: "resource:late",
        label: "Late",
        kind: "Database resource",
        target: { type: "resource", resourceId: "late" },
        icon: { type: "resource", kind: "db" },
      }],
      resources: [{ id: "late", kind: "db", name: "Late" }],
    });
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(catalog.snapshot().mentions).toEqual([]);
    await runtime.dispose();
  });
});
