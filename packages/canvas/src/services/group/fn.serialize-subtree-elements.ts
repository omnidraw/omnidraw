import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { Node } from "konva/lib/Node";
import type { Shape } from "konva/lib/Shape";
import type { ElementService } from "../element/ElementService";

export type TArgsSerializeSubtreeElements = {
  element: ElementService;
  Shape: typeof Shape;
  group: Konva.Group;
};

export function fnSerializeSubtreeElements(args: TArgsSerializeSubtreeElements) {
  return args.group.find((node: Node) => node instanceof args.Shape)
    .map((node) => args.element.toElement(node))
    .filter((element): element is TElement => element !== null);
}
