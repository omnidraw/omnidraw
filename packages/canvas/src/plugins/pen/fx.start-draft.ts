import type { ThemeService, TThemeDefinition } from "@vibecanvas/service-theme";
import type Konva from "konva";
import type { StrokeOptions } from "perfect-freehand";
import type { TEditorToolCanvasPoint } from "src/services/editor/EditorService";
import { fxCreatePenNode } from "./fx.create-node";
import { fnCreatePenDraftElement } from "./fn.draft-element";

const DRAFT_POINTS_ATTR = "vcDraftStrokePoints";

type TGetStroke = (
  points: [number, number, number][],
  options: StrokeOptions,
) => number[][];

export type TPortalFxStartPenDraft = {
  Path: typeof Konva.Path;
  theme: ThemeService;
  getStroke: TGetStroke;
  resolveThemeColor: (theme: string | TThemeDefinition, value: string | undefined, fallback?: string | undefined) => string | undefined;
  now: () => number;
};

export type TArgsFxStartPenDraft = {
  point: TEditorToolCanvasPoint;
};

export function fxStartPenDraft(portal: TPortalFxStartPenDraft, args: TArgsFxStartPenDraft) {
  const node = fxCreatePenNode({
    Path: portal.Path,
    theme: portal.theme,
    getStroke: portal.getStroke,
    resolveThemeColor: portal.resolveThemeColor,
  }, {
    element: fnCreatePenDraftElement({
      id: "pen-draft",
      now: portal.now(),
      points: [args.point],
    }),
  });

  if (!node) {
    throw new Error("Failed to create pen node");
  }

  node.setAttr(DRAFT_POINTS_ATTR, [args.point]);
  node.listening(false);
  node.draggable(false);
  return node;
}
