import { describe, expect, test, vi } from "vitest";
import { WidgetPlacementService } from "../../src/widget-placement/WidgetPlacementService";

function fixture(result: unknown) {
  const resolvePlacement = vi.fn(async () => [undefined, result] as const);
  const close = vi.fn(async () => [undefined, { closed: true }] as const);
  const placePublishedWidget = vi.fn();
  const placePreview = vi.fn(async () => undefined);
  const resolveWorldBounds = vi.fn(() => ({ x: 40, y: 50, width: 420, height: 300 }));
  const service = new WidgetPlacementService({
    api: {
      api: {
        agent: {
          widgets: { resolvePlacement },
          widgetPreview: { close },
        },
      },
    } as never,
    browser: { createId: () => "preview-owner" } as never,
    coordinator: { register: vi.fn(() => () => undefined) } as never,
    dropPlacement: { resolveWorldBounds } as never,
    previewFrames: { place: placePreview } as never,
    widgetManager: { placePublishedWidget } as never,
  });
  return { service, resolvePlacement, close, placePublishedWidget, placePreview, resolveWorldBounds };
}

describe("WidgetPlacementService", () => {
  test("re-resolves and commits one published widget with canonical bounds", async () => {
    const reference = { source: "published" as const, name: "Weather", revision: "published-r1" };
    const { service, resolvePlacement, close, placePublishedWidget, resolveWorldBounds } = fixture({
      ok: true,
      descriptor: {
        kind: "published",
        reference,
        bounds: { width: 420, height: 300 },
        definitionName: "Weather",
      },
    });

    await service.createDropRequest({ reference, bounds: { width: 360, height: 320 }, label: "Weather" }).onCommit({
      reference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(resolvePlacement).toHaveBeenCalledWith({ reference });
    expect(resolveWorldBounds).toHaveBeenCalledWith({ x: 100, y: 120 }, { width: 420, height: 300 });
    expect(placePublishedWidget).toHaveBeenCalledOnce();
    expect(placePublishedWidget).toHaveBeenCalledWith("Weather", { x: 40, y: 50, width: 420, height: 300 });
    expect(close).not.toHaveBeenCalled();
  });

  test("builds an exact draft revision and places it only as a pinned Preview", async () => {
    const reference = { source: "draft" as const, name: "Weather", revision: "draft-r2" };
    const { service, resolvePlacement, placePublishedWidget, placePreview } = fixture({
      ok: true,
      descriptor: {
        kind: "preview",
        reference,
        bounds: { width: 360, height: 320 },
        previewId: "preview-owner",
      },
    });

    await service.createDropRequest({ reference, bounds: { width: 360, height: 320 }, label: "Weather Draft" }).onCommit({
      reference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(resolvePlacement).toHaveBeenCalledWith({ reference, previewId: "preview-owner" });
    expect(placePublishedWidget).not.toHaveBeenCalled();
    expect(placePreview).toHaveBeenCalledWith({
      draftName: "Weather",
      expectedRevision: "draft-r2",
      previewId: "preview-owner",
      bounds: { x: 40, y: 50, width: 420, height: 300 },
    });
  });

  test("rejects a resolver identity mismatch before any canvas commit", async () => {
    const reference = { source: "preview" as const, name: "Weather", revision: "preview-r2" };
    const { service, close, placePublishedWidget, placePreview } = fixture({
      ok: true,
      descriptor: {
        kind: "preview",
        reference: { ...reference, revision: "preview-r3" },
        bounds: { width: 360, height: 320 },
        previewId: "preview-owner",
      },
    });

    await service.createDropRequest({ reference, bounds: { width: 360, height: 320 }, label: "Weather Preview" }).onCommit({
      reference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(placePublishedWidget).not.toHaveBeenCalled();
    expect(placePreview).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith({
      draftId: "Weather",
      previewId: "preview-owner",
      expectedRevision: "preview-r2",
    });
  });
});
