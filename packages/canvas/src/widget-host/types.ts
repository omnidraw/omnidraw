import type {
  TUiWidgetData,
  TWidgetInstanceData,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TWidgetHostData = TUiWidgetData | TWidgetInstanceData;

export type TNormalizedWidgetHostData = {
  source: "browser-only" | "revision";
  hostKey: string;
  w: number;
  h: number;
  expanded: boolean;
  definitionId: string | null;
  revisionId: string | null;
  instanceId: string | null;
  stateDocumentId: string | null;
};

export type TWidgetHostFramePatch = Partial<Pick<
  TWidgetHostData,
  "w" | "h" | "expanded"
>>;
