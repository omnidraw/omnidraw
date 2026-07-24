import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import type { SyncHook } from "@vibecanvas/tapable";
import type { TCanvasProjectionDefinition } from "../../engine/projection/typed";
import type {
  TCapStyle,
  TFontFamily,
  TLineType,
  TStrokeWidthOption,
} from "../../components/SelectionStyleMenu/types";

export type TElementNodeType = TElement["data"]["type"];

export type TElementTransformHandle =
  | "move"
  | "rotate"
  | "resize-n"
  | "resize-ne"
  | "resize-e"
  | "resize-se"
  | "resize-s"
  | "resize-sw"
  | "resize-w"
  | "resize-nw";

export type TElementTransformPolicy = {
  handles?: readonly TElementTransformHandle[];
  keepAspectRatio?: boolean;
  allowFlip?: boolean;
  allowRotate?: boolean;
  minSize?: { width: number; height: number };
  maxSize?: { width: number; height: number };
  snapRotationDegrees?: number;
};

export type TElementWidgetChromeAction = {
  id: string;
  label: string;
  kind?: "menu" | "minimize" | "maximize" | "restore" | "close" | "custom";
  disabled?: boolean;
  visible?: boolean;
};

export type TElementWidgetChrome = {
  title?: string;
  active?: boolean;
  actions?: readonly TElementWidgetChromeAction[];
};

export type TElementCloneDataArgs = {
  source: TElement;
  clone: TElement;
  createId(): string;
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
};

export type TElementElementDefinition = {
  id: string;
  priority?: number;
  matchesElement(element: TElement): boolean;
  projection?: TCanvasProjectionDefinition;
  getSelectionStyleMenu?(
    args: TElementSelectionStyleArgs,
  ): TElementSelectionStyleConfig | null | void;
  getTransformPolicy?(args: {
    element: TElement;
    selection: readonly TElement[];
  }): TElementTransformPolicy | void;
  getWidgetChrome?(args: {
    element: TElement;
  }): TElementWidgetChrome | void;
  prepareCloneData?(
    args: TElementCloneDataArgs,
  ): TElement["data"] | null | void;
  onDelete?(element: TElement): void;
  onRestore?(element: TElement): void;
};

export interface TElementServiceHooks {
  elementsChange: SyncHook<[]>;
}
