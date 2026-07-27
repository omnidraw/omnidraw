import type {
  TColor,
  TPaint,
  TSceneNode,
  TStrokeStyle,
} from "@omnidraw/cangine";
import type {
  TElement,
  TGroup,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type {
  TCanvasProjectedPortal,
  TCanvasProjectedResource,
  TCanvasProjectionDependencies,
  TCanvasProjectionDiagnostic,
  TCanvasProjectionTheme,
} from "../typed";

export type TCanvasElementProjectionDraft = {
  nodes: readonly TSceneNode[];
  resources?: readonly TCanvasProjectedResource[];
  portals?: readonly TCanvasProjectedPortal[];
};

export type TCanvasElementProjectorArgs = {
  element: TElement;
  parentNodeId: string;
  theme: TCanvasProjectionTheme;
  dependencies: TCanvasProjectionDependencies;
};

export type TCanvasProjectionDefinition = {
  id: string;
  priority: number;
  matchesElement(element: TElement): boolean;
  project(args: TCanvasElementProjectorArgs): TCanvasElementProjectionDraft;
};

export type TCanvasResolvedElementStyle = {
  fill: TPaint | undefined;
  stroke: TStrokeStyle | undefined;
  textColor: TColor;
  opacity: number;
  cornerRadius: number;
  fontSize: number;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
};

export type TCanvasTopologicalGroupResult = {
  groups: readonly TGroup[];
  resolvedParentGroupIds: Readonly<Record<string, string | null>>;
  diagnostics: readonly TCanvasProjectionDiagnostic[];
};

export type TCanvasProjectionIndexEntry = {
  elementId: string;
  nodeIds: readonly string[];
  resourceIds: readonly string[];
  portalIds: readonly string[];
  signature: string;
};
