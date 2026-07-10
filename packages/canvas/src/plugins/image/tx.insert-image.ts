import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import { fnGetSupportedImageFormat } from "../../core/fn.image-utils";
import type { CrdtService } from "../../services/crdt/CrdtService";
import type { HistoryService } from "../../services/history/HistoryService";
import type { RenderOrderService } from "../../services/render-order/RenderOrderService";
import type { SceneService } from "../../services/scene/SceneService";
import type { SelectionService } from "../../services/selection/SelectionService";
import type { TUploadImage } from "../../types";
import { fnCreateImageElement } from "./fn.create-image-element";
import { fnFitImageToViewport } from "./fn.fit-image-to-viewport";

export type TPendingImageInsertToken = {
  cancelled: boolean;
};

export type TPortalInsertImage = {
  crdt: CrdtService;
  history: HistoryService;
  render: SceneService;
  renderOrder: RenderOrderService;
  selection: SelectionService;
  uploadImage?: TUploadImage;
  notification?: {
    showError(title: string, description?: string): void;
  };
  createId: () => string;
  now: () => number;
  fileToBytes: (file: File) => Promise<Uint8Array>;
  createObjectUrl: (file: File) => string;
  revokeObjectUrl: (url: string) => void;
  decodeImage: (source: string) => Promise<HTMLImageElement>;
  getViewportCenter: () => { x: number; y: number };
  getViewportWorldSize: () => { width: number; height: number };
  createRuntimeNode: (element: TElement) => Konva.Image;
  setupRuntimeNode: (node: Konva.Image) => void;
  syncNodeMetadata: (node: Konva.Image, element: TElement) => void;
  setNodeImage: (node: Konva.Image, image: HTMLImageElement) => void;
  loadImageIntoNode: (node: Konva.Image, source: string, onError: () => void) => void;
  toElement: (node: Konva.Image) => TElement;
  registerPendingInsert: (id: string, token: TPendingImageInsertToken, node: Konva.Image) => void;
  isPendingInsertActive: (id: string, token: TPendingImageInsertToken, node: Konva.Image) => boolean;
  releasePendingInsert: (id: string, token: TPendingImageInsertToken) => void;
};

export type TArgsInsertImage = {
  file: File;
  point?: { x: number; y: number };
};

