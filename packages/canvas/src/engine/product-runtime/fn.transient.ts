import type {
  TNodeTransformProposal,
  TPaint,
  TPathCommand,
  TStrokeStyle,
  TTransientSceneCloneResult,
  TTransientSceneNode,
  TTransientSceneProjection,
  TTransform2D,
} from "@omnidraw/cangine";
import type {
  TCanvasProductColor,
  TCanvasProductPathCommand,
  TCanvasProductStroke,
  TCanvasProductTransientNode,
  TCanvasProductTransientProjection,
  TCanvasProductTransform,
} from "./typed";

type TArgsTransientProjection = {
  ownerId: string;
  projection: TCanvasProductTransientProjection;
};

type TArgsHandoffProjection = {
  clone: TTransientSceneCloneResult;
  proposals: readonly TNodeTransformProposal[];
};

const IDENTITY_TRANSFORM: TTransform2D = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

function solid(color: TCanvasProductColor): TPaint {
  return {
    type: "solid",
    color: {
      space: "srgb",
      ...color,
    },
  };
}

function stroke(value: TCanvasProductStroke): TStrokeStyle {
  return {
    paint: solid(value.color),
    width: value.width,
    ...(value.dash === undefined ? {} : { dash: [...value.dash] }),
  };
}

function transform(value?: Partial<TCanvasProductTransform>): TTransform2D {
  return {
    position: { ...(value?.position ?? IDENTITY_TRANSFORM.position) },
    rotation: value?.rotationRadians ?? 0,
    scale: { ...(value?.scale ?? IDENTITY_TRANSFORM.scale) },
    skew: { ...(value?.skew ?? IDENTITY_TRANSFORM.skew) },
    origin: { ...(value?.origin ?? IDENTITY_TRANSFORM.origin) },
  };
}

function pathCommand(command: TCanvasProductPathCommand): TPathCommand {
  if (command.type === "A") {
    return {
      ...command,
      radius: { ...command.radius },
      xAxisRotation: command.xAxisRotationRadians,
      to: { ...command.to },
    };
  }
  if (command.type === "Q") {
    return {
      ...command,
      control: { ...command.control },
      to: { ...command.to },
    };
  }
  if (command.type === "C") {
    return {
      ...command,
      control1: { ...command.control1 },
      control2: { ...command.control2 },
      to: { ...command.to },
    };
  }
  return command.type === "Z"
    ? { type: "Z" }
    : { type: command.type, to: { ...command.to } };
}

function transientNode(
  node: TCanvasProductTransientNode,
  idMap: ReadonlyMap<string, string>,
): TTransientSceneNode {
  const base = {
    id: idMap.get(node.id)!,
    parentId: node.parentId === null
      ? null
      : idMap.get(node.parentId) ?? null,
    orderKey: node.orderKey,
    transform: transform(node.transform),
    ...(node.opacity === undefined ? {} : { opacity: node.opacity }),
    ...(node.pointerEvents === undefined
      ? {}
      : { pointerEvents: node.pointerEvents }),
  };
  if (node.kind === "group") {
    return { ...base, kind: "group" };
  }
  if (node.kind === "rect") {
    return {
      ...base,
      kind: "rect",
      size: { ...node.size },
      ...(node.radius === undefined ? {} : { radius: node.radius }),
      ...(node.fill === undefined ? {} : { fill: solid(node.fill) }),
      ...(node.stroke === undefined ? {} : { stroke: stroke(node.stroke) }),
    };
  }
  if (node.kind === "ellipse") {
    return {
      ...base,
      kind: "ellipse",
      size: { ...node.size },
      ...(node.fill === undefined ? {} : { fill: solid(node.fill) }),
      ...(node.stroke === undefined ? {} : { stroke: stroke(node.stroke) }),
    };
  }
  if (node.kind === "polygon") {
    return {
      ...base,
      kind: "polygon",
      points: node.points.map((point) => ({ ...point })),
      closed: node.closed,
      ...(node.fill === undefined ? {} : { fill: solid(node.fill) }),
      ...(node.stroke === undefined ? {} : { stroke: stroke(node.stroke) }),
    };
  }
  if (node.kind === "path") {
    return {
      ...base,
      kind: "path",
      path: {
        commands: node.path.map(pathCommand),
      },
      ...(node.fill === undefined ? {} : { fill: solid(node.fill) }),
      ...(node.stroke === undefined ? {} : { stroke: stroke(node.stroke) }),
    };
  }
  return {
    ...base,
    kind: "widget-frame",
    size: { ...node.size },
    title: node.title,
    ...(node.collapsed === undefined ? {} : { collapsed: node.collapsed }),
    ...(node.resizable === undefined ? {} : { resizable: node.resizable }),
  };
}

export function fnCanvasEngineTransientProjection(
  args: TArgsTransientProjection,
): TTransientSceneProjection {
  const idMap = new Map(
    args.projection.nodes.map((node) => [
      node.id,
      `${args.ownerId}::${node.id}`,
    ]),
  );
  return {
    band: args.projection.band,
    hitTest: args.projection.hitTest ?? "none",
    nodes: args.projection.nodes.map((node) => transientNode(node, idMap)),
  };
}

export function fnCanvasTransformHandoffProjection(
  args: TArgsHandoffProjection,
): TTransientSceneProjection {
  const proposals = new Map(
    args.proposals.map((proposal) => [
      args.clone.idMap.get(proposal.nodeId),
      proposal,
    ]),
  );
  return {
    ...args.clone.projection,
    nodes: args.clone.projection.nodes.map((node) => {
      const proposal = proposals.get(node.id);
      if (proposal === undefined) {
        return node;
      }
      return {
        ...node,
        ...(proposal.nextSize === undefined || !("size" in node)
          ? {}
          : { size: proposal.nextSize }),
      } as TTransientSceneNode;
    }),
  };
}
