import type {
  TPortalScaleMode,
  TResourceDescriptor,
  TSceneNode,
  TSceneSnapshot,
} from "@omnidraw/cangine";
import type {
  TElementStyle,
  TElementType,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TThemeColors } from "@vibecanvas/service-theme";
import type { StrokeOptions } from "perfect-freehand";
import type { TCanvasTarget } from "../semantic/typed";

export type { TCanvasTarget } from "../semantic/typed";

export type TCanvasJsonValue =
  | string
  | number
  | boolean
  | null
  | TCanvasJsonValue[]
  | { [key: string]: TCanvasJsonValue };

export type TCanvasProjectedResource = {
  descriptor: TResourceDescriptor;
};

export type TCanvasProjectedPortalContent =
  | {
      type: "ui-widget";
      kind: string;
      payload?: Record<string, TCanvasJsonValue>;
      uiProps?: Record<string, TCanvasJsonValue>;
    }
  | {
      type: "widget-instance";
      definitionId: string;
      revisionId: string;
      instanceId: string;
      stateDocumentId?: string;
      uiProps?: Record<string, TCanvasJsonValue>;
    };

export type TCanvasProjectedPortal = {
  portalId: string;
  nodeId: string;
  elementId: string;
  scaleMode: TPortalScaleMode;
  interactive: boolean;
  suspendWhenOffscreen: boolean;
  content: TCanvasProjectedPortalContent;
};

/**
 * Renderer-neutral scheduling and layout hints for application-owned portal
 * content. Dimensions and distance are viewport CSS pixels. Scale combines
 * the effective canvas transform with device pixel ratio.
 */
export type TCanvasPortalViewportState = Readonly<{
  width: number;
  height: number;
  scale: number;
  visible: boolean;
  distance: number;
  occlusion: number;
  interactive: boolean;
}>;

export type TCanvasProjectionDiagnosticCode =
  | "DUPLICATE_GROUP_ID"
  | "ENGINE_CAPABILITY_MISSING"
  | "ELEMENT_PARENT_MISSING"
  | "GROUP_CYCLE"
  | "GROUP_PARENT_MISSING"
  | "INVALID_PROJECTION"
  | "PORTAL_REGISTRATION_FAILED"
  | "PROJECTOR_EXCEPTION"
  | "PROJECTOR_MISSING"
  | "RESOURCE_PRELOAD_FAILED";

export type TCanvasProjectionDiagnostic = {
  code: TCanvasProjectionDiagnosticCode;
  message: string;
  projectorId?: string;
  target?: TCanvasTarget;
};

export type TCanvasElementProjection = {
  nodes: readonly TSceneNode[];
  resources: readonly TCanvasProjectedResource[];
  portals: readonly TCanvasProjectedPortal[];
  semanticTarget: Extract<TCanvasTarget, { kind: "element" }>;
  signature: string;
  placeholder: boolean;
};

export type TCanvasGroupProjection = {
  nodes: readonly TSceneNode[];
  semanticTarget: Extract<TCanvasTarget, { kind: "group" }>;
  signature: string;
};

export type TCanvasProjectionIndex = {
  elementNodeIds: Readonly<Record<string, readonly string[]>>;
  groupNodeIds: Readonly<Record<string, string>>;
  nodeTargets: Readonly<Record<string, TCanvasTarget>>;
  elementResourceIds: Readonly<Record<string, readonly string[]>>;
  elementPortalIds: Readonly<Record<string, readonly string[]>>;
  elementSignatures: Readonly<Record<string, string>>;
  groupSignatures: Readonly<Record<string, string>>;
  nodePositions?: Readonly<Record<string, number>>;
  nodePositionEpochs?: Readonly<Record<string, number>>;
  nodePositionEdits?: readonly Readonly<{
    position: number;
    delta: number;
  }>[];
  /**
   * Non-enumerable persistent node sequence used by incremental projection.
   * The published snapshot remains JSON-compatible; this index is an
   * implementation detail and is intentionally omitted from serialization.
   */
  nodeSequence?: readonly TSceneNode[];
  activeProjectionSignature: string;
  lastAppliedRevision: number | null;
};

export type TCanvasProjectionWork = {
  collectionCopies: number;
  collectionScans: number;
  projectedRoots: number;
  projectedNodes: number;
  copiedNodeSlots: number;
  recoveryPasses: number;
  invariantFallbacks: number;
};

export type TCanvasDocumentProjection = {
  snapshot: TSceneSnapshot;
  resources: readonly TCanvasProjectedResource[];
  portals: readonly TCanvasProjectedPortal[];
  diagnostics: readonly TCanvasProjectionDiagnostic[];
  index: TCanvasProjectionIndex;
  signature: string;
};

export type TCanvasProjectionCollectionDiff<T> = {
  added: readonly T[];
  updated: readonly T[];
  removed: readonly string[];
};

export type TCanvasProjectionDiff = {
  nodes: TCanvasProjectionCollectionDiff<TSceneNode>;
  resources: TCanvasProjectionCollectionDiff<TCanvasProjectedResource>;
  portals: TCanvasProjectionCollectionDiff<TCanvasProjectedPortal>;
  elements: {
    added: readonly string[];
    updated: readonly string[];
    removed: readonly string[];
  };
  groups: {
    added: readonly string[];
    updated: readonly string[];
    removed: readonly string[];
  };
  changed: boolean;
  previousSignature: string;
  nextSignature: string;
};

export type TCanvasProjectionThemeColors = Pick<
  TThemeColors,
  | "accent"
  | "accentForeground"
  | "border"
  | "canvasBackground"
  | "canvasGridMajor"
  | "canvasGridMinor"
  | "canvasSelectionStroke"
  | "canvasText"
  | "card"
  | "destructive"
  | "muted"
  | "mutedForeground"
  | "ring"
  | "success"
  | "warning"
>;

export type TCanvasProjectionTheme = {
  id: string;
  colors: TCanvasProjectionThemeColors;
  colorTokens: Readonly<Record<string, string>>;
  strokeWidths?: Readonly<Record<string, number>>;
  cornerRadii?: Readonly<Record<string, number>>;
  fontSizes?: Readonly<Record<string, number>>;
  styleDefaults?: Readonly<Partial<Record<TElementType, TElementStyle>>>;
};

export type TCanvasStrokeGenerator = (
  points: [number, number, number][],
  options: StrokeOptions,
) => number[][];

export type TCanvasProjectionDependencies = {
  getStroke: TCanvasStrokeGenerator;
  unsupportedNodeKinds?: readonly TSceneNode["kind"][];
  portalsAvailable?: boolean;
  getViewportSize?(): Readonly<{
    width: number;
    height: number;
  }>;
};
