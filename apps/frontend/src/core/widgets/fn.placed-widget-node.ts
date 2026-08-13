import { CANVAS_WIDGET_EXTENSION_KEY, type TWidgetFrameNode } from "@omnidraw/canvas-contract";
import type { TWidgetPlacementRef } from "@omnidraw/sdk";
import type { TThemeSrgbColor } from "@omnidraw/theme";

/**
 * The authored Preview overflow menu is the single title-bar action surface.
 * Keeping these labels with the node projection prevents a mounted widget host
 * from publishing a second, absolutely-positioned copy over Canvas chrome.
 */
export const WIDGET_PREVIEW_ACTIONS = Object.freeze([
  { id: "reload", text: "Reload" },
  { id: "rebuild", text: "Rebuild" },
  { id: "publish", text: "Build and Publish" },
  { id: "remove", text: "Remove" },
] as const);

export type TWidgetPreviewActionId = typeof WIDGET_PREVIEW_ACTIONS[number]["id"];

/** Resolves both Canvas dropdown paths and direct title-bar action IDs. */
export function fnWidgetPreviewActionId(actionId: string): TWidgetPreviewActionId | null {
  const candidate = actionId.startsWith("preview-actions/")
    ? actionId.slice("preview-actions/".length)
    : actionId;
  return WIDGET_PREVIEW_ACTIONS.some((action) => action.id === candidate)
    ? candidate as TWidgetPreviewActionId
    : null;
}

/** Pure authored-node projection shared by click and pointer placement. */
export function fnPlacedWidgetNode(args: Readonly<{
  id: string;
  reference: TWidgetPlacementRef;
  bounds: Readonly<{ width: number; height: number }>;
  label: string;
  position: Readonly<{ x: number; y: number }>;
  instanceId: string;
  titleBarColor?: TThemeSrgbColor;
}>): TWidgetFrameNode {
  const preview = args.reference.source === "draft";
  return {
    id: args.id,
    kind: "widget-frame",
    parentId: null,
    orderKey: args.id,
    transform: {
      position: { ...args.position },
      rotation: 0,
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
    size: { ...args.bounds },
    title: preview ? `Preview: ${args.label}` : args.label,
    ...(preview && args.titleBarColor !== undefined
      ? { titleBarColor: { ...args.titleBarColor } }
      : {}),
    resizable: true,
    // Cangine reserves fixed widget chrome before admitting authored state.
    minSize: { width: 160, height: 120 },
    ...(preview ? {
      headerItems: [{
        type: "dropdown" as const,
        id: "preview-actions",
        label: "Preview actions",
        content: { type: "text" as const, text: "•••" },
        items: WIDGET_PREVIEW_ACTIONS.map((action) => ({ ...action })),
      }],
    } : {}),
    extensions: {
      [CANVAS_WIDGET_EXTENSION_KEY]: preview
        ? {
            schemaVersion: 1,
            type: "widget-preview",
            instanceId: args.instanceId,
            widgetKey: args.reference.widgetKey,
          }
        : {
            schemaVersion: 1,
            type: "widget-instance",
            instanceId: args.instanceId,
            widgetKey: args.reference.widgetKey,
          },
    },
  };
}
