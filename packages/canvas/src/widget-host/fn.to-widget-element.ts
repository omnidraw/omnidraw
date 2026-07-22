import type { TElement, TElementData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import { ELEMENT_DATA_ATTR, ELEMENT_STYLE_ATTR, VC_CREATED_AT_ATTR, VC_UPDATED_AT_ATTR } from "../core/CONSTANTS";
import { fnGetCanvasParentGroupId } from "../core/fn.canvas-node-semantics";
import { fnGetNodeZIndex } from "../core/fn.get-node-z-index";
import { fnGetWorldPosition } from "../core/fn.world-position";
import {
  fnIsWidgetHostData,
  fnPatchWidgetHostFrame,
} from "./fn.normalize-widget-host-data";

function fnIsKonvaGroup(node: unknown): node is Konva.Group {
  return typeof node === "object"
    && node !== null
    && "getClassName" in node
    && typeof node.getClassName === "function"
    && node.getClassName() === "Group";
}

export function fnToWidgetElement(node: unknown, now: number) {
  if(!fnIsKonvaGroup(node)) return null
  const data = node.getAttr(ELEMENT_DATA_ATTR) as TElementData | undefined
  if (!data || !fnIsWidgetHostData(data)) return null

  const worldPosition = fnGetWorldPosition({
    absolutePosition: node.absolutePosition(),
    parentTransform: node.getLayer()?.getAbsoluteTransform() ?? null,
  })
  const absoluteScale = node.getAbsoluteScale()
  const layer = node.getLayer()
  const layerScaleX = layer?.scaleX() ?? 1
  const layerScaleY = layer?.scaleY() ?? 1
  const scaleX = Math.abs(absoluteScale.x / layerScaleX)
  const scaleY = Math.abs(absoluteScale.y / layerScaleY)
  const updatedAt = Number(node.getAttr(VC_UPDATED_AT_ATTR) ?? now)
  const createdAt = Number(node.getAttr(VC_CREATED_AT_ATTR) ?? updatedAt)
  const width = Math.max(0, node.width() * scaleX)
  const height = Math.max(0, node.height() * scaleY)

  const element: TElement = {
    id: node.id(),
    bindings: [],
    createdAt,
    updatedAt,
    data: fnPatchWidgetHostFrame(data, {
      w: width,
      h: height,
    }),
    style: node.getAttr(ELEMENT_STYLE_ATTR) ?? {},
    locked: false,
    parentGroupId: fnGetCanvasParentGroupId(node),
    rotation: node.getAbsoluteRotation(),
    x: worldPosition.x,
    y: worldPosition.y,
    zIndex: fnGetNodeZIndex({ node })
  }
  return element;
}
