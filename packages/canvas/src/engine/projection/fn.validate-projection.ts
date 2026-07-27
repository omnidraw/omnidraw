import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { fnCanvasEngineElementId } from "./fn.ids";
import { fnIsCanvasJsonValue } from "./fn.json";
import type { TCanvasElementProjectionDraft } from "./typed";

type TArgsValidateElementProjection = {
  element: TElement;
  parentNodeId: string;
  projection: TCanvasElementProjectionDraft;
};

function finiteTransform(node: TCanvasElementProjectionDraft["nodes"][number]): boolean {
  const transform = node.transform;
  return [
    transform.position.x,
    transform.position.y,
    transform.rotation,
    transform.scale.x,
    transform.scale.y,
    transform.skew.x,
    transform.skew.y,
    transform.origin.x,
    transform.origin.y,
    node.opacity ?? 1,
  ].every(Number.isFinite);
}

export function fnValidateCanvasElementProjection(
  args: TArgsValidateElementProjection,
): string | null {
  const projectionValue = {
    nodes: args.projection.nodes,
    resources: args.projection.resources ?? [],
    portals: args.projection.portals ?? [],
  };
  if (!fnIsCanvasJsonValue({ value: projectionValue })) {
    return "Projection output must contain JSON-serializable data only.";
  }
  if (args.projection.nodes.length === 0) {
    return "Projection output contains no semantic root.";
  }

  const expectedRootId = fnCanvasEngineElementId({ id: args.element.id });
  const root = args.projection.nodes.find((node) => node.id === expectedRootId);
  if (!root || root.kind !== "group") {
    return `Projection output is missing semantic root '${expectedRootId}'.`;
  }
  if (root.parentId !== args.parentNodeId) {
    return `Semantic root '${expectedRootId}' has the wrong parent.`;
  }

  const nodeIds = new Set<string>();
  for (const node of args.projection.nodes) {
    if (nodeIds.has(node.id)) {
      return `Projection output contains duplicate node ID '${node.id}'.`;
    }
    nodeIds.add(node.id);
    if (!finiteTransform(node)) {
      return `Projection node '${node.id}' contains a non-finite transform.`;
    }
  }
  for (const node of args.projection.nodes) {
    if (
      node.id !== expectedRootId
      && (node.parentId === null || !nodeIds.has(node.parentId))
    ) {
      return `Projection node '${node.id}' references missing parent '${node.parentId ?? "null"}'.`;
    }
  }

  const resourceIds = new Set<string>();
  for (const resource of args.projection.resources ?? []) {
    if (resourceIds.has(resource.descriptor.id)) {
      return `Projection output contains duplicate resource ID '${resource.descriptor.id}'.`;
    }
    resourceIds.add(resource.descriptor.id);
  }

  const portalIds = new Set<string>();
  for (const portal of args.projection.portals ?? []) {
    if (portalIds.has(portal.portalId)) {
      return `Projection output contains duplicate portal ID '${portal.portalId}'.`;
    }
    portalIds.add(portal.portalId);
    if (portal.elementId !== args.element.id || !nodeIds.has(portal.nodeId)) {
      return `Projection portal '${portal.portalId}' does not reference its projected element node.`;
    }
  }
  return null;
}
