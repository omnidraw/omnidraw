import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TPortalDeleteBackendFileForElement = {
  deleteImage?: (args: { url: string }) => Promise<{ ok: true }>;
  notification?: {
    showError(title: string, description?: string): void;
  };
};

export type TArgsDeleteBackendFileForElement = {
  element: TElement;
};

export async function txDeleteBackendFileForElement(
  portal: TPortalDeleteBackendFileForElement,
  args: TArgsDeleteBackendFileForElement,
) {
  if (args.element.data.type !== "image" || !args.element.data.url || !portal.deleteImage) {
    return;
  }

  try {
    await portal.deleteImage({ url: args.element.data.url });
  } catch (error) {
    portal.notification?.showError(
      "Failed to delete image file",
      error instanceof Error ? error.message : "Unknown image deletion error",
    );
  }
}
