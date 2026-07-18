import type { TElement, TUiWidgetData, TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ELEMENT_DATA_ATTR, ELEMENT_STYLE_ATTR, VC_CREATED_AT_ATTR, VC_UPDATED_AT_ATTR } from "@vibecanvas/canvas/core/CONSTANTS";
import { fnGetCanvasParentGroupId } from "@vibecanvas/canvas/core/fn.canvas-node-semantics";
import { fnGetNodeZIndex } from "@vibecanvas/canvas/core/fn.get-node-z-index";
import { fnGetWorldPosition } from "@vibecanvas/canvas/core/fn.world-position";
import { isKonvaGroup } from "@vibecanvas/canvas/core/GUARDS";

export function fnToWidgetElement(node: unknown, now: number) {
  if(!isKonvaGroup(node)) return null
  const data: TUiWidgetData | TWidgetData = node.getAttr(ELEMENT_DATA_ATTR)
  if(data?.type !== 'widget' && data?.type !== 'ui-widget') return null

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
    data: {
      ...data,
      w: width,
      h: height,
    },
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
