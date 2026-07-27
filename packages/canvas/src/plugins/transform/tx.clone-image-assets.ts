import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TPortal = {
  cloneImage(args: { url: string }): Promise<{ url: string }>;
  deleteImage(args: { url: string }): Promise<{ ok: true }>;
};

export type TArgs = {
  elements: readonly TElement[];
};

export async function txCloneImageAssets(
  portal: TPortal,
  args: TArgs,
) {
  const clonedUrls: string[] = [];
  const urlByElementId = new Map<string, string>();
  try {
    for (const element of args.elements) {
      if (element.data.type !== "image" || element.data.url === null) {
        continue;
      }
      const { url } = await portal.cloneImage({ url: element.data.url });
      clonedUrls.push(url);
      urlByElementId.set(element.id, url);
    }
    return { clonedUrls, urlByElementId };
  } catch (error) {
    await Promise.allSettled(clonedUrls.map((url) => {
      return portal.deleteImage({ url });
    }));
    throw error;
  }
}
