import type { TElementData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type {
  TNormalizedWidgetHostData,
  TWidgetHostData,
  TWidgetHostFramePatch,
} from "./types";

export function fnIsWidgetHostData(data: TElementData): data is TWidgetHostData {
  return data.type === "ui-widget"
    || data.type === "widget-instance";
}

export function fnNormalizeWidgetHostData(
  data: TElementData,
): TNormalizedWidgetHostData | null {
  if (data.type === "widget-instance") {
    return {
      source: "revision",
      hostKey: data.definitionId,
      w: data.w,
      h: data.h,
      expanded: data.expanded,
      window: data.window,
      definitionId: data.definitionId,
      revisionId: data.revisionId,
      instanceId: data.instanceId,
      stateDocumentId: data.stateDocumentId ?? null,
    };
  }

  if (data.type === "ui-widget") {
    return {
      source: "browser-only",
      hostKey: data.kind,
      w: data.w,
      h: data.h,
      expanded: data.expanded,
      window: data.window,
      definitionId: null,
      revisionId: null,
      instanceId: null,
      stateDocumentId: null,
    };
  }

  return null;
}

export function fnPatchWidgetHostFrame(
  data: TWidgetHostData,
  patch: TWidgetHostFramePatch,
): TWidgetHostData {
  return {
    ...data,
    ...patch,
  };
}
