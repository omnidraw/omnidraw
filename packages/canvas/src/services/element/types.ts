import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import type { SyncHook } from "@vibecanvas/tapable";
import type Konva from "konva";
import type { TCapStyle, TFontFamily, TLineType, TStrokeWidthOption } from "../../components/SelectionStyleMenu/types";

export type TElementNodeType = TElement["data"]["type"];

export type TElementTransformHookResult = {
  cancel: boolean;
  crdt: boolean;
};

export type TElementTransformAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type TElementTransformOptions = {
  enabledAnchors?: TElementTransformAnchor[];
  keepRatio?: boolean;
  flipEnabled?: boolean;
};

export type TElementMoveArgs = {
  node: Konva.Node;
  element: TElement;
  pointer: { x: number; y: number } | null;
  selection: Konva.Node[];
};

export type TElementRotateArgs = {
  node: Konva.Node;
  element: TElement;
  rotation: number;
  selection: Konva.Node[];
};

export type TElementResizeArgs = {
  node: Konva.Node;
  element: TElement;
  pointer: { x: number; y: number } | null;
  anchors: TElementTransformAnchor[];
  selection: Konva.Node[];
};

export type TElementSelectionStyleSections = {
  showFillPicker: boolean;
  showStrokeColorPicker: boolean;
  showStrokeWidthPicker: boolean;
  showTextPickers: boolean;
  showOpacityPicker: boolean;
  showLineTypePicker: boolean;
  showStartCapPicker: boolean;
  showEndCapPicker: boolean;
};

export type TElementSelectionStyleValues = {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: string;
  opacity?: number;
  fontFamily?: TFontFamily;
  fontSize?: string;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  lineType?: TLineType;
  startCap?: TCapStyle;
  endCap?: TCapStyle;
};

export type TElementSelectionStyleConfig = {
  sections?: Partial<TElementSelectionStyleSections>;
  values?: Partial<TElementSelectionStyleValues>;
  strokeWidthOptions?: TStrokeWidthOption[];
};

export type TElementSelectionStyleArgs = {
  theme?: ThemeService;
  element?: TElement;
  node?: Konva.Node;
};

type TElementToElement = (node: Konva.Node) => TElement | null;
type TElementAfterToElement = (args: { node: Konva.Node; element: TElement }) => TElement | void;
type TElementCreateNode = (element: TElement) => Konva.Node | null;
type TElementAfterCreateNode = (args: { element: TElement; node: Konva.Node }) => void;
type TElementAttachListeners = (node: Konva.Node) => boolean | void;
type TElementUpdateElement = (element: TElement) => boolean | void;
type TElementCreateDragClone = (args: {
  node: Konva.Node;
  selection: Array<Konva.Node>;
}) => boolean | void;
type TElementGetSelectionStyleMenu = (args: TElementSelectionStyleArgs) => TElementSelectionStyleConfig | null | void;
type TElementGetTransformOptions = (args: {
  node: Konva.Node;
  element: TElement;
  selection: Array<Konva.Node>;
}) => TElementTransformOptions | void;
type TElementMoveHook = (args: TElementMoveArgs) => TElementTransformHookResult | void;
type TElementRotateHook = (args: TElementRotateArgs) => TElementTransformHookResult | void;
type TElementResizeHook = (args: TElementResizeArgs) => TElementTransformHookResult | void;

type TElementRequireAtLeastOne<T extends object> = {
  [K in keyof T]-?: Required<Pick<T, K>> & Partial<Omit<T, K>>;
}[keyof T];

type TElementElementMatcher = {
  /**
   * Matches persisted elements for create/update/clone flows.
   * Base definitions should usually provide this.
   * Modifier definitions may provide it when they want to augment persisted element behavior.
   */
  matchesElement: (element: TElement) => boolean;
};

type TElementNodeMatcher = {
  /**
   * Matches runtime nodes for serialize/listener flows.
   * Base definitions should usually provide this.
   * Modifier definitions may provide it when they want to augment runtime node behavior.
   */
  matchesNode: (node: Konva.Node) => boolean;
};

