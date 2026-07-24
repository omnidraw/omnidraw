import type { TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasGroupProjection } from "../typed";
import { fnCanvasGroupNode } from "./fn.nodes";
import { fnCanvasProjectionSignature } from "./fn.signature";

type TArgsProjectGroup = {
  group: TGroup;
  parentNodeId: string;
};

export function fnProjectCanvasGroup(args: TArgsProjectGroup): TCanvasGroupProjection {
  const nodes = [fnCanvasGroupNode(args)];
  return {
    nodes,
    semanticTarget: {
      kind: "group",
      id: args.group.id,
    },
    signature: fnCanvasProjectionSignature({ value: nodes }),
  };
}
