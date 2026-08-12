/** @file Pure removal of retired per-instance widget resource bindings. */

import type { TJsonValue, TSceneNode } from "@omnidraw/cangine";
import { CANVAS_WIDGET_EXTENSION_KEY } from "./CONSTANTS.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function fnNormalizeLegacyCanvasWidgetBindings(
  node: TSceneNode,
): TSceneNode {
  const extension = node.extensions?.[CANVAS_WIDGET_EXTENSION_KEY];
  if (
    !isRecord(extension)
    || extension.type !== "widget-instance"
    || !("resourceBindings" in extension)
  ) return node;
  const { resourceBindings: _legacyBindings, ...normalizedExtension } = extension;
  return {
    ...node,
    extensions: {
      ...node.extensions,
      [CANVAS_WIDGET_EXTENSION_KEY]: normalizedExtension as TJsonValue,
    },
  };
}
