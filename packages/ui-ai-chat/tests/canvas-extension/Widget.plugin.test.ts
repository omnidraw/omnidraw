import { AsyncParallelHook, SyncHook } from "@vibecanvas/tapable";
import { describe, expect, test, vi } from "vitest";
import type { TWidgetCatalog, TWidgetVariantSummary } from "@vibecanvas/orpc-client";
import { createWidgetPlugin } from "../../src/canvas-extension/Widget.plugin";
import { WidgetPlacementService } from "../../src/widget-placement/WidgetPlacementService";

const DEFINITION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const REVISION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7";

function publishedVariant(revision: string, referenceName = "Weather"): TWidgetVariantSummary {
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
      reference: { source: "published", name: referenceName, revision },
      bounds: { width: 360, height: 320 },
    },
  };
}

function widgetCatalog(revision: string, referenceName = "Weather"): TWidgetCatalog {
  return {
    generation: revision,
    groups: [],
    widgets: [{
      name: "Weather",
      relation: "published-only",
      published: publishedVariant(revision, referenceName),
      draft: null,
      preview: null,
      problem: null,
    }],
  };
}

describe("Widget plugin catalog reconciliation", () => {
  test("registers draft placement tools with the draft toolbar tone", async () => {
    const draft = { ...publishedVariant("revision-draft"), source: "draft" as const };
    draft.placement = {
      reference: { source: "draft", name: "Weather", revision: "revision-draft" },
      bounds: { width: 360, height: 320 },
    };
    const registerPlacementTool = vi.fn();
    const hooks = {
      init: new SyncHook(),
      initAsync: new AsyncParallelHook(),
      destroy: new SyncHook(),
    };
    const plugin = createWidgetPlugin({
      application: { logError: vi.fn() },
      transport: {
        api: {
          actors: { definitions: { list: vi.fn(async () => [undefined, []] as const) } },
          agent: { widgets: { catalog: vi.fn(async () => [undefined, {
            generation: "draft-only",
            groups: [],
            widgets: [{ name: "Weather", relation: "draft-only", published: null, draft, problem: null }],
          }] as const) } },
        },
      },
      widgetManager: {
        registerPlacementTool,
        unregisterPlacementTool: vi.fn(),
        unregisterWidget: vi.fn(),
        setGlobalDefinitionError: vi.fn(),
        completeDefinitionDiscovery: vi.fn(),
      },
      widgetPlacement: {
        createDropRequest: vi.fn((args) => args),
        cancelActiveIfUnavailable: vi.fn(),
      },
    } as never);

    plugin.apply({ hooks } as never);
    await hooks.initAsync.promise();

    expect(registerPlacementTool).toHaveBeenCalledWith(expect.objectContaining({
      label: "Weather · Draft",
      tone: "draft",
    }));
  });

  test("exposes and commits neutral published placement with an empty legacy actor catalog", async () => {
    const reference = {
      source: "published" as const,
      name: `v2:${DEFINITION_ID}`,
      revision: REVISION_ID,
    };
    const catalog = widgetCatalog(reference.revision, reference.name);
    const actorList = vi.fn(async () => [undefined, []] as const);
    const actorGet = vi.fn();
    const actorEvents = vi.fn();
    const actorSnapshot = vi.fn();
    const actorSendMessage = vi.fn();
    const resolvePlacement = vi.fn(async () => [undefined, {
      ok: true,
      descriptor: {
        kind: "published-v2",
        draftId: null,
        reference,
        bounds: { width: 360, height: 320 },
        definitionId: DEFINITION_ID,
        revisionId: REVISION_ID,
        definitionName: null,
        definitionSlug: "weather",
        previewId: null,
      },
    }] as const);
    const placeWidgetInstance = vi.fn();
    const placeLegacyPublishedWidget = vi.fn();
    let registeredPlacement: { placement: ReturnType<WidgetPlacementService["createDropRequest"]> } | undefined;
    const widgetManager = {
      registerPlacementTool: vi.fn((registration: {
        placement: ReturnType<WidgetPlacementService["createDropRequest"]>;
      }) => { registeredPlacement = registration; }),
      unregisterPlacementTool: vi.fn(),
      registerWidget: vi.fn(),
      unregisterWidget: vi.fn(),
      setDefinitionError: vi.fn(),
      setGlobalDefinitionError: vi.fn(),
      completeDefinitionDiscovery: vi.fn(),
      placeWidgetInstance,
      placeLegacyPublishedWidget,
    };
    const transportApi = {
      actors: {
        events: actorEvents,
        definitions: { list: actorList, get: actorGet },
        instances: { snapshot: actorSnapshot, sendMessage: actorSendMessage },
      },
      agent: {
        widgets: {
          catalog: vi.fn(async () => [undefined, catalog] as const),
          resolvePlacement,
        },
        widgetPreview: { close: vi.fn() },
      },
    };
    const placement = new WidgetPlacementService({
      api: { api: transportApi } as never,
      browser: { createId: vi.fn() } as never,
      coordinator: { register: vi.fn(() => () => undefined) } as never,
      dropPlacement: {
        resolveWorldBounds: vi.fn(() => ({ x: 40, y: 50, width: 360, height: 320 })),
        cancelIfReferenceUnavailable: vi.fn(),
      } as never,
      previewFrames: { place: vi.fn() } as never,
      widgetManager: widgetManager as never,
    });
    const hooks = {
      init: new SyncHook(),
      initAsync: new AsyncParallelHook(),
      destroy: new SyncHook(),
    };
    const plugin = createWidgetPlugin({
      application: { logError: vi.fn() },
      transport: { api: transportApi },
      widgetManager,
      widgetPlacement: placement,
    } as never);

    plugin.apply({ hooks } as never);
    await hooks.initAsync.promise();

    expect(actorList).toHaveBeenCalledOnce();
    expect(widgetManager.registerPlacementTool).toHaveBeenCalledWith(expect.objectContaining({
      label: "Weather",
      tone: undefined,
    }));
    expect(widgetManager.registerWidget).not.toHaveBeenCalled();
    if (!registeredPlacement) throw new Error("Expected published placement registration.");
    await registeredPlacement.placement.onCommit({
      reference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(resolvePlacement).not.toHaveBeenCalled();
    expect(placeWidgetInstance).toHaveBeenCalledWith({
      definitionId: DEFINITION_ID,
      revisionId: REVISION_ID,
      bounds: { x: 40, y: 50, width: 360, height: 320 },
    });
    expect(placeLegacyPublishedWidget).not.toHaveBeenCalled();
    expect(actorGet).not.toHaveBeenCalled();
    expect(actorEvents).not.toHaveBeenCalled();
    expect(actorSnapshot).not.toHaveBeenCalled();
    expect(actorSendMessage).not.toHaveBeenCalled();
  });

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
