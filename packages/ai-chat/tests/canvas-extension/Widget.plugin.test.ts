import { AsyncParallelHook, SyncHook } from "@vibecanvas/tapable";
import { describe, expect, test, vi } from "vitest";
import type { TWidgetCatalog, TWidgetVariantSummary } from "@vibecanvas/orpc-client";
import { createWidgetPlugin } from "../../src/canvas-extension/Widget.plugin";

function publishedVariant(revision: string): TWidgetVariantSummary {
  return {
    source: "published",
    displayName: "Weather",
    kind: "widget",
    slug: "weather",
    description: null,
    revision,
    contentFingerprint: revision,
    updatedAt: "2026-07-20T00:00:00.000Z",
    tool: {
      label: "Weather",
      icon: null,
      group: null,
      priority: null,
      behaviorType: "mode",
    },
    validation: null,
    placement: {
      reference: { source: "published", name: "Weather", revision },
      bounds: { width: 360, height: 320 },
    },
  };
}

function widgetCatalog(revision: string): TWidgetCatalog {
  return {
    generation: revision,
    groups: [],
    widgets: [{
      name: "Weather",
      relation: "published-only",
      published: publishedVariant(revision),
      draft: null,
      preview: null,
      problem: null,
    }],
  };
}

describe("Widget plugin catalog reconciliation", () => {
  test("keeps an unchanged published widget mounted across catalog refreshes", async () => {
    let catalog = widgetCatalog("revision-1");
    let updatedAt = "2026-07-20T00:00:00.000Z";
    let invalidateCatalog = () => undefined;
    const list = vi.fn(async () => [undefined, [{
      name: "Weather",
      health: "ready",
      error: null,
      updated_at: updatedAt,
    }]] as const);
    const get = vi.fn(async () => [undefined, {
      def: {
        name: "Weather",
        widget: { tool: { label: "Weather", icon: null } },
      },
      widgetCode: [{ path: "main.ts", content: "export default {}" }],
    }] as const);
    const catalogRequest = vi.fn(async () => [undefined, catalog] as const);
    const registerWidget = vi.fn();
    const cancelActiveIfUnavailable = vi.fn();
    const hooks = {
      init: new SyncHook(),
      initAsync: new AsyncParallelHook(),
      destroy: new SyncHook(),
    };
    const plugin = createWidgetPlugin({
      application: {
        invalidateResourceCatalog: vi.fn(),
        logError: vi.fn(),
        subscribeCatalogInvalidation: (_kind, listener) => {
          invalidateCatalog = listener;
          return vi.fn();
        },
      },
      transport: {
        api: {
          actors: { definitions: { list, get } },
          agent: { widgets: { catalog: catalogRequest } },
        },
      },
      widgetManager: {
        registerWidget,
        unregisterWidget: vi.fn(),
        registerPlacementTool: vi.fn(),
        unregisterPlacementTool: vi.fn(),
        setDefinitionError: vi.fn(),
        setGlobalDefinitionError: vi.fn(),
        completeDefinitionDiscovery: vi.fn(),
      },
      widgetPlacement: {
        createDropRequest: vi.fn((args) => args),
        cancelActiveIfUnavailable,
      },
    } as never);

    plugin.apply({ hooks } as never);
    hooks.init.call();
    await hooks.initAsync.promise();

    expect(registerWidget).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();

    invalidateCatalog();
    await vi.waitFor(() => expect(catalogRequest).toHaveBeenCalledTimes(2));
    expect(registerWidget).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
    expect(cancelActiveIfUnavailable).toHaveBeenLastCalledWith([
      { source: "published", name: "Weather", revision: "revision-1" },
    ]);

    catalog = widgetCatalog("revision-2");
    updatedAt = "2026-07-20T00:01:00.000Z";
    invalidateCatalog();
    await vi.waitFor(() => expect(registerWidget).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenCalledTimes(2);
    expect(cancelActiveIfUnavailable).toHaveBeenLastCalledWith([
      { source: "published", name: "Weather", revision: "revision-2" },
    ]);

    hooks.destroy.call();
  });
});
