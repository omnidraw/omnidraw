import type { TElement, TImageData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { TCloneImage } from "../../types";
import type { CrdtService } from "../../services/crdt/CrdtService";
import { txUpdateImageNodeFromElement } from "./tx.update-image-node-from-element";
import type { TPortalUpdateImageNodeFromElement } from "./tx.update-image-node-from-element";

export type TPortalCloneBackendFileForElement = {
  cloneImage?: TCloneImage;
  crdt: CrdtService;
  findImageNodeById: (id: string) => Konva.Image | null;
  notification?: {
    showError(title: string, description?: string): void;
  };
  updateImageNodeFromElementPortal: TPortalUpdateImageNodeFromElement;
};

export type TArgsCloneBackendFileForElement = {
  element: TElement;
  errorTitle?: string;
  now: number;
};

export function txCloneBackendFileForElement(
  portal: TPortalCloneBackendFileForElement,
  args: TArgsCloneBackendFileForElement,
) {
  if (args.element.data.type !== "image") {
    return;
  }

  const sourceUrl = args.element.data.url;
  if (!sourceUrl || !portal.cloneImage) {
    return;
  }

  void portal.cloneImage({ url: sourceUrl })
    .then(({ url }: { url: string }) => {
      if (url === sourceUrl) {
        return;
      }

      const currentNode = portal.findImageNodeById(args.element.id);

      const nextElement: TElement = {
        ...args.element,
        updatedAt: args.now,
        data: {
          ...(args.element.data as TImageData),
          url,
        },
      };

      if (currentNode) {
        txUpdateImageNodeFromElement(portal.updateImageNodeFromElementPortal, {
          node: currentNode,
          element: nextElement,
        });
      }

      const builder = portal.crdt.build();
      builder.patchElement(nextElement.id, nextElement);
      builder.commit();
    })
    .catch((error: unknown) => {
      portal.notification?.showError(
        args.errorTitle ?? "Failed to clone image file",
        error instanceof Error ? error.message : "Unknown image clone error",
      );
    });
}
