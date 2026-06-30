import type { ThemeService } from "@vibecanvas/service-theme";
import { DEFAULT_TEXT_LINE_HEIGHT } from "./CONSTANTS";
import { fnGetAbsolutePositionFromWorldPosition } from "../../core/fn.world-position";
import type { TElement, TTextData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import { ELEMENT_DATA_ATTR, ELEMENT_STYLE_ATTR, VC_CREATED_AT_ATTR, VC_UPDATED_AT_ATTR } from "../../core/CONSTANTS";
import type { SceneService } from "../../services/scene/SceneService";

export type TPortalUpdateTextNodeFromElement = {
  Konva: typeof Konva;
  scene: SceneService;
  theme: ThemeService;
};

export type TArgsUpdateTextNodeFromElement = {
  element: TElement;
  freeTextName: string;
};

export function txUpdateTextNodeFromElement(portal: TPortalUpdateTextNodeFromElement, args: TArgsUpdateTextNodeFromElement) {
  if (args.element.data.type !== "text" || args.element.data.containerId !== null) {
    return false;
  }

  const node = portal.scene.staticForegroundLayer.findOne((candidate: Konva.Node) => {
    return candidate instanceof portal.Konva.Text && candidate.id() === args.element.id;
  });
  if (!(node instanceof portal.Konva.Text)) {
    return false;
  }

  const data = args.element.data as TTextData;
  const absolutePosition = fnGetAbsolutePositionFromWorldPosition({
    worldPosition: { x: args.element.x, y: args.element.y },
    parentTransform: node.getLayer()?.getAbsoluteTransform() ?? null,
  });

  node.absolutePosition(absolutePosition);
  node.rotation(args.element.rotation);
  node.width(data.w);
  node.height(data.h);
  node.text(data.text);
  node.fontSize(portal.theme.resolveFontSize(args.element.style.fontSize));
  node.fontFamily(data.fontFamily);
  node.align(args.element.style.textAlign ?? "left");
  node.verticalAlign(args.element.style.verticalAlign ?? "top");
  node.lineHeight(DEFAULT_TEXT_LINE_HEIGHT);
  node.opacity(args.element.style.opacity ?? 1);
  node.fill(portal.theme.resolveThemeColor(args.element.style.strokeColor, portal.theme.getTheme().colors.canvasText) ?? portal.theme.getTheme().colors.canvasText);
  node.setAttr(ELEMENT_DATA_ATTR, structuredClone(args.element.data));
  node.setAttr(ELEMENT_STYLE_ATTR, structuredClone(args.element.style));
  node.setAttr(VC_CREATED_AT_ATTR, args.element.createdAt);
  node.setAttr(VC_UPDATED_AT_ATTR, args.element.updatedAt);
  node.setAttr("vcUsesThemeTextColor", !args.element.style.strokeColor);
  node.setAttr("vcContainerId", null);
  node.setAttr("vcOriginalText", data.originalText);
  node.setAttr("vcTextAutoResize", data.autoResize);
  node.scale({ x: args.element.scaleX ?? 1, y: args.element.scaleY ?? 1 });
  node.wrap("none");
  node.listening(true);
  node.draggable(true);
  node.name(args.freeTextName);
  return true;
}
