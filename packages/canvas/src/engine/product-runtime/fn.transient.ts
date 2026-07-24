import type {
  TConnectorEndpoint,
  TNodeTransformProposal,
  TPaint,
  TPathCommand,
  TSceneNode,
  TStrokeStyle,
  TTransientSceneNode,
  TTransientSceneProjection,
  TTransform2D,
} from "@vibecanvas/canvas-engine";
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
  ownerId: string;
  proposals: readonly TNodeTransformProposal[];
  nodes: readonly Readonly<TSceneNode>[];
  durableNodeIds?: ReadonlyMap<string, string>;
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
    ...(node.subtitle === undefined ? {} : { subtitle: node.subtitle }),
    style: {
      background: solid(node.style.background),
      ...(node.style.border === undefined
        ? {}
        : { border: stroke(node.style.border) }),
      titleBarBackground: solid(node.style.titleBarBackground),
      titleColor: {
        space: "srgb",
        ...node.style.titleColor,
      },
      cornerRadius: node.style.cornerRadius,
      titleBarHeight: node.style.titleBarHeight,
      padding: { ...node.style.padding },
      ...(node.style.activeOutline === undefined
        ? {}
        : { activeOutline: stroke(node.style.activeOutline) }),
    },
    ...(node.collapsed === undefined ? {} : { collapsed: node.collapsed }),
    ...(node.active === undefined ? {} : { active: node.active }),
    ...(node.resizable === undefined ? {} : { resizable: node.resizable }),
  };
}

function isTransientCompatible(
  node: Readonly<TSceneNode>,
): node is Readonly<Exclude<
  TSceneNode,
  { kind: "layer" | "html-portal" | "background" | "view-3d" }
>> {
  return node.kind !== "layer"
    && node.kind !== "html-portal"
    && node.kind !== "background"
    && node.kind !== "view-3d";
}

function remapEndpoint(
  endpoint: TConnectorEndpoint,
  idMap: ReadonlyMap<string, string>,
): TConnectorEndpoint {
  return endpoint.type === "point"
    ? { type: "point", point: { ...endpoint.point } }
    : {
        ...endpoint,
        nodeId: idMap.get(endpoint.nodeId) ?? endpoint.nodeId,
        ...(endpoint.offset === undefined
          ? {}
          : { offset: { ...endpoint.offset } }),
      };
}

function handoffNode(
  node: Readonly<TSceneNode>,
  idMap: ReadonlyMap<string, string>,
  proposal: TNodeTransformProposal | undefined,
): TTransientSceneNode | null {
  if (!isTransientCompatible(node)) {
    return null;
  }
  const {
    accessibility: _accessibility,
    extensions: _extensions,
    metadata: _metadata,
    ...withoutApplicationFields
  } = node;
  const base = {
    ...withoutApplicationFields,
    id: idMap.get(node.id)!,
    parentId: node.parentId === null
      ? null
      : idMap.get(node.parentId) ?? null,
    ...(proposal === undefined
      ? {}
      : { transform: proposal.nextTransform }),
  };
  if (node.kind === "widget-frame") {
    const withoutPortal = { ...base } as Record<string, unknown>;
    delete withoutPortal.portal;
    return {
      ...withoutPortal,
      ...(proposal?.nextSize === undefined
        ? {}
        : { size: proposal.nextSize }),
    } as unknown as TTransientSceneNode;
  }
  if (node.kind === "connector") {
    return {
      ...base,
      from: remapEndpoint(node.from, idMap),
      to: remapEndpoint(node.to, idMap),
      ...(node.avoidNodeIds === undefined
        ? {}
        : {
            avoidNodeIds: node.avoidNodeIds.map((id) => idMap.get(id) ?? id),
          }),
      ...(node.labelNodeId === undefined
        ? {}
        : {
            labelNodeId: idMap.get(node.labelNodeId) ?? node.labelNodeId,
          }),
    } as unknown as TTransientSceneNode;
  }
  if (proposal?.nextSize !== undefined && "size" in base) {
    return {
      ...base,
      size: proposal.nextSize,
    } as unknown as TTransientSceneNode;
  }
  return base as unknown as TTransientSceneNode;
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
  const idMap = new Map(
    args.nodes
      .filter(isTransientCompatible)
      .map((node) => [
        node.id,
        `${args.ownerId}::${args.durableNodeIds?.get(node.id) ?? node.id}`,
      ]),
  );
  const proposals = new Map(
    args.proposals.map((proposal) => [proposal.nodeId, proposal]),
  );
  return {
    band: "world-overlay",
    hitTest: "none",
    nodes: args.nodes.flatMap((node) => {
      const projected = handoffNode(node, idMap, proposals.get(node.id));
      return projected === null ? [] : [projected];
    }),
  };
}