export async function txInsertImage(
  portal: TPortalInsertImage,
  args: TArgsInsertImage,
) {
  if (!portal.uploadImage) {
    portal.notification?.showError("Image upload unavailable", "Canvas image upload capability is not configured.");
    return;
  }
  const uploadImage = portal.uploadImage;

  const format = fnGetSupportedImageFormat(args.file.type);
  if (!format) {
    portal.notification?.showError("Unsupported image format", args.file.type || "This image type is not supported.");
    return;
  }

  const uploadPromise = portal.fileToBytes(args.file)
    .then((data) => uploadImage({ data, mime_type: format }))
    .then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    );

  let objectUrl: string;
  try {
    objectUrl = portal.createObjectUrl(args.file);
  } catch (error) {
    const description = error instanceof Error ? error.message : "Failed to prepare image";
    portal.notification?.showError("Failed to insert image", description);
    return;
  }

  let decodedImage: HTMLImageElement;
  try {
    decodedImage = await portal.decodeImage(objectUrl);
  } catch (error) {
    const description = error instanceof Error ? error.message : "Failed to decode image";
    portal.notification?.showError("Failed to insert image", description);
    return;
  } finally {
    portal.revokeObjectUrl(objectUrl);
  }

  const naturalSize = {
    width: decodedImage.naturalWidth || decodedImage.width,
    height: decodedImage.naturalHeight || decodedImage.height,
  };
  const center = args.point ?? portal.getViewportCenter();
  const viewportSize = portal.getViewportWorldSize();
  const fittedSize = fnFitImageToViewport({
    viewportWidth: viewportSize.width,
    viewportHeight: viewportSize.height,
    imageWidth: naturalSize.width,
    imageHeight: naturalSize.height,
  });
  const id = portal.createId();
  const createdAt = portal.now();
  const pendingElement = fnCreateImageElement({
    id,
    center,
    width: fittedSize.width,
    height: fittedSize.height,
    sourceUrl: null,
    naturalWidth: naturalSize.width,
    naturalHeight: naturalSize.height,
    now: createdAt,
  });
  const node = portal.createRuntimeNode(pendingElement);
  const token: TPendingImageInsertToken = { cancelled: false };
  portal.registerPendingInsert(id, token, node);

  node.setDraggable(true);
  portal.setNodeImage(node, decodedImage);
  portal.render.staticForegroundLayer.add(node);
  portal.renderOrder.assignOrderOnInsert({
    parent: portal.render.staticForegroundLayer,
    nodes: [node],
    position: "front",
  });
  portal.selection.setSelection([node]);
  portal.selection.setFocusedNode(node);
  portal.render.staticForegroundLayer.batchDraw();

  const removePendingPreview = () => {
    portal.releasePendingInsert(id, token);
    token.cancelled = true;
    if (portal.selection.selection.includes(node)) {
      portal.selection.setSelection(portal.selection.selection.filter((candidate) => candidate !== node));
    }
    if (portal.selection.focusedId === id) {
      portal.selection.setFocusedNode(null);
    }
    node.destroy();
    portal.render.staticForegroundLayer.batchDraw();
  };

  const upload = await uploadPromise;
  if (!portal.isPendingInsertActive(id, token, node)) {
    portal.releasePendingInsert(id, token);
    token.cancelled = true;
    return;
  }

  if (!upload.ok || !upload.result) {
    removePendingPreview();
    const description = upload.ok
      ? "Image upload returned no result"
      : upload.error instanceof Error ? upload.error.message : "Failed to insert image";
    portal.notification?.showError("Failed to insert image", description);
    return;
  }

  try {
    const persistedMetadata = fnCreateImageElement({
      id,
      center,
      width: fittedSize.width,
      height: fittedSize.height,
      sourceUrl: upload.result.url,
      naturalWidth: naturalSize.width,
      naturalHeight: naturalSize.height,
      now: createdAt,
    });
    portal.syncNodeMetadata(node, persistedMetadata);
    const insertedElement = portal.toElement(node);
    portal.setupRuntimeNode(node);
    const createBuilder = portal.crdt.build();
    createBuilder.patchElement(insertedElement.id, insertedElement);
    const createCommitResult = createBuilder.commit();
    let activeNode: Konva.Image | null = node;
    portal.releasePendingInsert(id, token);

    portal.loadImageIntoNode(node, upload.result.url, () => {
      portal.notification?.showError("Failed to load image", "The uploaded image could not be loaded from the server.");
    });

    portal.history.record({
      label: "insert-image",
      undo() {
        portal.selection.clear();
        activeNode?.destroy();
        activeNode = null;
        createCommitResult.rollback();
        portal.render.staticForegroundLayer.batchDraw();
      },
      redo() {
        const recreatedNode = portal.createRuntimeNode(insertedElement);
        recreatedNode.setDraggable(true);
        portal.setupRuntimeNode(recreatedNode);
        portal.render.staticForegroundLayer.add(recreatedNode);
        portal.renderOrder.setNodeZIndex(recreatedNode, insertedElement.zIndex);
        portal.renderOrder.sortChildren(portal.render.staticForegroundLayer);
        portal.crdt.applyOps({ ops: createCommitResult.redoOps });
        portal.selection.setSelection([recreatedNode]);
        portal.selection.setFocusedNode(recreatedNode);
        activeNode = recreatedNode;
        portal.render.staticForegroundLayer.batchDraw();
      },
    });
  } catch (error) {
    if (portal.isPendingInsertActive(id, token, node)) {
      removePendingPreview();
    }
    const description = error instanceof Error ? error.message : "Failed to insert image";
    portal.notification?.showError("Failed to insert image", description);
  }
}
