import { throttle } from "@solid-primitives/scheduled";
import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement, TImageData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import ImageIcon from "lucide-static/icons/image.svg?raw";
import Konva from "konva";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import {
  fnFileToDataUrl,
  fnFileToBytes,
  fnGetImageDimensions,
  fnGetImageSource,
  fnGetSupportedImageFormat,
  fnParseDataUrl,
} from "../../core/fn.image-utils";
import type {
  ContextMenuService,
  CrdtService,
  ElementService,
  GroupService,
  HistoryService,
  RenderOrderService,
  SceneService,
  SelectionService,
  SessionService,
  ToolService,
} from "../../services";
import { fnGetCanvasAncestorGroups, fnGetCanvasParentGroupId } from "../../core/fn.canvas-node-semantics";
import { ELEMENT_DATA_ATTR, ELEMENT_STYLE_ATTR, VC_CREATED_AT_ATTR, VC_NODE_KIND_ATTR, VC_UPDATED_AT_ATTR } from "../../core/CONSTANTS";
import { fnFilterSelection } from "../../core/fn.filter-selection";
import { fnGetNodeZIndex } from "../../core/fn.get-node-z-index";
import { fnGetWorldPosition } from "../../core/fn.world-position";
import { txSetNodeZIndex } from "../../core/tx.set-node-z-index";
import { fnToImageElement } from "./fn.to-image-element";
import { txCreateImageCloneDrag } from "./tx.create-image-clone-drag";
import { txInsertImage } from "./tx.insert-image";
import { txSetupImageListeners } from "./tx.setup-image-listeners";
import { txUpdateImageNodeFromElement } from "./tx.update-image-node-from-element";
import { txDeleteSelection } from "../select/tx.delete-selection";

const IMAGE_URL_ATTR = "vcImageUrl";
const IMAGE_BASE64_ATTR = "vcImageBase64";
const IMAGE_CROP_ATTR = "vcImageCrop";
const IMAGE_SOURCE_ATTR = "vcImageSource";
const ELEMENT_CREATED_AT_ATTR = "vcElementCreatedAt";

const setNodeZIndex = (node: Konva.Group | Konva.Shape, zIndex: string) => txSetNodeZIndex({}, { node, zIndex });

function getNotification(config: {
  notification?: {
    showSuccess(title: string, description?: string): void;
    showError(title: string, description?: string): void;
    showInfo(title: string, description?: string): void;
  };
}) {
  return config.notification;
}

function getFirstSupportedImageFile(files: Iterable<File> | ArrayLike<File> | null | undefined) {
  return Array.from(files ?? []).find((candidate) => {
    return fnGetSupportedImageFormat(candidate.type) !== null;
  });
}

function getFirstSupportedImageClipboardItem(items: DataTransferItemList | null | undefined) {
  return Array.from(items ?? []).find((candidate) => {
    return candidate.kind === "file" && fnGetSupportedImageFormat(candidate.type) !== null;
  })?.getAsFile() ?? null;
}

function getFirstSupportedClipboardImageFile(data: DataTransfer | null | undefined) {
  return getFirstSupportedImageFile(data?.files) ?? getFirstSupportedImageClipboardItem(data?.items);
}

function screenToWorld(render: SceneService, point: { x: number; y: number }) {
  const transform = render.staticForegroundLayer.getAbsoluteTransform().copy();
  transform.invert();
  return transform.point(point);
}

function getViewportCenter(render: SceneService) {
  return screenToWorld(render, {
    x: render.stage.width() / 2,
    y: render.stage.height() / 2,
  });
}

function getViewportWorldSize(render: SceneService) {
  const worldTopLeft = screenToWorld(render, { x: 0, y: 0 });
  const worldBottomRight = screenToWorld(render, {
    x: render.stage.width(),
    y: render.stage.height(),
  });

  return {
    width: Math.abs(worldBottomRight.x - worldTopLeft.x),
    height: Math.abs(worldBottomRight.y - worldTopLeft.y),
  };
}

function shouldIgnoreClipboardEvent(session: Pick<SessionService, "editingId">, event: ClipboardEvent) {
  if (session.editingId !== null) {
    return true;
  }

  const target = event.target;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    return true;
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }

  return false;
}

function syncNodeMetadata(node: Konva.Image, element: TElement) {
  const data = element.data as TImageData;
  node.setAttr(ELEMENT_DATA_ATTR, structuredClone(element.data));
  node.setAttr(ELEMENT_STYLE_ATTR, structuredClone(element.style));
  node.setAttr(VC_CREATED_AT_ATTR, element.createdAt);
  node.setAttr(VC_UPDATED_AT_ATTR, element.updatedAt);
  node.setAttr(IMAGE_URL_ATTR, data.url);
  node.setAttr(IMAGE_BASE64_ATTR, data.base64);
  node.setAttr(IMAGE_CROP_ATTR, structuredClone(data.crop));
  node.setAttr(IMAGE_SOURCE_ATTR, fnGetImageSource({ url: data.url, base64: data.base64 }));
  node.setAttr(ELEMENT_CREATED_AT_ATTR, element.createdAt);
}

