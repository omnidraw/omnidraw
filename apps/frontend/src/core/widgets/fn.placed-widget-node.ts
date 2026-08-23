import {
  CANVAS_WIDGET_EXTENSION_KEY,
  fnReadCanvasWidgetExtension,
  type TWidgetFrameNode,
} from "@omnidraw/canvas-contract";
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
  { id: "replace-with-published", text: "Replace with published widget" },
  { id: "remove", text: "Remove" },
] as const);

const WIDGET_PREVIEW_REPLACEMENT_ACTION_ID = "replace-with-published";

export const WIDGET_PREVIEW_DEFAULT_BOUNDS = Object.freeze({ width: 360, height: 320 });

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

function previewActions(replacementAvailable: boolean) {
  return WIDGET_PREVIEW_ACTIONS
    .filter((action) => replacementAvailable || action.id !== WIDGET_PREVIEW_REPLACEMENT_ACTION_ID)
    .map((action) => ({ ...action }));
}

export function fnWidgetPreviewHeaderItems(replacementAvailable: boolean): NonNullable<TWidgetFrameNode["headerItems"]> {
  return [{
    type: "dropdown",
    id: "preview-actions",
    label: "Preview actions",
    content: { type: "text", text: "•••" },
    items: previewActions(replacementAvailable),
  }];
}

/** Keeps the persisted Preview menu aligned with current publication health. */
export function fnWidgetPreviewWithPublishedActionAvailability(
  node: Readonly<TWidgetFrameNode>,
  replacementAvailable: boolean,
): TWidgetFrameNode {
  return {
    ...node,
    headerItems: [
      ...(node.headerItems ?? []).filter((item) => item.id !== "preview-actions"),
      ...fnWidgetPreviewHeaderItems(replacementAvailable),
    ],
  };
}

/** Pure, codec-safe projection from one authored Preview frame to a publication-following frame. */
export function fnReplacePreviewWithPublishedWidget(args: Readonly<{
  node: Readonly<TWidgetFrameNode>;
  widgetKey: string;
  instanceId: string;
  publishedTitle: string;
}>): TWidgetFrameNode {
  const preview = fnReadCanvasWidgetExtension(args.node);
  if (
    preview?.type !== "widget-preview"
    || preview.widgetKey !== args.widgetKey
  ) {
    throw new RangeError("Preview replacement requires the matching widget-preview extension.");
  }
  const {
    titleBarColor: _previewTitleBarColor,
    headerItems,
    ...frame
  } = args.node;
  return {
    ...frame,
    title: args.publishedTitle,
    ...(headerItems === undefined
      ? {}
      : {
          headerItems: headerItems.filter((item) => item.id !== "preview-actions"),
        }),
    extensions: {
      ...(args.node.extensions ?? {}),
      [CANVAS_WIDGET_EXTENSION_KEY]: {
        schemaVersion: 1,
        type: "widget-instance",
        instanceId: args.instanceId,
        widgetKey: args.widgetKey,
        ...(preview.uiProps === undefined ? {} : { uiProps: preview.uiProps }),
      },
    },
  };
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
}>): Omit<TWidgetFrameNode, "orderKey"> {
  const preview = args.reference.source === "draft";
  return {
    id: args.id,
    kind: "widget-frame",
    parentId: null,
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
    ...(preview ? { headerItems: fnWidgetPreviewHeaderItems(false) } : {}),
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
