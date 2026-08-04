import type { TWidgetFrameNode } from '@omnidraw/cangine';
import { CANVAS_WIDGET_EXTENSION_KEY } from '@omnidraw/canvas-contract/CONSTANTS';
import type { TCanvasWidgetExtensionV1 } from '@omnidraw/canvas-contract/types';
import type {
  TWidgetRuntimeIdentity,
  TWidgetRuntimeLoadRequest,
  TWidgetRuntimeLocalTarget,
} from './interface';

export function fnWidgetRuntimeLoadRequest(args: Readonly<{
  canvasId: string;
  elementId: string;
  widgetInstanceId: string;
  widgetKey: string;
}>): TWidgetRuntimeLoadRequest {
  return {
    canvasId: args.canvasId,
    elementId: args.elementId,
    widgetInstanceId: args.widgetInstanceId,
    widgetKey: args.widgetKey,
  };
}

export function fnWidgetRuntimeIdentityMatches(
  identity: TWidgetRuntimeIdentity,
  request: TWidgetRuntimeLoadRequest,
): boolean {
  return identity.canvasId === request.canvasId
    && identity.elementId === request.elementId
    && identity.widgetInstanceId === request.widgetInstanceId
    && identity.widgetKey === request.widgetKey
    && Number.isSafeInteger(identity.catalogGeneration)
    && identity.catalogGeneration > 0;
}

export function fnWidgetRuntimeLocalTarget(args: Readonly<{
  canvasId: string;
  element: Readonly<TWidgetFrameNode>;
}>): TWidgetRuntimeLocalTarget {
  const extension = fnWidgetRuntimeWidgetExtension(args.element);
  if (extension?.type !== 'widget-instance') {
    throw new TypeError('The widget runtime requires a widget-instance node extension.');
  }
  return {
    canvasId: args.canvasId,
    elementId: args.element.id,
    widgetInstanceId: extension.instanceId,
    widgetKey: extension.widgetKey,
  };
}

export function fnWidgetRuntimeLocalTargetMatchesElement(
  target: TWidgetRuntimeLocalTarget,
  element: Readonly<TWidgetFrameNode> | undefined,
): boolean {
  const extension = element === undefined
    ? null
    : fnWidgetRuntimeWidgetExtension(element);
  return element?.id === target.elementId
    && extension?.type === 'widget-instance'
    && extension.instanceId === target.widgetInstanceId
    && extension.widgetKey === target.widgetKey;
}

export function fnWidgetRuntimeWidgetExtension(
  element: Readonly<TWidgetFrameNode>,
): TCanvasWidgetExtensionV1 | null {
  const value = element.extensions?.[CANVAS_WIDGET_EXTENSION_KEY];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (value.schemaVersion !== 1) return null;
  if (value.type === 'ui-widget' && typeof value.kind === 'string') {
    return value as TCanvasWidgetExtensionV1;
  }
  if (
    value.type === 'widget-instance'
    && typeof value.instanceId === 'string'
    && typeof value.widgetKey === 'string'
  ) {
    return value as TCanvasWidgetExtensionV1;
  }
  return null;
}
