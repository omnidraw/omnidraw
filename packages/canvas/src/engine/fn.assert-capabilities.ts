import type {
  TEngineCapabilities,
  TSceneNode,
} from "@omnidraw/cangine";

export type TCanvasEngineCapabilityIssue = {
  capability: string;
  expected: string;
  actual: string;
};

const REQUIRED_CORE_NODE_KINDS: readonly TSceneNode["kind"][] = [
  "layer",
  "group",
  "rect",
  "path",
  "text",
  "background",
];

export function fnCanvasEngineCapabilityIssues(
  capabilities: TEngineCapabilities,
): TCanvasEngineCapabilityIssue[] {
  const issues: TCanvasEngineCapabilityIssue[] = [];
  if (capabilities.vector2D !== "webgl2") {
    issues.push({
      capability: "vector2D",
      expected: "webgl2",
      actual: capabilities.vector2D,
    });
  }
  if (capabilities.threeD !== "disabled") {
    issues.push({
      capability: "threeD",
      expected: "disabled",
      actual: capabilities.threeD,
    });
  }
  if (!capabilities.webGl2Available) {
    issues.push({
      capability: "webGl2Available",
      expected: "true",
      actual: "false",
    });
  }

  const unsupported = new Set(capabilities.unsupportedNodeKinds);
  const missingNodeKinds = REQUIRED_CORE_NODE_KINDS.filter((kind) => {
    return unsupported.has(kind);
  });
  if (missingNodeKinds.length > 0) {
    issues.push({
      capability: "requiredNodeKinds",
      expected: "all supported",
      actual: missingNodeKinds.join(","),
    });
  }
  return issues;
}
