import type { TElement, TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { fnGetCanvasParentGroupId } from "../../core/fn.canvas-node-semantics";
import { fnGetNodeZIndex } from "../../core/fn.get-node-z-index";
import { isKonvaGroup } from "../../core/GUARDS";
import { ELEMENT_DATA_ATTR } from "./../../core/CONSTANTS";

export function fnToWidgetElement(node: unknown) {
  if(!isKonvaGroup(node)) return null
  const data: TWidgetData = node.getAttr(ELEMENT_DATA_ATTR)
  if(!data) return null

  const element: TElement = {
    id: node.id(),
    bindings: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data,
    style: {},
    locked: false,
    parentGroupId: fnGetCanvasParentGroupId(node),
    rotation: node.rotation(),
    x: node.x(),
    y: node.y(),
    zIndex: fnGetNodeZIndex({ node })
  }
  return element;
}
