import type { IPlugin } from "@vibecanvas/runtime";
import ImageIcon from "lucide-static/icons/image.svg?raw";
import { fnGetSupportedImageFormat } from "../../core/fn.image-utils";
import type {
  TCanvasProductTransientOwner,
  TCanvasProductTransientProjection,
} from "../../engine/product-runtime/typed";
import { fnCanvasEngineTransientOwnerId } from "../../engine/projection/fn.ids";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";
import { fnCreateImageElement } from "./fn.create-image-element";
import { fnFitImageToViewport } from "./fn.fit-image-to-viewport";

type TPendingImageInsert = {
  id: string;
  phase: "pending" | "committed" | "cancelled";
  preview: TCanvasProductTransientOwner;
  uploadPromise: Promise<
    | { ok: true; upload: { url: string } }
    | { ok: false; error: unknown }
  > | null;
  uploadedUrl: string | null;
  cleanupStarted: boolean;
  removeProjectionListener: (() => void) | null;
};

function createId(document: Document) {
  return document.defaultView?.crypto.randomUUID()
    ?? `image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function firstImage(files: Iterable<File> | ArrayLike<File> | null | undefined) {
  return Array.from(files ?? []).find((file) => {
    return fnGetSupportedImageFormat(file.type) !== null;
  }) ?? null;
}

function shouldIgnorePaste(
  editingId: string | null,
  event: ClipboardEvent,
) {
  if (editingId !== null) {
    return true;
  }
  const target = event.target;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function imageDimensions(
  document: Document,
  source: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = document.createElement("img");
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (width <= 0 || height <= 0) {
        reject(new Error("Decoded image has invalid dimensions"));
        return;
      }
      resolve({ width, height });
    };
    image.onerror = () => reject(new Error("Failed to decode image"));
    image.src = source;
  });
}

function pendingImageProjection(args: {
  center: { x: number; y: number };
  width: number;
  height: number;
  decoded: boolean;
}): TCanvasProductTransientProjection {
  return {
    band: "world-overlay",
    hitTest: "none",
    nodes: [{
      id: "preview",
      parentId: null,
      orderKey: "0",
      kind: "rect",
      size: {
        width: args.width,
        height: args.height,
      },
      transform: {
        position: {
          x: args.center.x - args.width / 2,
          y: args.center.y - args.height / 2,
        },
      },
      fill: {
        r: 0.388,
        g: 0.4,
        b: 0.945,
        a: args.decoded ? 0.14 : 0.08,
      },
      stroke: {
        color: {
          r: 0.31,
          g: 0.27,
          b: 0.9,
          a: 0.9,
        },
        width: 2,
        dash: args.decoded ? [10, 6] : [5, 5],
      },
      opacity: 0.92,
      pointerEvents: "none",
    }],
  };
}

export function createImagePlugin():
IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "image",
    apply(ctx) {
      const camera = ctx.services.require("camera");
      const crdt = ctx.services.require("crdt");
      const element = ctx.services.require("element");
      const history = ctx.services.require("history");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
      const session = ctx.services.require("session");
      const tool = ctx.services.require("tool");
      const document = scene.container.ownerDocument;
      const window = document.defaultView;
      const cleanups: Array<() => void> = [];
      const pendingInserts = new Set<TPendingImageInsert>();
      let input: HTMLInputElement | null = null;
      let insertSequence = 0;
      let destroyed = false;

      const destroyPreview = (pending: TPendingImageInsert) => {
        pending.removeProjectionListener?.();
        pending.removeProjectionListener = null;
        pending.preview.destroy();
        pendingInserts.delete(pending);
      };

      const cleanupUploadedImage = (
        pending: TPendingImageInsert,
        url: string,
      ) => {
        if (pending.cleanupStarted) {
          return;
        }
        pending.cleanupStarted = true;
        void ctx.config.image.deleteImage({ url }).catch((error: unknown) => {
          ctx.config.notification?.showError(
            "Failed to clean up image file",
            error instanceof Error ? error.message : undefined,
          );
        });
      };

      const cancelPendingInsert = (pending: TPendingImageInsert) => {
        if (pending.phase !== "pending") {
          return;
        }
        pending.phase = "cancelled";
        destroyPreview(pending);
        if (pending.uploadedUrl !== null) {
          cleanupUploadedImage(pending, pending.uploadedUrl);
        } else {
          void pending.uploadPromise?.then((result) => {
            if (result.ok) {
              cleanupUploadedImage(pending, result.upload.url);
            }
          });
        }
      };

      const failPendingInsert = (
        pending: TPendingImageInsert,
        error: unknown,
      ) => {
        cancelPendingInsert(pending);
        ctx.config.notification?.showError(
          "Failed to insert image",
          error instanceof Error ? error.message : "Unknown image error",
        );
      };

      const retainPreviewUntilProjection = (
        pending: TPendingImageInsert,
        revision: number,
      ) => {
        pending.removeProjectionListener = scene.hooks.projection.tap((result) => {
          if (
            result.revision < revision
            || (result.status !== "applied" && result.status !== "noop")
          ) {
            return;
          }
          destroyPreview(pending);
        });
      };

      const insert = async (
        file: File,
        worldPoint?: { x: number; y: number },
      ) => {
        if (window === null || destroyed) {
          return;
        }
        const format = fnGetSupportedImageFormat(file.type);
        if (format === null) {
          ctx.config.notification?.showError("Unsupported image format");
          return;
        }

        const bounds = camera.visibleWorldBounds();
        const center = worldPoint ?? {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        };
        const viewportSize = {
          width: bounds.maxX - bounds.minX,
          height: bounds.maxY - bounds.minY,
        };
        const pendingSize = {
          width: Math.max(32, Math.min(240, viewportSize.width / 2)),
          height: Math.max(32, Math.min(180, viewportSize.height / 2)),
        };
        const id = createId(document);
        let preview: TCanvasProductTransientOwner | null = null;
        try {
          insertSequence += 1;
          preview = scene.product.transients.createOwner({
            ownerId: fnCanvasEngineTransientOwnerId({
              feature: "image-insert",
              sessionId: `${insertSequence}:${id}`,
            }),
          });
          preview.replace(pendingImageProjection({
            center,
            ...pendingSize,
            decoded: false,
          }));
        } catch (error) {
          preview?.destroy();
          ctx.config.notification?.showError(
            "Failed to insert image",
            error instanceof Error ? error.message : "Failed to show image preview",
          );
          return;
        }
        if (preview === null) {
          return;
        }

        const pending: TPendingImageInsert = {
          id,
          phase: "pending",
          preview,
          uploadPromise: null,
          uploadedUrl: null,
          cleanupStarted: false,
          removeProjectionListener: null,
        };
        pendingInserts.add(pending);

        let localUrl: string;
        try {
          localUrl = window.URL.createObjectURL(file);
        } catch (error) {
          failPendingInsert(pending, error);
          return;
        }

        const uploadPromise = Promise.resolve()
          .then(() => file.arrayBuffer())
          .then((buffer) => {
            return ctx.config.image.uploadImage({
              data: new Uint8Array(buffer),
              mime_type: format,
            });
          })
          .then(
            (upload) => ({ ok: true as const, upload }),
            (error: unknown) => ({ ok: false as const, error }),
          );
        pending.uploadPromise = uploadPromise;

        let dimensions: { width: number; height: number };
        try {
          dimensions = await imageDimensions(document, localUrl);
        } catch (error) {
          failPendingInsert(pending, error);
          return;
        } finally {
          window.URL.revokeObjectURL(localUrl);
        }

        if (pending.phase !== "pending" || destroyed) {
          cancelPendingInsert(pending);
          return;
        }

        const fitted = fnFitImageToViewport({
          viewportWidth: viewportSize.width,
          viewportHeight: viewportSize.height,
          imageWidth: dimensions.width,
          imageHeight: dimensions.height,
        });
        try {
          pending.preview.replace(pendingImageProjection({
            center,
            width: fitted.width,
            height: fitted.height,
            decoded: true,
          }));
        } catch (error) {
          failPendingInsert(pending, error);
          return;
        }

        const uploadResult = await uploadPromise;
        if (!uploadResult.ok) {
          failPendingInsert(pending, uploadResult.error);
          return;
        }
        const upload = uploadResult.upload;
        pending.uploadedUrl = upload.url;

        if (pending.phase !== "pending" || destroyed) {
          cancelPendingInsert(pending);
          cleanupUploadedImage(pending, upload.url);
          return;
        }

        const now = Date.now();
        const created = fnCreateImageElement({
          id,
          center,
          width: fitted.width,
          height: fitted.height,
          sourceUrl: upload.url,
          naturalWidth: dimensions.width,
          naturalHeight: dimensions.height,
          now,
        });
        created.zIndex = `z${String(
          Object.keys(crdt.doc().elements).length
            + Object.keys(crdt.doc().groups).length,
        ).padStart(8, "0")}`;

        let result: ReturnType<ReturnType<typeof crdt.build>["commit"]>;
        retainPreviewUntilProjection(pending, crdt.revision + 1);
        try {
          result = crdt.build()
            .patchElement(created.id, created)
            .commit();
        } catch (error) {
          if (crdt.doc().elements[created.id] === undefined) {
            failPendingInsert(pending, error);
            return;
          }
          pending.phase = "committed";
          ctx.config.notification?.showError(
            "Image inserted without history",
            error instanceof Error ? error.message : undefined,
          );
          return;
        }

        pending.phase = "committed";
        try {
          history.record({
            label: "Insert image",
            undo: () => crdt.applyOps({ ops: result.undoOps }),
            redo: () => crdt.applyOps({ ops: result.redoOps }),
          });
          selection.select({ kind: "element", id: created.id });
        } catch (error) {
          ctx.config.notification?.showError(
            "Image inserted without complete local state",
            error instanceof Error ? error.message : undefined,
          );
        }
      };

      cleanups.push(element.registerElement({
        id: "image",
        matchesElement: (candidate) => candidate.data.type === "image",
        getSelectionStyleMenu: () => ({
          sections: { showOpacityPicker: true },
          values: { opacity: 1 },
        }),
        getTransformPolicy: () => ({
          aspectRatioMode: "shift-invert",
        }),
        onDelete: (deleted) => {
          if (deleted.data.type === "image" && deleted.data.url !== null) {
            void ctx.config.image.deleteImage({ url: deleted.data.url })
              .catch((error: unknown) => {
                ctx.config.notification?.showError(
                  "Failed to delete image file",
                  error instanceof Error ? error.message : undefined,
                );
              });
          }
        },
        onRestore: (restored) => {
          if (restored.data.type !== "image" || restored.data.url === null) {
            return;
          }
          void ctx.config.image.cloneImage({ url: restored.data.url })
            .then(({ url }) => {
              const current = crdt.doc().elements[restored.id];
              if (current?.data.type !== "image") {
                return;
              }
              crdt.build().patchElement(current.id, {
                ...current,
                updatedAt: Date.now(),
                data: { ...current.data, url },
              }).commit();
            })
            .catch((error: unknown) => {
              ctx.config.notification?.showError(
                "Failed to restore image file",
                error instanceof Error ? error.message : undefined,
              );
            });
        },
      }));

      cleanups.push(tool.registerTool({
        id: "image",
        label: "Image",
        icon: ImageIcon,
        shortcuts: ["9"],
        priority: 90,
        behavior: { type: "action" },
        onSelect: () => input?.click(),
      }));

      input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/gif,image/webp";
      input.hidden = true;
      const onChange = () => {
        const file = input?.files?.[0] ?? null;
        if (file !== null) {
          void insert(file);
        }
        if (input !== null) {
          input.value = "";
        }
      };
      input.addEventListener("change", onChange);
      scene.container.append(input);

      const onPaste = (event: ClipboardEvent) => {
        if (shouldIgnorePaste(session.editingId, event)) {
          return;
        }
        const file = firstImage(event.clipboardData?.files);
        if (file === null) {
          return;
        }
        event.preventDefault();
        void insert(file);
      };
      const onDragOver = (event: DragEvent) => {
        if (firstImage(event.dataTransfer?.files) === null) {
          return;
        }
        event.preventDefault();
        if (event.dataTransfer !== null) {
          event.dataTransfer.dropEffect = "copy";
        }
      };
      const onDrop = (event: DragEvent) => {
        const file = firstImage(event.dataTransfer?.files);
        if (file === null) {
          return;
        }
        event.preventDefault();
        const viewport = camera.clientToViewport({
          x: event.clientX,
          y: event.clientY,
        });
        void insert(file, camera.viewportToWorld(viewport));
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || session.editingId !== null) {
          return;
        }
        const active = [...pendingInserts].filter((pending) => {
          return pending.phase === "pending";
        });
        if (active.length === 0) {
          return;
        }
        event.preventDefault();
        for (const pending of active) {
          cancelPendingInsert(pending);
        }
      };
      document.addEventListener("paste", onPaste);
      document.addEventListener("keydown", onKeyDown);
      scene.container.addEventListener("dragover", onDragOver);
      scene.container.addEventListener("drop", onDrop);

      ctx.hooks.destroy.tap(() => {
        destroyed = true;
        document.removeEventListener("paste", onPaste);
        document.removeEventListener("keydown", onKeyDown);
        scene.container.removeEventListener("dragover", onDragOver);
        scene.container.removeEventListener("drop", onDrop);
        input?.removeEventListener("change", onChange);
        input?.remove();
        input = null;
        for (const pending of [...pendingInserts]) {
          if (pending.phase === "pending") {
            cancelPendingInsert(pending);
          } else {
            destroyPreview(pending);
          }
        }
        for (const cleanup of cleanups.splice(0).reverse()) {
          cleanup();
        }
      });
    },
  };
}
