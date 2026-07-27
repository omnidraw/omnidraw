import type { TCanvasTarget } from "../../semantic/typed";
import type { TCanvasProjectionIndex } from "../typed";
import type {
  TCanvasProductNodeRole,
  TCanvasProductTargetRef,
} from "./typed";

type TArgsProductNodeId = {
  ref: TCanvasProductTargetRef;
  index: TCanvasProjectionIndex;
};

type TArgsProductTarget = {
  nodeId: string;
  index: TCanvasProjectionIndex;
};

function elementNodeForRole(
  nodeIds: readonly string[],
  role: TCanvasProductNodeRole,
): string | null {
  if (role === "root") {
    return nodeIds[0] ?? null;
  }
  const suffix = role === "render" ? ":render" : ":inline-text";
  return nodeIds.find((nodeId) => nodeId.endsWith(suffix)) ?? null;
}

export function fnCanvasProductNodeId(
  args: TArgsProductNodeId,
): string | null {
  if (args.ref.target.kind === "group") {
    return args.ref.role === undefined || args.ref.role === "root"
      ? args.index.groupNodeIds[args.ref.target.id] ?? null
      : null;
  }
  return elementNodeForRole(
    args.index.elementNodeIds[args.ref.target.id] ?? [],
    args.ref.role ?? "root",
  );
}

export function fnCanvasProductTarget(
  args: TArgsProductTarget,
): TCanvasTarget | null {
  return args.index.nodeTargets[args.nodeId] ?? null;
}

export function fnCanvasProductTargetKey(target: TCanvasTarget): string {
  return `${target.kind}:${target.id}`;
}
