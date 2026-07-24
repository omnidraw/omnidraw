import type {
  TElement,
  TUiWidgetData,
  TWidgetInstanceData,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";

type TBaseCreateWidgetElementArgs = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  now: number;
};

type TCreateUiWidgetElementArgs = TBaseCreateWidgetElementArgs & {
  kind: string;
  dataType: "ui-widget";
  payload?: Record<string, unknown>;
};

type TCreateWidgetInstanceElementArgs = TBaseCreateWidgetElementArgs & {
  dataType: "widget-instance";
  definitionId: string;
  revisionId: string;
  instanceId: string;
  stateDocumentId?: string;
  uiProps?: Record<string, unknown>;
};

export type TFnCreateWidgetElementArgs =
  | TCreateUiWidgetElementArgs
  | TCreateWidgetInstanceElementArgs;

export function fnCreateWidgetElement(args: TFnCreateWidgetElementArgs): TElement {
  let data: TUiWidgetData | TWidgetInstanceData;
  if ("definitionId" in args) {
    data = {
      type: "widget-instance",
      definitionId: args.definitionId,
      revisionId: args.revisionId,
      instanceId: args.instanceId,
      ...(args.stateDocumentId === undefined
        ? {}
        : { stateDocumentId: args.stateDocumentId }),
      ...(args.uiProps === undefined ? {} : { uiProps: args.uiProps }),
      expanded: true,
      window: "contained",
      h: args.height,
      w: args.width,
    };
  } else {
    data = {
      type: "ui-widget",
      expanded: true,
      kind: args.kind,
      window: "contained",
      h: args.height,
      w: args.width,
      payload: args.payload ?? {},
    };
  }
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
