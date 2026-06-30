import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { TImageUploadFormat, TUploadImage } from "../../types";
import type { CrdtService } from "../../services/crdt/CrdtService";
import type { HistoryService } from "../../services/history/HistoryService";
import type { RenderOrderService } from "../../services/render-order/RenderOrderService";
import type { SceneService } from "../../services/scene/SceneService";
import type { SelectionService } from "../../services/selection/SelectionService";
import { fnCreateImageElement } from "./fn.create-image-element";
import { fnFitImageToViewport } from "./fn.fit-image-to-viewport";

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
  fileToDataUrl: (file: File) => Promise<string>;
  fileToBytes: (file: File) => Promise<Uint8Array>;
  parseDataUrl: (dataUrl: string) => { format: TImageUploadFormat; base64: string } | null;
  getImageDimensions: (source: string) => Promise<{ width: number; height: number }>;
  getViewportCenter: () => { x: number; y: number };
  getViewportWorldSize: () => { width: number; height: number };
  createRuntimeNode: (element: TElement) => Konva.Image;
  toElement: (node: Konva.Image) => TElement;
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

  try {
    const dataUrl = await portal.fileToDataUrl(args.file);
    const parsed = portal.parseDataUrl(dataUrl);
    if (!parsed) {
      portal.notification?.showError("Unsupported image format", args.file.type || "This image type is not supported.");
      return;
    }

    const naturalSize = await portal.getImageDimensions(dataUrl);
    const bytes = await portal.fileToBytes(args.file);
    const { url } = await portal.uploadImage({
      data: bytes,
      mime_type: parsed.format,
    });

    const center = args.point ?? portal.getViewportCenter();
    const viewportSize = portal.getViewportWorldSize();
    const fittedSize = fnFitImageToViewport({
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
      imageWidth: naturalSize.width,
      imageHeight: naturalSize.height,
    });

    const element = fnCreateImageElement({
      id: portal.createId(),
      center,
      width: fittedSize.width,
      height: fittedSize.height,
      sourceUrl: url,
      naturalWidth: naturalSize.width,
      naturalHeight: naturalSize.height,
      now: portal.now(),
    });

    const node = portal.createRuntimeNode(element);
    node.setDraggable(true);
    portal.render.staticForegroundLayer.add(node);
    portal.renderOrder.assignOrderOnInsert({
      parent: portal.render.staticForegroundLayer,
      nodes: [node],
      position: "front",
    });
    portal.render.staticForegroundLayer.batchDraw();

    const insertedElement = portal.toElement(node);
    const createBuilder = portal.crdt.build();
    createBuilder.patchElement(insertedElement.id, insertedElement);
    const createCommitResult = createBuilder.commit();
    let activeNode: Konva.Image | null = node;
    portal.selection.setSelection([node]);
    portal.selection.setFocusedNode(node);

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
    const description = error instanceof Error ? error.message : "Failed to insert image";
    portal.notification?.showError("Failed to insert image", description);
  }
}
