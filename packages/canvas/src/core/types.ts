// types used across different core functions

import type Konva from "konva";
import type { Shape, ShapeConfig } from "konva/lib/Shape";

//
export type TCanvasNodeKind = "group" | "element";
export type TCanvasNode = Konva.Group | Shape<ShapeConfig>;
