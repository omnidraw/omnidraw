import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { ElementService } from "../../services";

type TPortalTxDispatchSelectionTransformHooks = {
  element: ElementService;
};

type TArgsTxDispatchSelectionTransformHooks<TArgs extends { node: Konva.Node; element: TElement; selection: Konva.Node[] }> = {
  selection: Konva.Node[];
  createArgs: (node: Konva.Node, element: TElement) => TArgs;
  getHook: (definition: ReturnType<ElementService["getMatchingElementDefinitionsByNode"]>[number]) => ((args: TArgs) => { cancel: boolean; crdt: boolean } | void) | undefined;
};

export function txDispatchSelectionTransformHooks<TArgs extends { node: Konva.Node; element: TElement; selection: Konva.Node[] }>(portal: TPortalTxDispatchSelectionTransformHooks, args: TArgsTxDispatchSelectionTransformHooks<TArgs>) {
  let result = { cancel: false, crdt: false };
  const handledNodeIds = new Set<string>();

  for (const node of args.selection) {
    const element = portal.element.toElement(node);
    if (!element) {
      continue;
    }

    const hookArgs = args.createArgs(node, element);
    const definitions = portal.element.getMatchingElementDefinitionsByNode(node);
    let handledNode = false;
    for (const definition of definitions) {
      const hookResult = args.getHook(definition)?.(hookArgs);
      if (hookResult) {
        result = {
          cancel: result.cancel || hookResult.cancel,
          crdt: result.crdt || hookResult.crdt,
        };
      }
      handledNode = handledNode || Boolean(hookResult?.cancel);
    }

    if (handledNode) {
      handledNodeIds.add(node.id());
    }
  }

  return {
    ...result,
    handledNodeIds,
  };
}
