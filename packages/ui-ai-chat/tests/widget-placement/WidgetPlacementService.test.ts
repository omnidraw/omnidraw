import { describe, expect, test, vi } from "vitest";
import { WidgetPlacementService } from "../../src/widget-placement/WidgetPlacementService";

const DEFINITION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const REVISION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7";
const DRAFT_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OTHER_DRAFT_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc5";
const PREVIEW_REVISION_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3";
const PREVIEW_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4";

function fixture(result: unknown, options: {
  resolvePlacement?: ReturnType<typeof vi.fn>;
  detail?: ReturnType<typeof vi.fn>;
  draftRevision?: string;
} = {}) {
  const resolvePlacement = options.resolvePlacement ?? vi.fn(async () => [undefined, result] as const);
  const inferredRevision = (
    result as { descriptor?: { reference?: { revision?: unknown } } } | undefined
  )?.descriptor?.reference?.revision;
  const detail = options.detail ?? vi.fn(async ({ name }: { name: string }) => [undefined, {
    name,
    source: "draft",
    variant: {
      source: "draft",
      draftId: DRAFT_ID,
      revision: options.draftRevision ?? (typeof inferredRevision === "string" ? inferredRevision : "e".repeat(64)),
    },
  }] as const);
  const close = vi.fn(async () => [undefined, { closed: true }] as const);
  const get = vi.fn(async ({ draftId, previewId }: { draftId: string; previewId: string }) => [undefined, {
    ready: true,
    draftId,
    previewId,
    previewRevisionId: PREVIEW_REVISION_ID,
  }] as const);
  const placeWidgetInstance = vi.fn();
  const placeLegacyPublishedWidget = vi.fn();
  const placePreview = vi.fn(async () => undefined);
  const resolveWorldBounds = vi.fn(() => ({ x: 40, y: 50, width: 420, height: 300 }));
  const service = new WidgetPlacementService({
    api: {
      api: {
        agent: {
          widgets: { detail, resolvePlacement },
          widgetPreview: { get, close },
        },
      },
    } as never,
    browser: { createId: () => PREVIEW_ID } as never,
    coordinator: { register: vi.fn(() => () => undefined) } as never,
    dropPlacement: { resolveWorldBounds } as never,
    previewFrames: { place: placePreview } as never,
    widgetManager: { placeWidgetInstance, placeLegacyPublishedWidget } as never,
  });
  return {
    service,
    detail,
    resolvePlacement,
    close,
    get,
    placeWidgetInstance,
    placeLegacyPublishedWidget,
    placePreview,
    resolveWorldBounds,
  };
}

