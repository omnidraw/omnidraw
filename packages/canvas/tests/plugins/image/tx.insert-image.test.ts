import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { VC_NODE_KIND_ATTR, VC_ON_REMOVE_ATTR } from "../../../src/core/CONSTANTS";
import { txInsertImage, type TPendingImageInsertToken } from "../../../src/plugins/image/tx.insert-image";
import { txDeleteSelection } from "../../../src/plugins/select/tx.delete-selection";
import { createTestContainer } from "../../test-setup";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness() {
  const container = createTestContainer();
  const stage = new Konva.Stage({ container, width: 800, height: 600 });
  const staticForegroundLayer = new Konva.Layer();
  stage.add(staticForegroundLayer);

  const upload = deferred<{ url: string }>();
  const patchElement = vi.fn();
  const commitResult = { redoOps: [{ kind: "redo" }], undoOps: [], rollback: vi.fn() };
  const commit = vi.fn(() => commitResult);
  const historyRecord = vi.fn();
  const notification = { showError: vi.fn() };
  const selection = {
    selection: [] as Konva.Node[],
    focusedId: null as string | null,
    setSelection: vi.fn((nodes: Konva.Node[]) => {
      selection.selection = nodes;
    }),
    setFocusedNode: vi.fn((node: Konva.Node | null) => {
      selection.focusedId = node?.id() ?? null;
    }),
    clear: vi.fn(() => {
      selection.selection = [];
      selection.focusedId = null;
    }),
  };
  const decodedImage = document.createElement("canvas") as unknown as HTMLImageElement;
  decodedImage.width = 1200;
  decodedImage.height = 600;
  let persistedUrl: string | null = null;
  let pending: { id: string; token: TPendingImageInsertToken; node: Konva.Image } | null = null;
  let serverLoad: { node: Konva.Image; source: string; onError: () => void } | null = null;

  const portal = {
    crdt: {
      build: () => ({ patchElement, commit }),
      applyOps: vi.fn(),
      doc: () => ({ elements: {}, groups: {} }),
    } as never,
    history: { record: historyRecord } as never,
    render: { staticForegroundLayer } as never,
    renderOrder: {
      assignOrderOnInsert: vi.fn((_args: unknown) => {
        const node = staticForegroundLayer.getChildren()[0];
        node?.setAttr("vcZIndex", "z-preview");
      }),
      setNodeZIndex: vi.fn(),
      sortChildren: vi.fn(),
      getOrderBundle: (node: Konva.Node) => [node],
    } as never,
    selection: selection as never,
    uploadImage: vi.fn(() => upload.promise),
    notification,
    createId: () => "image-1",
    now: () => 100,
    fileToBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
    createObjectUrl: vi.fn(() => "blob:preview"),
    revokeObjectUrl: vi.fn(),
    decodeImage: vi.fn(async () => decodedImage),
    getViewportCenter: () => ({ x: 300, y: 200 }),
    getViewportWorldSize: () => ({ width: 800, height: 600 }),
    createRuntimeNode: (element: TElement) => {
      const node = new Konva.Image({
        image: undefined,
        id: element.id,
        x: element.x,
        y: element.y,
        width: element.data.type === "image" ? element.data.w : 0,
        height: element.data.type === "image" ? element.data.h : 0,
      });
      node.setAttr(VC_NODE_KIND_ATTR, "element");
      return node;
    },
    setupRuntimeNode: vi.fn(),
    syncNodeMetadata: vi.fn((_node: Konva.Image, element: TElement) => {
      persistedUrl = element.data.type === "image" ? element.data.url : null;
    }),
    setNodeImage: vi.fn((node: Konva.Image, image: HTMLImageElement) => {
      node.image(image);
    }),
    loadImageIntoNode: vi.fn((node: Konva.Image, source: string, onError: () => void) => {
      serverLoad = { node, source, onError };
    }),
    toElement: (node: Konva.Image): TElement => ({
      id: node.id(),
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      bindings: [],
      createdAt: 100,
      updatedAt: 100,
      locked: false,
      parentGroupId: null,
      zIndex: node.getAttr("vcZIndex") ?? "",
      style: { opacity: node.opacity() },
      data: {
        type: "image",
        url: persistedUrl,
        base64: null,
        w: node.width(),
        h: node.height(),
        crop: { x: 0, y: 0, width: 1200, height: 600, naturalWidth: 1200, naturalHeight: 600 },
      },
    }),
    registerPendingInsert: (id: string, token: TPendingImageInsertToken, node: Konva.Image) => {
      pending = { id, token, node };
      node.setAttr(VC_ON_REMOVE_ATTR, () => {
        token.cancelled = true;
        pending = null;
      });
    },
    isPendingInsertActive: (id: string, token: TPendingImageInsertToken, node: Konva.Image) => {
      return pending?.id === id && pending.token === token && pending.node === node && !token.cancelled;
    },
    releasePendingInsert: (id: string, token: TPendingImageInsertToken) => {
      if (pending?.id === id && pending.token === token) pending = null;
    },
  };

  return {
    container,
    stage,
    staticForegroundLayer,
    upload,
    patchElement,
    commit,
    historyRecord,
    notification,
    selection,
    decodedImage,
    portal,
    getPending: () => pending,
    getServerLoad: () => serverLoad,
    destroy: () => {
      stage.destroy();
      container.remove();
    },
  };
}

