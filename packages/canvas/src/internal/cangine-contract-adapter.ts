import type {
  TLayerNode,
  TSceneNode as TCangineSceneNode,
  TSceneSnapshot,
  TWidgetFrameNode as TCangineWidgetFrameNode,
} from '@omnidraw/cangine';
import {
  CanvasContractDecodeError,
  CanvasDocumentCodec,
  CanvasSceneNodeCodec,
  type TCanvasDocument,
  type TCanvasSceneNode,
} from '@omnidraw/canvas-contract';

/** Renderer-owned root. It never enters a Canvas document or public API. */
export const CANVAS_RUNTIME_CONTENT_LAYER_ID = 'omnidraw:runtime:content';

const identityTransform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
} as const;

function runtimeContentLayer(): TLayerNode {
  return {
    id: CANVAS_RUNTIME_CONTENT_LAYER_ID,
    parentId: null,
    orderKey: '0',
    kind: 'layer',
    role: 'content',
    coordinateSpace: 'world',
    transform: identityTransform,
  };
}

function exhaustiveAuthoredNode(node: never): never {
  throw new TypeError(`Unsupported Canvas authored node '${String(node)}'.`);
}

function assertAuthoredDiscriminant(node: TCanvasSceneNode): void {
  switch (node.kind) {
    case 'group':
    case 'rect':
    case 'ellipse':
    case 'polygon':
    case 'path':
    case 'image':
    case 'connector':
    case 'widget-frame':
    case 'text':
      return;
    default:
      return exhaustiveAuthoredNode(node);
  }
}

/** Validates and maps one durable node into the renderer-owned hierarchy. */
export function fnCanvasContractNodeToCangine(
  value: unknown,
): TCangineSceneNode {
  const node = CanvasSceneNodeCodec.decode(value);
  assertAuthoredDiscriminant(node);
  const runtime = {
    ...node,
    parentId: node.parentId === null
      ? CANVAS_RUNTIME_CONTENT_LAYER_ID
      : node.parentId,
  } as TCangineSceneNode;
  if (runtime.kind !== 'widget-frame') return runtime;
  return {
    ...runtime,
    portal: {
      portalId: `omnidraw:widget:${runtime.id}`,
      interactive: true,
      scaleMode: 'world',
      suspendWhenOffscreen: true,
      overscan: 96,
    },
  };
}

function authoredCandidate(
  node: TCangineSceneNode,
  stripWidgetPortal: boolean,
): unknown {
  switch (node.kind) {
    case 'layer':
    case 'background':
    case 'html-portal':
      throw new TypeError(`Cangine runtime-only node '${node.kind}' cannot be serialized.`);
    case 'view-3d':
      throw new TypeError("Cangine node 'view-3d' is not an authored Canvas node.");
    case 'widget-frame': {
      if (node.portal !== undefined && !stripWidgetPortal) {
        throw new TypeError('Cangine widget portal state cannot be serialized.');
      }
      const { portal: _portal, ...authored } = node;
      return {
        ...authored,
        parentId: node.parentId === CANVAS_RUNTIME_CONTENT_LAYER_ID
          ? null
          : node.parentId,
      };
    }
    case 'group':
    case 'rect':
    case 'ellipse':
    case 'polygon':
    case 'path':
    case 'image':
    case 'connector':
    case 'text':
      return {
        ...node,
        parentId: node.parentId === CANVAS_RUNTIME_CONTENT_LAYER_ID
          ? null
          : node.parentId,
      };
  }
}

/** Strict public-boundary conversion; runtime-only state is rejected. */
export function fnCangineNodeToCanvasContract(
  node: TCangineSceneNode,
): TCanvasSceneNode {
  return CanvasSceneNodeCodec.decode(authoredCandidate(node, false));
}

/** Internal persistence projection strips only Canvas-installed portal state. */
export function fnCangineNodeToAuthoredCanvasContract(
  node: TCangineSceneNode,
  options: Readonly<{ allowPendingImageDescriptor?: boolean }> = {},
): TCanvasSceneNode {
  const candidate = authoredCandidate(node, true);
  const validation = CanvasSceneNodeCodec.decode;
  if (options.allowPendingImageDescriptor === true && node.kind === 'image') {
    const result = CanvasSceneNodeCodec.decode;
    void result;
    try {
      return validation(candidate);
    } catch (error) {
      if (
        error instanceof CanvasContractDecodeError
        && error.issues.length > 0
        && error.issues.every((issue: unknown) => (
          typeof issue === 'object'
          && issue !== null
          && 'code' in issue
          && issue.code === 'IMAGE_EXTENSION_REQUIRED'
        ))
      ) return structuredClone(candidate) as TCanvasSceneNode;
      throw error;
    }
  }
  return validation(candidate);
}

/** Maps one complete validated Canvas document to a valid Cangine snapshot. */
export function fnCanvasDocumentToCangineSnapshot(
  value: TCanvasDocument,
): TSceneSnapshot {
  const document = CanvasDocumentCodec.decode(value);
  return {
    schemaVersion: '1.0.0',
    rootLayerIds: [CANVAS_RUNTIME_CONTENT_LAYER_ID],
    nodes: [
      runtimeContentLayer(),
      ...document.items.map((entry) => fnCanvasContractNodeToCangine(entry.item)),
    ],
  };
}

/** Internal renderer helper for an already-validated list of authored nodes. */
export function fnCanvasNodesToCangineSnapshot(
  nodes: readonly TCanvasSceneNode[],
): TSceneSnapshot {
  return {
    schemaVersion: '1.0.0',
    rootLayerIds: [CANVAS_RUNTIME_CONTENT_LAYER_ID],
    nodes: [
      runtimeContentLayer(),
      ...nodes.map(fnCanvasContractNodeToCangine),
    ],
  };
}

export type TCanvasCangineWidgetFrame = TCangineWidgetFrameNode;