describe("WidgetPlacementService", () => {
  test("commits a direct v2 catalog descriptor synchronously while the backend resolver never settles", () => {
    const reference = { source: "published" as const, name: `v2:${DEFINITION_ID}`, revision: REVISION_ID };
    const resolvePlacement = vi.fn(() => new Promise<never>(() => undefined));
    const {
      service,
      close,
      placeWidgetInstance,
      placeLegacyPublishedWidget,
      resolveWorldBounds,
    } = fixture(undefined, {
      resolvePlacement,
    });

    const completion = service.createDropRequest({
      reference,
      bounds: { width: 360, height: 320 },
      label: "Weather",
    }).onCommit({
      reference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(completion).toBeUndefined();
    expect(resolvePlacement).not.toHaveBeenCalled();
    expect(resolveWorldBounds).toHaveBeenCalledWith({ x: 100, y: 120 }, { width: 360, height: 320 });
    expect(placeWidgetInstance).toHaveBeenCalledOnce();
    expect(placeWidgetInstance).toHaveBeenCalledWith({
      definitionId: DEFINITION_ID,
      revisionId: REVISION_ID,
      bounds: { x: 40, y: 50, width: 420, height: 300 },
    });
    expect(placeLegacyPublishedWidget).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  test("commits a direct v2 catalog descriptor synchronously while the backend resolver rejects", () => {
    const reference = { source: "published" as const, name: `v2:${DEFINITION_ID}`, revision: REVISION_ID };
    const resolvePlacement = vi.fn(async () => {
      throw new Error("backend unavailable");
    });
    const {
      service,
      placeWidgetInstance,
      placeLegacyPublishedWidget,
    } = fixture(undefined, { resolvePlacement });

    const completion = service.createDropRequest({
      reference,
      bounds: { width: 360, height: 320 },
      label: "Weather",
    }).onCommit({
      reference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(completion).toBeUndefined();
    expect(resolvePlacement).not.toHaveBeenCalled();
    expect(placeWidgetInstance).toHaveBeenCalledWith({
      definitionId: DEFINITION_ID,
      revisionId: REVISION_ID,
      bounds: { x: 40, y: 50, width: 420, height: 300 },
    });
    expect(placeLegacyPublishedWidget).not.toHaveBeenCalled();
  });

  test("keeps legacy published placement dependent on the backend resolver", async () => {
    const reference = { source: "published" as const, name: "Weather", revision: "published-r1" };
    const result = {
      ok: true,
      descriptor: {
        kind: "published-legacy",
        draftId: null,
        reference,
        bounds: { width: 420, height: 300 },
        definitionId: null,
        revisionId: null,
        definitionName: "Weather",
        definitionSlug: "weather",
        previewId: null,
      },
    };
    let settleResolver!: (value: readonly [undefined, typeof result]) => void;
    const resolvePlacement = vi.fn(() => new Promise<readonly [undefined, typeof result]>((resolve) => {
      settleResolver = resolve;
    }));
    const { service, placeWidgetInstance, placeLegacyPublishedWidget } = fixture(undefined, {
      resolvePlacement,
    });

    const completion = service.createDropRequest({ reference, bounds: { width: 360, height: 320 }, label: "Weather" }).onCommit({
      reference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(resolvePlacement).toHaveBeenCalledWith({ reference });
    expect(completion).toBeInstanceOf(Promise);
    expect(placeLegacyPublishedWidget).not.toHaveBeenCalled();
    settleResolver([undefined, result]);
    await completion;

    expect(placeLegacyPublishedWidget).toHaveBeenCalledWith(
      "Weather",
      { x: 40, y: 50, width: 420, height: 300 },
    );
    expect(placeWidgetInstance).not.toHaveBeenCalled();
  });

  test("rejects a legacy runtime name mismatch before any canvas commit", async () => {
    const reference = { source: "published" as const, name: "Weather", revision: "published-r1" };
    const {
      service,
      placeWidgetInstance,
      placeLegacyPublishedWidget,
      resolveWorldBounds,
    } = fixture({
      ok: true,
      descriptor: {
        kind: "published-legacy",
        draftId: null,
        reference,
        bounds: { width: 420, height: 300 },
        definitionId: null,
        revisionId: null,
        definitionName: "Other widget",
        definitionSlug: "other-widget",
        previewId: null,
      },
    });

    await service.createDropRequest({ reference, bounds: { width: 360, height: 320 }, label: "Weather" }).onCommit({
      reference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(resolveWorldBounds).not.toHaveBeenCalled();
    expect(placeWidgetInstance).not.toHaveBeenCalled();
    expect(placeLegacyPublishedWidget).not.toHaveBeenCalled();
  });

  test("builds an exact draft revision and places it only as a pinned Preview", async () => {
    const reference = { source: "draft" as const, name: "Weather", revision: "e".repeat(64) };
    const { service, resolvePlacement, placeWidgetInstance, placeLegacyPublishedWidget, placePreview } = fixture({
      ok: true,
      descriptor: {
        kind: "preview",
        draftId: DRAFT_ID,
        reference,
        bounds: { width: 360, height: 320 },
        definitionId: null,
        revisionId: null,
        definitionName: null,
        definitionSlug: null,
        previewId: PREVIEW_ID,
      },
    });

    await service.createDropRequest({ reference, bounds: { width: 360, height: 320 }, label: "Weather Draft" }).onCommit({
      reference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(resolvePlacement).toHaveBeenCalledWith({
      reference,
      previewId: PREVIEW_ID,
      expectedDraftId: DRAFT_ID,
    });
    expect(placeWidgetInstance).not.toHaveBeenCalled();
    expect(placeLegacyPublishedWidget).not.toHaveBeenCalled();
    expect(placePreview).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      expectedRevision: "e".repeat(64),
      previewId: PREVIEW_ID,
      bounds: { x: 40, y: 50, width: 420, height: 300 },
    });
  });

  test("rejects a resolver identity mismatch before any canvas commit", async () => {
    const reference = { source: "preview" as const, name: "Weather", revision: "preview-r2" };
    const { service, close, placeWidgetInstance, placeLegacyPublishedWidget, placePreview } = fixture({
      ok: true,
      descriptor: {
        kind: "preview",
        draftId: DRAFT_ID,
        reference: { ...reference, revision: "preview-r3" },
        bounds: { width: 360, height: 320 },
        definitionId: null,
        revisionId: null,
        definitionName: null,
        definitionSlug: null,
        previewId: PREVIEW_ID,
      },
    }, { draftRevision: reference.revision });

    await service.createDropRequest({ reference, bounds: { width: 360, height: 320 }, label: "Weather Preview" }).onCommit({
      reference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(placeWidgetInstance).not.toHaveBeenCalled();
    expect(placeLegacyPublishedWidget).not.toHaveBeenCalled();
    expect(placePreview).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId: PREVIEW_ID,
      expectedPreviewRevisionId: PREVIEW_REVISION_ID,
    });
  });

  test("closes the exact pre-resolved Preview when resolvePlacement loses its response after commit", async () => {
    const reference = { source: "draft" as const, name: "Weather", revision: "e".repeat(64) };
    const resolvePlacement = vi.fn(async () => {
      throw new Error("transport response lost after commit");
    });
    const {
      service,
      detail,
      get,
      close,
      placePreview,
    } = fixture(undefined, { resolvePlacement });

    await service.createDropRequest({ reference, bounds: { width: 360, height: 320 }, label: "Weather" }).onCommit({
      reference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(detail).toHaveBeenCalledWith({ name: "Weather", source: "draft" });
    expect(resolvePlacement).toHaveBeenCalledWith({
      reference,
      previewId: PREVIEW_ID,
      expectedDraftId: DRAFT_ID,
    });
    expect(get).toHaveBeenCalledWith({ draftId: DRAFT_ID, previewId: PREVIEW_ID });
    expect(close).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId: PREVIEW_ID,
      expectedPreviewRevisionId: PREVIEW_REVISION_ID,
    });
    expect(placePreview).not.toHaveBeenCalled();
  });

  test("keeps the pre-resolved owner when a resolver returns a different draft identity", async () => {
    const reference = { source: "preview" as const, name: "Weather", revision: "e".repeat(64) };
    const { service, get, close, placePreview } = fixture({
      ok: true,
      descriptor: {
        kind: "preview",
        draftId: OTHER_DRAFT_ID,
        reference,
        bounds: { width: 360, height: 320 },
        definitionId: null,
        revisionId: null,
        definitionName: null,
        definitionSlug: null,
        previewId: PREVIEW_ID,
      },
    });

    await service.createDropRequest({ reference, bounds: { width: 360, height: 320 }, label: "Weather" }).onCommit({
      reference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(placePreview).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith({ draftId: DRAFT_ID, previewId: PREVIEW_ID });
    expect(close).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId: PREVIEW_ID,
      expectedPreviewRevisionId: PREVIEW_REVISION_ID,
    });
  });

  test.each([
    {
      name: "uppercase definition UUID",
      reference: { source: "published", name: `v2:${DEFINITION_ID.toUpperCase()}`, revision: REVISION_ID },
      bounds: { width: 360, height: 320 },
    },
    {
      name: "uppercase revision UUID",
      reference: { source: "published", name: `v2:${DEFINITION_ID}`, revision: REVISION_ID.toUpperCase() },
      bounds: { width: 360, height: 320 },
    },
    {
      name: "non-finite bounds",
      reference: { source: "published", name: `v2:${DEFINITION_ID}`, revision: REVISION_ID },
      bounds: { width: Number.POSITIVE_INFINITY, height: 320 },
    },
    {
      name: "unexpected reference key",
      reference: { source: "published", name: `v2:${DEFINITION_ID}`, revision: REVISION_ID, actorId: "forged" },
      bounds: { width: 360, height: 320 },
    },
  ])("rejects a malformed direct v2 catalog descriptor ($name) without backend fallback", ({ reference, bounds }) => {
    const resolvePlacement = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const {
      service,
      placeWidgetInstance,
      placeLegacyPublishedWidget,
      placePreview,
      resolveWorldBounds,
    } = fixture(undefined, { resolvePlacement });

    const completion = service.createDropRequest({
      reference: reference as never,
      bounds: bounds as never,
      label: "Weather",
    }).onCommit({
      reference: reference as never,
      bounds: bounds as never,
      clientPoint: { x: 100, y: 120 },
    });

    expect(completion).toBeUndefined();
    expect(resolvePlacement).not.toHaveBeenCalled();
    expect(resolveWorldBounds).not.toHaveBeenCalled();
    expect(placeWidgetInstance).not.toHaveBeenCalled();
    expect(placeLegacyPublishedWidget).not.toHaveBeenCalled();
    expect(placePreview).not.toHaveBeenCalled();
  });

  test("rejects a commit descriptor that differs from the pinned direct v2 catalog descriptor", () => {
    const reference = { source: "published" as const, name: `v2:${DEFINITION_ID}`, revision: REVISION_ID };
    const forgedReference = {
      source: "published" as const,
      name: "v2:cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
      revision: REVISION_ID,
    };
    const { service, resolvePlacement, placeWidgetInstance, resolveWorldBounds } = fixture(undefined);

    service.createDropRequest({ reference, bounds: { width: 360, height: 320 }, label: "Weather" }).onCommit({
      reference: forgedReference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(resolvePlacement).not.toHaveBeenCalled();
    expect(resolveWorldBounds).not.toHaveBeenCalled();
    expect(placeWidgetInstance).not.toHaveBeenCalled();
  });

  test("rejects a malicious legacy resolver descriptor with unexpected authority fields", async () => {
    const reference = { source: "published" as const, name: "Weather", revision: "published-r1" };
    const { service, placeWidgetInstance, placeLegacyPublishedWidget, resolveWorldBounds } = fixture({
      ok: true,
      descriptor: {
        kind: "published-legacy",
        draftId: null,
        reference,
        bounds: { width: 420, height: 300 },
        definitionId: null,
        revisionId: null,
        definitionName: "Weather",
        definitionSlug: "weather",
        previewId: null,
        actorInstanceId: "forged",
      },
    });

    await service.createDropRequest({ reference, bounds: { width: 360, height: 320 }, label: "Weather" }).onCommit({
      reference,
      bounds: { width: 360, height: 320 },
      clientPoint: { x: 100, y: 120 },
    });

    expect(resolveWorldBounds).not.toHaveBeenCalled();
    expect(placeWidgetInstance).not.toHaveBeenCalled();
    expect(placeLegacyPublishedWidget).not.toHaveBeenCalled();
  });
});
