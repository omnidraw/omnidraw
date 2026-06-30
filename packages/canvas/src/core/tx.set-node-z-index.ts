import type Konva from "konva";
import { VC_Z_INDEX_ATTR } from "./CONSTANTS";

export type TPortalSetNodeZIndex = Record<string, never>;

export type TArgsSetNodeZIndex = {
  node: Konva.Group | Konva.Shape;
  zIndex: string;
};

export function txSetNodeZIndex(
  portal: TPortalSetNodeZIndex,
  args: TArgsSetNodeZIndex,
) {
  void portal;
  args.node.setAttr(VC_Z_INDEX_ATTR, args.zIndex);
}
