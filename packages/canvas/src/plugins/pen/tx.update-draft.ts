import type { ThemeService, TThemeDefinition } from "@vibecanvas/service-theme";
import type Konva from "konva";
import type { StrokeOptions } from "perfect-freehand";
import type { SceneService } from "../../services/scene/SceneService";
import type { TEditorToolCanvasPoint } from "src/services/editor/EditorService";
import { fnCreatePenDraftElement } from "./fn.draft-element";
import { txUpdatePenPathFromElement } from "./tx.path";

const DRAFT_POINTS_ATTR = "vcDraftStrokePoints";

type TGetStroke = (
  points: [number, number, number][],
  options: StrokeOptions,
) => number[][];

export type TPortalTxUpdatePenDraft = {
  Path: typeof Konva.Path;
  render: SceneService;
  theme: ThemeService;
  getStroke: TGetStroke;
  resolveThemeColor: (theme: string | TThemeDefinition, value: string | undefined, fallback?: string | undefined) => string | undefined;
};

export type TArgsTxUpdatePenDraft = {
  previewNode: Konva.Path;
  point: TEditorToolCanvasPoint;
  now: number;
};

export function txUpdatePenDraft(portal: TPortalTxUpdatePenDraft, args: TArgsTxUpdatePenDraft) {
  const points = [
    ...((args.previewNode.getAttr(DRAFT_POINTS_ATTR) as TEditorToolCanvasPoint[] | undefined) ?? []),
    args.point,
  ];
  args.previewNode.setAttr(DRAFT_POINTS_ATTR, points);

  txUpdatePenPathFromElement({
    Path: portal.Path,
    render: portal.render,
    theme: portal.theme,
    getStroke: portal.getStroke,
    resolveThemeColor: portal.resolveThemeColor,
  }, {
    node: args.previewNode,
    element: fnCreatePenDraftElement({
      id: args.previewNode.id(),
      now: args.now,
      points,
    }),
  });
  args.previewNode.listening(false);
  args.previewNode.draggable(false);
}
