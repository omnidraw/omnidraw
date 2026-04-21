import type Konva from "konva";
import type { SyncHook } from "@vibecanvas/tapable";
import type { KonvaEventObject, Node, NodeConfig } from "konva/lib/Node";

/**
 * Runtime mode for a registered editor tool.
 * Used to map tool choice into broad editor behavior.
 */
export type TToolMode = "select" | "hand" | "draw-create" | "click-create";

/**
 * Keyboard shortcut description for a tool.
 * Examples: `5`, `r`, `ctrl+b`.
 */
export type TToolShortcut = string;
export type TToolIcon = string;
export type TToolPointerEvent = KonvaEventObject<PointerEvent, Node<NodeConfig>>;
export type TToolCanvasPoint = {
  x: number;
  y: number;
  pressure: number;
};

export type TToolDrawCreateStartDraftArgs = {
  event: TToolPointerEvent;
  point: TToolCanvasPoint;
};

export type TToolDrawCreateUpdateDraftArgs = {
  draft: unknown;
  event: TToolPointerEvent;
  point: TToolCanvasPoint;
  origin: TToolCanvasPoint;
  shiftKey: boolean;
  now: number;
};

export type TToolDrawCreateBehavior = {
  startDraft: (args: TToolDrawCreateStartDraftArgs) => Konva.Node | null;
  updateDraft: (previewNode: Konva.Node, args: TToolDrawCreateUpdateDraftArgs) => unknown;
};

/**
 * Tool metadata registered by feature plugins.
 * Toolbar should render from this registry instead of hardcoded tool lists.
 */
export type TTool = {
  id: string;
  label: string;
  icon?: TToolIcon;
  shortcuts?: TToolShortcut[];
  group?: string; // planned for dropdown
  priority?: number;
  active?: boolean;
  onSelect?: () => void;
  behavior:
    | { type: "mode"; mode: TToolMode }
    | { type: "action" }
    | { type: "modal" };
  drawCreate?: TToolDrawCreateBehavior;
};

/**
 * Editor-local hook bag.
 * Used for tool registry and editing state changes.
 */
export interface TEditorServiceHooks {
  toolsChange: SyncHook<[]>;
  activeToolChange: SyncHook<[string]>;
  editingTextChange: SyncHook<[string | null]>;
  editingShape1dChange: SyncHook<[string | null]>;
}
