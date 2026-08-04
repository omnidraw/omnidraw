import type {
  TJsonValue,
  TSceneNode,
  TWidgetFrameNode,
} from '@omnidraw/cangine';
import { CANVAS_WIDGET_EXTENSION_KEY } from '@omnidraw/canvas-contract/CONSTANTS';
import type {
  TCanvasWidgetExtensionV1,
  TCanvasWidgetResourceBindingV1,
} from '@omnidraw/canvas-contract/types';

export type TAiWidgetPayload = Readonly<{
  sessionId: string;
  model?: Readonly<{
    provider: string;
    modelId: string;
  }>;
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}>;

type TArgsNodeBase = Readonly<{
  id: string;
  parentId: string | null;
  orderKey: string;
  position: Readonly<{ x: number; y: number }>;
  size: Readonly<{ width: number; height: number }>;
  title: string;
}>;

type TArgsAiNode = TArgsNodeBase & Readonly<{
  sessionId: string;
}>;

type TArgsPublishedNode = TArgsNodeBase & Readonly<{
  instanceId: string;
  widgetKey: string;
  resourceBindings?: Readonly<Record<string, TCanvasWidgetResourceBindingV1>>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function equalJsonData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => equalJsonData(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && equalJsonData(left[key], right[key])
    ));
}

function normalizedAiWidgetPayload(
  payload: TAiWidgetPayload,
): TAiWidgetPayload {
  return {
    sessionId: payload.sessionId,
    ...(payload.model === undefined
      ? {}
      : {
          model: {
            provider: payload.model.provider,
            modelId: payload.model.modelId,
          },
        }),
    ...(payload.thinkingLevel === undefined
      ? {}
      : { thinkingLevel: payload.thinkingLevel }),
  };
}

function fnBaseWidgetNode(args: TArgsNodeBase): Omit<
  TWidgetFrameNode,
  'extensions'
> {
  return {
    id: args.id,
    kind: 'widget-frame',
    parentId: args.parentId,
    orderKey: args.orderKey,
    transform: {
      position: { ...args.position },
      rotation: 0,
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
    size: { ...args.size },
    title: args.title,
    portal: {
      portalId: fnCanvasWidgetPortalId(args.id),
      interactive: true,
      scaleMode: 'world',
      suspendWhenOffscreen: true,
      overscan: 96,
    },
    resizable: true,
    minSize: { width: 240, height: 160 },
  };
}

export function fnCanvasWidgetPortalId(nodeId: string): string {
  return `omnidraw:widget:${nodeId}`;
}

export function fnCreateAiWidgetNode(args: TArgsAiNode): TWidgetFrameNode {
  const extension: TCanvasWidgetExtensionV1 = {
    schemaVersion: 1,
    type: 'ui-widget',
    kind: 'ai',
    payload: { sessionId: args.sessionId },
  };
  return {
    ...fnBaseWidgetNode(args),
    headerItems: [{
      type: 'button',
      id: 'settings',
      label: 'Settings',
      content: { type: 'text', text: 'Settings' },
    }],
    extensions: {
      [CANVAS_WIDGET_EXTENSION_KEY]: extension,
    },
  };
}

export function fnCreatePublishedWidgetNode(
  args: TArgsPublishedNode,
): TWidgetFrameNode {
  const extension: TCanvasWidgetExtensionV1 = {
    schemaVersion: 1,
    type: 'widget-instance',
    instanceId: args.instanceId,
    widgetKey: args.widgetKey,
    ...(args.resourceBindings === undefined
      ? {}
      : { resourceBindings: args.resourceBindings }),
  };
  return {
    ...fnBaseWidgetNode(args),
    extensions: {
      [CANVAS_WIDGET_EXTENSION_KEY]: extension,
    },
  };
}

export function fnCanvasWidgetExtension(
  node: Readonly<TSceneNode> | null | undefined,
): TCanvasWidgetExtensionV1 | null {
  if (node?.kind !== 'widget-frame') return null;
  const value = node.extensions?.[CANVAS_WIDGET_EXTENSION_KEY];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (value.schemaVersion !== 1) return null;
  if (
    value.type === 'ui-widget'
    && typeof value.kind === 'string'
    && value.kind.length > 0
  ) {
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

export function fnAiWidgetPayload(
  node: Readonly<TSceneNode> | null | undefined,
): Partial<TAiWidgetPayload> | null {
  const extension = fnCanvasWidgetExtension(node);
  if (extension?.type !== 'ui-widget' || extension.kind !== 'ai') return null;
  const payload = extension.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return {};
  }
  return payload as Partial<TAiWidgetPayload>;
}

export function fnWithAiWidgetPayload(
  node: Readonly<TWidgetFrameNode>,
  payload: TAiWidgetPayload,
): TWidgetFrameNode {
  const extension = fnCanvasWidgetExtension(node);
  if (extension?.type !== 'ui-widget' || extension.kind !== 'ai') {
    throw new TypeError('AI payload can only be written to an AI widget node.');
  }
  return {
    ...node,
    extensions: {
      ...(node.extensions ?? {}),
      [CANVAS_WIDGET_EXTENSION_KEY]: {
        ...extension,
        payload: normalizedAiWidgetPayload(payload) as TJsonValue,
      },
    },
  };
}

export function fnAiWidgetPayloadEquals(
  node: Readonly<TWidgetFrameNode>,
  payload: TAiWidgetPayload,
): boolean {
  const extension = fnCanvasWidgetExtension(node);
  return extension?.type === 'ui-widget'
    && extension.kind === 'ai'
    && equalJsonData(
      extension.payload,
      normalizedAiWidgetPayload(payload),
    );
}

export function fnCanvasWidgetMountSignature(
  node: Readonly<TWidgetFrameNode>,
  catalogEpoch: Readonly<{
    global: number;
    widget: number;
  }> = { global: 0, widget: 0 },
): string {
  const extension = fnCanvasWidgetExtension(node);
  return JSON.stringify({
    extension,
    portal: node.portal,
    publishedCatalogEpoch: extension?.type === 'widget-instance'
      ? [catalogEpoch.global, catalogEpoch.widget]
      : null,
  });
}
