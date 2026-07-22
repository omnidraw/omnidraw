import type {
  TUiWidgetData,
  TWidgetInstanceData,
  TWidgetWindow,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type THostThemeColors = {
  headerFill: string;
  headerTitleFill: string;
  bodyFill: string;
  dividerFill: string;
  windowStroke: string;
  trafficLightStroke: string;
  closeButtonFill: string;
  minimizeButtonFill: string;
  maximizeButtonFill: string;
};

export type TWidgetHostData = TUiWidgetData | TWidgetInstanceData;

export type TNormalizedWidgetHostData = {
  source: "browser-only" | "revision";
  hostKey: string;
  w: number;
  h: number;
  expanded: boolean;
  window: TWidgetWindow;
  definitionId: string | null;
  revisionId: string | null;
  instanceId: string | null;
  stateDocumentId: string | null;
};

export type TWidgetHostFramePatch = Partial<Pick<
  TWidgetHostData,
  "w" | "h" | "expanded" | "window"
>>;