type TElementElementHookBag = {
  /**
   * Base serialize step.
   * The first matching definition with toElement builds the initial persisted element.
   */
  toElement?: TElementToElement;
  /**
   * Serialize augmentation step.
   * Runs after the base toElement step for every matching definition in priority order.
   * May return a replacement element or mutate by returning void and relying on object updates.
   */
  afterToElement?: TElementAfterToElement;
  /**
   * Base create step.
   * The first matching definition with createNode builds the one root runtime node for the element.
   * If the element needs multiple visual parts, return a Konva.Group.
   */
  createNode?: TElementCreateNode;
  /**
   * Create augmentation step.
   * Runs after the base createNode step for every matching definition in priority order.
   */
  afterCreateNode?: TElementAfterCreateNode;
  /**
   * Runtime wiring step.
   * Runs for every matching definition in priority order.
   * Use this to attach drag/pointer/transform listeners and other runtime behavior.
   */
  attachListeners?: TElementAttachListeners;
  /**
   * Update step.
   * Runs for every matching definition in priority order.
   * Use this to apply persisted element state back onto an existing runtime node.
   */
  updateElement?: TElementUpdateElement;
  /**
   * Optional alt-drag clone behavior for this element definition.
   * Returns true when the definition handled clone-drag startup.
   */
  createDragClone?: TElementCreateDragClone;
  /**
   * Optional selection-style menu config for this element definition.
   * Used for active-tool defaults and for combining style controls across selections.
   */
  getSelectionStyleMenu?: TElementGetSelectionStyleMenu;
  /**
   * Optional transformer UI behavior for this node type.
   * Runs in priority order and later definitions may override earlier fields.
   */
  getTransformOptions?: TElementGetTransformOptions;
  /**
   * Called while one selected node is moved.
   * Publishes the move event to the CRDT if `crdt` is true.
   */
  onMove?: TElementMoveHook;
  /**
   * Called after move handling completes.
   */
  afterMove?: TElementMoveHook;
  /**
   * Called while one selected node is rotated.
   * Publishes the rotate event to the CRDT if `crdt` is true.
   */
  onRotate?: TElementRotateHook;
  /**
   * Called after rotate handling completes.
   */
  afterRotate?: TElementRotateHook;
  /**
   * Called while one selected node is resized.
   * Publishes the resize event to the CRDT if `crdt` is true.
   */
  onResize?: TElementResizeHook;
  /**
   * Called after resize handling completes.
   */
  afterResize?: TElementResizeHook;
};

type TElementNodeRuntimeHookBag = Pick<
  TElementElementHookBag,
  | "attachListeners"
  | "createDragClone"
  | "getTransformOptions"
  | "onMove"
  | "afterMove"
  | "onRotate"
  | "afterRotate"
  | "onResize"
  | "afterResize"
>;

type TElementElementRuntimeHookBag = Pick<
  TElementElementHookBag,
  | "updateElement"
  | "getSelectionStyleMenu"
>;

type TElementSerializeDefinition =
  | (TElementNodeMatcher & {
    toElement: TElementToElement;
    afterToElement?: never;
  })
  | (TElementNodeMatcher & {
    toElement?: never;
    afterToElement: TElementAfterToElement;
  })
  | {
    toElement?: never;
    afterToElement?: never;
  };

type TElementCreateDefinition =
  | (TElementElementMatcher & {
    createNode: TElementCreateNode;
  })
  | (TElementElementMatcher & {
    afterCreateNode: TElementAfterCreateNode;
  });

type TElementNodeRuntimeDefinition =
  | (TElementNodeMatcher & TElementRequireAtLeastOne<TElementNodeRuntimeHookBag>)
  | {
    [K in keyof TElementNodeRuntimeHookBag]?: never;
  };

type TElementElementRuntimeDefinition =
  | (TElementElementMatcher & TElementRequireAtLeastOne<TElementElementRuntimeHookBag>)
  | {
    [K in keyof TElementElementRuntimeHookBag]?: never;
  };

/**
 * One definition may own a lifecycle step or augment it, but not both in the same step.
 * The required matcher is enforced based on the hook family the definition participates in.
 */
export type TElementElementDefinition = {
  /**
   * Unique registration id for this definition.
   * This is a registration identity, not necessarily the persisted element type.
   */
  id: string;
  /**
   * Lower priority runs first.
   * Base element definitions should usually have lower priority than modifiers.
   */
  priority?: number;
  /**
   * Matches persisted elements for create/update/clone flows.
   * Required when the definition participates in element-based hooks.
   */
  matchesElement?: (element: TElement) => boolean;
  /**
   * Matches runtime nodes for serialize/listener flows.
   * Required when the definition participates in node-based hooks.
   */
  matchesNode?: (node: Konva.Node) => boolean;
} & TElementRequireAtLeastOne<TElementElementHookBag>
  & TElementSerializeDefinition
  & TElementCreateDefinition
  & TElementNodeRuntimeDefinition
  & TElementElementRuntimeDefinition;

export interface TElementServiceHooks {
  elementsChange: SyncHook<[]>;
}