function loadImageIntoNode(node: Konva.Image, source: string | null) {
  node.setAttr(IMAGE_SOURCE_ATTR, source);
  if (!source) {
    node.image(null);
    node.getLayer()?.batchDraw();
    return;
  }

  const image = new window.Image();
  image.onload = () => {
    node.image(image);
    node.getLayer()?.batchDraw();
  };
  image.src = source;
}

function createImageNode(element: TElement) {
  const data = element.data as TImageData;
  const node = new Konva.Image({
    id: element.id,
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    width: data.w,
    height: data.h,
    opacity: element.style.opacity ?? 1,
    scaleX: element.scaleX ?? 1,
    scaleY: element.scaleY ?? 1,
    draggable: true,
    image: undefined,
  });

  node.setAttr(VC_NODE_KIND_ATTR, "element");
  syncNodeMetadata(node, element);
  setNodeZIndex(node, element.zIndex);
  loadImageIntoNode(node, fnGetImageSource({ url: data.url, base64: data.base64 }));
  return node;
}

function updateImageNodeFromElement(render: SceneService, node: Konva.Image, element: TElement) {
  return txUpdateImageNodeFromElement({
    setNodeZIndex,
    syncNodeMetadata,
    getImageSource: fnGetImageSource,
    loadImageIntoNode,
    batchDraw: () => {
      render.staticForegroundLayer.batchDraw();
    },
  }, {
    node,
    element,
  });
}

function toElement(node: Konva.Image): TElement {
  const worldPosition = fnGetWorldPosition({
    absolutePosition: node.absolutePosition(),
    parentTransform: node.getLayer()?.getAbsoluteTransform() ?? null,
  });
  const absoluteScale = node.getAbsoluteScale();
  const layer = node.getLayer();
  const layerScaleX = layer?.scaleX() ?? 1;
  const layerScaleY = layer?.scaleY() ?? 1;
  const parentGroupId = fnGetCanvasParentGroupId(node);

  const crop = structuredClone(node.getAttr(IMAGE_CROP_ATTR) ?? {
    x: 0,
    y: 0,
    width: node.width(),
    height: node.height(),
    naturalWidth: node.width(),
    naturalHeight: node.height(),
  }) as TImageData["crop"];

  return fnToImageElement({
    id: node.id(),
    x: worldPosition.x,
    y: worldPosition.y,
    rotation: node.getAbsoluteRotation(),
    createdAt: Number(node.getAttr(ELEMENT_CREATED_AT_ATTR) ?? Date.now()),
    updatedAt: Date.now(),
    parentGroupId,
    zIndex: fnGetNodeZIndex({ node }),
    opacity: node.opacity(),
    scaleX: absoluteScale.x / layerScaleX,
    scaleY: absoluteScale.y / layerScaleY,
    url: (node.getAttr(IMAGE_URL_ATTR) as string | null) ?? null,
    base64: (node.getAttr(IMAGE_BASE64_ATTR) as string | null) ?? null,
    width: node.width(),
    height: node.height(),
    crop,
  });
}

function createPreviewClone(node: Konva.Image) {
  const clone = new Konva.Image({
    ...node.getAttrs(),
    id: crypto.randomUUID(),
    draggable: true,
  });
  clone.image(node.image());
  clone.setAttr(IMAGE_URL_ATTR, node.getAttr(IMAGE_URL_ATTR) ?? null);
  clone.setAttr(IMAGE_BASE64_ATTR, node.getAttr(IMAGE_BASE64_ATTR) ?? null);
  clone.setAttr(IMAGE_CROP_ATTR, structuredClone(node.getAttr(IMAGE_CROP_ATTR) ?? null));
  clone.setAttr(ELEMENT_CREATED_AT_ATTR, Date.now());
  clone.setAttr(IMAGE_SOURCE_ATTR, node.getAttr(IMAGE_SOURCE_ATTR) ?? null);
  setNodeZIndex(clone, "");
  return clone;
}

function safeStopDrag(node: Konva.Node) {
  try {
    if (node.isDragging()) {
      node.stopDrag();
    }
  } catch {
    return;
  }
}

function filterSelection(selection: Konva.Node[]) {
  return fnFilterSelection({
    selection: selection.filter((node): node is Konva.Group | Konva.Shape => {
      return node instanceof Konva.Group || node instanceof Konva.Shape;
    }),
  });
}