describe("txInsertImage", () => {
  test("renders a local preview before upload and reconciles the same node", async () => {
    const harness = createHarness();
    try {
      const insertion = txInsertImage(harness.portal, {
        file: new File(["fake"], "image.png", { type: "image/png" }),
      });
      await vi.waitFor(() => expect(harness.staticForegroundLayer.getChildren()).toHaveLength(1));

      const preview = harness.staticForegroundLayer.getChildren()[0] as Konva.Image;
      expect(preview.image()).toBe(harness.decodedImage);
      expect(preview.width()).toBe(300);
      expect(preview.height()).toBe(150);
      expect(harness.patchElement).not.toHaveBeenCalled();
      expect(harness.historyRecord).not.toHaveBeenCalled();
      expect(harness.portal.revokeObjectUrl).toHaveBeenCalledWith("blob:preview");

      harness.upload.resolve({ url: "https://cdn.test/image.png" });
      await insertion;

      expect(harness.staticForegroundLayer.getChildren()[0]).toBe(preview);
      expect(harness.patchElement).toHaveBeenCalledWith("image-1", expect.objectContaining({
        data: expect.objectContaining({ url: "https://cdn.test/image.png", base64: null }),
      }));
      expect(harness.commit).toHaveBeenCalledOnce();
      expect(harness.historyRecord).toHaveBeenCalledOnce();
      expect(harness.portal.setupRuntimeNode).toHaveBeenCalledWith(preview);
      expect(harness.getPending()).toBeNull();
    } finally {
      harness.destroy();
    }
  });

  test("keeps the local bitmap while the server image load is pending or fails", async () => {
    const harness = createHarness();
    try {
      const insertion = txInsertImage(harness.portal, {
        file: new File(["fake"], "image.png", { type: "image/png" }),
      });
      await vi.waitFor(() => expect(harness.staticForegroundLayer.getChildren()).toHaveLength(1));
      const preview = harness.staticForegroundLayer.getChildren()[0] as Konva.Image;
      harness.upload.resolve({ url: "https://cdn.test/image.png" });
      await insertion;

      expect(preview.image()).toBe(harness.decodedImage);
      expect(harness.getServerLoad()).toMatchObject({ node: preview, source: "https://cdn.test/image.png" });
      harness.getServerLoad()?.onError();
      expect(preview.image()).toBe(harness.decodedImage);
      expect(harness.notification.showError).toHaveBeenCalledWith("Failed to load image", expect.any(String));
    } finally {
      harness.destroy();
    }
  });

  test("removes the preview without persistence or history when upload fails", async () => {
    const harness = createHarness();
    try {
      const insertion = txInsertImage(harness.portal, {
        file: new File(["fake"], "image.png", { type: "image/png" }),
      });
      await vi.waitFor(() => expect(harness.staticForegroundLayer.getChildren()).toHaveLength(1));
      harness.upload.reject(new Error("remote unavailable"));
      await insertion;

      expect(harness.staticForegroundLayer.getChildren()).toHaveLength(0);
      expect(harness.patchElement).not.toHaveBeenCalled();
      expect(harness.historyRecord).not.toHaveBeenCalled();
      expect(harness.selection.selection).toEqual([]);
      expect(harness.selection.focusedId).toBeNull();
      expect(harness.notification.showError).toHaveBeenCalledWith("Failed to insert image", "remote unavailable");
    } finally {
      harness.destroy();
    }
  });

  test("revokes on decode failure and cancellation prevents a late commit", async () => {
    const decodeFailure = createHarness();
    try {
      decodeFailure.portal.decodeImage = vi.fn(async () => {
        throw new Error("bad image");
      });
      await txInsertImage(decodeFailure.portal, {
        file: new File(["fake"], "image.png", { type: "image/png" }),
      });
      expect(decodeFailure.portal.revokeObjectUrl).toHaveBeenCalledWith("blob:preview");
      expect(decodeFailure.staticForegroundLayer.getChildren()).toHaveLength(0);
    } finally {
      decodeFailure.destroy();
    }

    const cancelled = createHarness();
    try {
      const insertion = txInsertImage(cancelled.portal, {
        file: new File(["fake"], "image.png", { type: "image/png" }),
      });
      await vi.waitFor(() => expect(cancelled.getPending()).not.toBeNull());
      const pending = cancelled.getPending();
      if (pending) pending.token.cancelled = true;
      cancelled.upload.resolve({ url: "https://cdn.test/late.png" });
      await insertion;
      expect(cancelled.patchElement).not.toHaveBeenCalled();
      expect(cancelled.historyRecord).not.toHaveBeenCalled();
      expect(cancelled.getPending()).toBeNull();
    } finally {
      cancelled.destroy();
    }
  });

  test("standard deletion removes a pending preview and makes late upload completion a no-op", async () => {
    const harness = createHarness();
    try {
      const insertion = txInsertImage(harness.portal, {
        file: new File(["fake"], "image.png", { type: "image/png" }),
      });
      await vi.waitFor(() => expect(harness.getPending()).not.toBeNull());
      const preview = harness.getPending()?.node;
      expect(preview).toBeDefined();

      const didDelete = txDeleteSelection({
        element: {} as never,
        group: {} as never,
        crdt: harness.portal.crdt,
        history: harness.portal.history,
        scene: { staticForegroundLayer: harness.staticForegroundLayer, stage: harness.stage } as never,
        renderOrder: harness.portal.renderOrder,
        selection: harness.portal.selection,
      }, {});

      expect(didDelete).toBe(true);
      expect(preview?.getLayer()).toBeNull();
      expect(harness.getPending()).toBeNull();
      expect(harness.historyRecord).not.toHaveBeenCalled();

      harness.upload.resolve({ url: "https://cdn.test/late.png" });
      await insertion;
      expect(harness.patchElement).not.toHaveBeenCalled();
      expect(harness.commit).not.toHaveBeenCalled();
    } finally {
      harness.destroy();
    }
  });
});
