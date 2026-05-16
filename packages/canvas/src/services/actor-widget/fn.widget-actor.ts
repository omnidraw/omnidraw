import type { TCanvasDoc, TElement, TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TActorWidgetElement = TElement & { data: TWidgetData };

export function fnIsActorWidgetElement(element: TElement | null | undefined): element is TActorWidgetElement {
  return element?.data.type === "widget";
}

export function fnListActorWidgetElements(args: { doc: TCanvasDoc | null | undefined }) {
  return Object.values(args.doc?.elements ?? {}).filter(fnIsActorWidgetElement);
}

export function fnCreateActorWidgetPendingKey(args: { canvasId: string; elementId: string }) {
  return `${args.canvasId}:${args.elementId}`;
}