/**
 * Handles image insertion and image node runtime wiring.
 * Supports picker, paste, drop, drag, and serialization hooks.
 */
export function createImagePlugin(): IPlugin<{
  contextMenu: ContextMenuService;
  crdt: CrdtService;
  element: ElementService;
  group: GroupService;
  history: HistoryService;
  scene: SceneService;
  renderOrder: RenderOrderService;
  selection: SelectionService;
  session: SessionService;
  tool: ToolService;
}, IRuntimeHooks, IRuntimeConfig> {
  let fileInput: HTMLInputElement | null = null;

  return {
    name: "image",
    apply(ctx) {
      const contextMenu = ctx.services.require("contextMenu");
      const crdt = ctx.services.require("crdt");
      const elementService = ctx.services.require("element");
      const groupService = ctx.services.require("group");
      const history = ctx.services.require("history");
      const render = ctx.services.require("scene");
      const renderOrder = ctx.services.require("renderOrder");
      const selection = ctx.services.require("selection");
      const session = ctx.services.require("session");
      const toolService = ctx.services.require("tool");

      const updateImageNodeFromElementPortal = {
        setNodeZIndex,
        syncNodeMetadata,
        getImageSource: fnGetImageSource,
        loadImageIntoNode,
        batchDraw: () => {
          render.staticForegroundLayer.batchDraw();
        },
      };

      const cloneBackendFileForElementPortal = {
        cloneImage: ({ url }: { url: string }) => ctx.config.apiService.api.file.clone({ body: { url } }).then(([err, res]) => {
          if (err) {
            throw err;
          }
          return res;
        }),
        crdt,
        findImageNodeById: (id: string) => {
          const node = render.staticForegroundLayer.findOne((candidate: Konva.Node) => {
            return candidate instanceof Konva.Image && candidate.id() === id;
          });

          return node instanceof Konva.Image ? node : null;
        },
        notification: getNotification(ctx.config),
        updateImageNodeFromElementPortal,
      };

      const applyElement = (element: TElement) => {
        const didUpdate = elementService.updateElement(element);
        if (!didUpdate) {
          return;
        }

        const node = render.staticForegroundLayer.findOne((candidate: Konva.Node) => {
          return candidate.id() === element.id;
        });
        if (!node) {
          return;
        }

        fnGetCanvasAncestorGroups(node).forEach((group) => {
          group.fire("transform");
        });
        render.staticForegroundLayer.batchDraw();
      };

      const setupNode = (node: Konva.Image) => {
        txSetupImageListeners({
          elementService,
          crdt,
          history,
          render,
          selection,
          hooks: ctx.hooks,
          startDragClone: (args) => elementService.createDragClone(args),
          applyElement,
          updateImageNodeFromElementPortal,
          filterSelection,
          safeStopDrag,
          toElement,
          createThrottledPatch: () => {
            return throttle((element: TElement) => {
              if (crdt.doc().elements[element.id] === undefined) {
                return;
              }

              const builder = crdt.build();
              builder.patchElement(element.id, "x", element.x);
              builder.patchElement(element.id, "y", element.y);
              builder.patchElement(element.id, "updatedAt", element.updatedAt);
              builder.commit();
            }, 100);
          },
        }, {
          node,
        });
        return node;
      };

      const createRuntimeImageNode = (element: TElement) => {
        const node = elementService.createNodeFromElement(element);
        if (!(node instanceof Konva.Image)) {
          throw new Error("Failed to create image runtime node");
        }

        return node;
      };

      const cloneDragPortal = {
        cloneBackendFileForElementPortal,
        crdt,
        history,
        render,
        renderOrder,
        selection,
        createPreviewClone: (sourceNode: Konva.Image) => createPreviewClone(sourceNode),
        createImageNode: (element: TElement) => createImageNode(element),
        setupNode,
        toElement,
        now: () => Date.now(),
      };

      const openFilePicker = () => {
        fileInput?.click();
      };

      const insertImage = async (args: { file: File; point?: { x: number; y: number } }) => {
        await txInsertImage({
          crdt,
          history,
          render,
          renderOrder,
          selection,
          uploadImage: (body) => ctx.config.apiService.api.file.put({
            body: {
              data: new Blob([body.data], { type: body.mime_type }),
              mime_type: body.mime_type,
            },
          }).then(([err, res]) => {
            if (err) {
              throw err;
            }
            return res;
          }),
          notification: getNotification(ctx.config),
          createId: () => crypto.randomUUID(),
          now: () => Date.now(),
          fileToDataUrl: (file) => fnFileToDataUrl({
            createFileReader: () => new FileReader(),
          }, {
            file,
          }),
          fileToBytes: (file) => fnFileToBytes({
            createFileReader: () => new FileReader(),
          }, {
            file,
          }),
          parseDataUrl: fnParseDataUrl,
          getImageDimensions: (source) => fnGetImageDimensions({
            createImage: () => new window.Image(),
          }, {
            src: source,
          }),
          getViewportCenter: () => getViewportCenter(render),
          getViewportWorldSize: () => getViewportWorldSize(render),
          createRuntimeNode: createRuntimeImageNode,
          toElement,
        }, args);
      };

      contextMenu.registerProvider("image", ({ targetElement, activeSelection }) => {
        if (targetElement?.data.type !== "image") {
          return [];
        }

        return [{
          id: "delete-image-selection",
          label: "Delete",
          priority: 300,
          onSelect: () => {
            selection.setSelection(activeSelection);
            txDeleteSelection({
              element: elementService,
              group: groupService,
              crdt,
              history,
              scene: render,
              renderOrder,
              selection,
            }, {});
          },
        }];
      });

      const unregisterImageElement = elementService.registerElement({
        id: "image",
        matchesElement: (element) => element.data.type === "image",
        matchesNode: (node) => node instanceof Konva.Image,
        toElement: (node) => {
          if (!(node instanceof Konva.Image)) {
            return null;
          }

          return toElement(node);
        },
        createNode: (element) => {
          if (element.data.type !== "image") {
            return null;
          }

          return createImageNode(element);
        },
        attachListeners: (node) => {
          if (!(node instanceof Konva.Image)) {
            return false;
          }

          setupNode(node);
          return true;
        },
        updateElement: (element) => {
          if (element.data.type !== "image") {
            return false;
          }

          const node = render.staticForegroundLayer.findOne((candidate: Konva.Node) => {
            return candidate instanceof Konva.Image && candidate.id() === element.id;
          });
          if (!(node instanceof Konva.Image)) {
            return false;
          }

          updateImageNodeFromElement(render, node, element);
          return true;
        },
        createDragClone: ({ node }) => {
          if (!(node instanceof Konva.Image)) {
            return false;
          }

          txCreateImageCloneDrag(cloneDragPortal, { node });
          return true;
        },
        getTransformOptions: () => ({
          keepRatio: true,
        }),
      });

      ctx.hooks.init.tap(() => {
        toolService.registerTool({
          id: "image",
          label: "Image",
          icon: ImageIcon,
          shortcuts: ["9"],
          priority: 90,
          behavior: { type: "action" },
          onSelect: openFilePicker,
        });

        fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/png,image/jpeg,image/gif,image/webp";
        fileInput.className = "hidden";
        fileInput.addEventListener("change", () => {
          const file = fileInput?.files?.[0];
          const reset = () => {
            if (fileInput) {
              fileInput.value = "";
            }
          };

          if (!file) {
            reset();
            return;
          }

          void insertImage({ file }).finally(() => {
            reset();
          });
        });

        render.stage.container().appendChild(fileInput);

        const onPaste = (event: ClipboardEvent) => {
          if (shouldIgnoreClipboardEvent(session, event)) {
            return;
          }

          const file = getFirstSupportedClipboardImageFile(event.clipboardData);
          if (!file) {
            return;
          }

          event.preventDefault();
          void insertImage({ file });
        };

        const onDragOver = (event: DragEvent) => {
          const file = getFirstSupportedImageFile(event.dataTransfer?.files);
          if (!file) {
            return;
          }

          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
          }
        };

        const onDragEnter = (event: DragEvent) => {
          const file = getFirstSupportedImageFile(event.dataTransfer?.files);
          if (!file) {
            return;
          }

          event.preventDefault();
        };

        const onDragLeave = () => {};

        const onDrop = (event: DragEvent) => {
          const file = getFirstSupportedImageFile(event.dataTransfer?.files);
          if (!file) {
            return;
          }

          event.preventDefault();
          const rect = render.stage.container().getBoundingClientRect();
          const point = screenToWorld(render, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });

          void insertImage({ file, point });
        };

        document.addEventListener("paste", onPaste);
        render.stage.container().addEventListener("dragover", onDragOver);
        render.stage.container().addEventListener("dragenter", onDragEnter);
        render.stage.container().addEventListener("dragleave", onDragLeave);
        render.stage.container().addEventListener("drop", onDrop);

        ctx.hooks.destroy.tap(() => {
          document.removeEventListener("paste", onPaste);
          render.stage.container().removeEventListener("dragover", onDragOver);
          render.stage.container().removeEventListener("dragenter", onDragEnter);
          render.stage.container().removeEventListener("dragleave", onDragLeave);
          render.stage.container().removeEventListener("drop", onDrop);
          fileInput?.remove();
          fileInput = null;
        });
      });

      ctx.hooks.destroy.tap(() => {
        contextMenu.unregisterProvider("image");
        unregisterImageElement();
        toolService.unregisterTool("image");
      });
    },
  };
}
