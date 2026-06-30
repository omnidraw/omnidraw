import type Konva from "konva";
import { VC_Z_INDEX_ATTR } from "./CONSTANTS";

export type TArgsGetNodeZIndex = {
  node: Konva.Group | Konva.Shape;
};

export function fnGetNodeZIndex(args: TArgsGetNodeZIndex) {
  const value = args.node.getAttr(VC_Z_INDEX_ATTR);
  return typeof value === "string" ? value : "";
}
