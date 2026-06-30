import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { fnGetShape2dTextData } from "./fn.shape2d";

export type TArgsResolveSelectionStyleTextElements = {
  elements: TElement[];
};

export function fnResolveSelectionStyleTextElements(
  args: TArgsResolveSelectionStyleTextElements,
) {
  const seenElementIds = new Set<string>();
  const textElements: TElement[] = [];

  const pushElement = (element: TElement | null) => {
    if (!element) {
      return;
    }

    const isTextElement = element.data.type === "text" || fnGetShape2dTextData(element) !== null;
    if (!isTextElement) {
      return;
    }

    if (seenElementIds.has(element.id)) {
      return;
    }

    seenElementIds.add(element.id);
    textElements.push(element);
  };

  args.elements.forEach((element) => {
    pushElement(element);
  });

  return textElements;
}
