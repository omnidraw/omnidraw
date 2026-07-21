import type { TElement, TUiWidgetData, TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TFnCreateWidgetElementArgs = {
  id: string;
  kind: string;
  dataType: "widget" | "ui-widget";
  actorDefinitionName?: string;
  payload?: Record<string, unknown>;
  x: number;
  y: number;
  width: number;
  height: number;
  now: number;
};

export function fnCreateWidgetElement(args: TFnCreateWidgetElementArgs): TElement {
  const data: TWidgetData | TUiWidgetData = args.dataType === "widget"
    ? {
        type: "widget",
        expanded: true,
        kind: args.kind,
        window: "contained",
        h: args.height,
        w: args.width,
        actorDefinitionName: args.actorDefinitionName ?? args.kind,
      }
    : {
        type: "ui-widget",
        expanded: true,
        kind: args.kind,
        window: "contained",
        h: args.height,
        w: args.width,
        payload: args.payload ?? {},
      };
  return {
    id: args.id,
    x: args.x,
    y: args.y,
    rotation: 0,
    zIndex: "",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: args.now,
    updatedAt: args.now,
    data,
    style: {},
  };
}
