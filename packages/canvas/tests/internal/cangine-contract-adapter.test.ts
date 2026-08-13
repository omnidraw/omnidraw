import type { TSceneNode } from '@omnidraw/cangine';
import {
  CanvasSceneNodeCodec,
  type TCanvasDocument,
} from '@omnidraw/canvas-contract';
import {
  CANVAS_CONFORMANCE_AUTHORED_NODES,
} from '@omnidraw/canvas-contract/conformance';
import { describe, expect, test } from 'vitest';
import {
  CANVAS_RUNTIME_CONTENT_LAYER_ID,
  fnCanvasContractNodeToCangine,
  fnCanvasDocumentToCangineSnapshot,
  fnCangineNodeToAuthoredCanvasContract,
  fnCangineNodeToCanvasContract,
} from '../../src/internal/cangine-contract-adapter';

describe('Cangine contract adapter', () => {
  test('exhaustively round-trips every authored Canvas node kind', () => {
    const kinds = new Set<string>();
    for (const node of CANVAS_CONFORMANCE_AUTHORED_NODES) {
      kinds.add(node.kind);
      const runtime = fnCanvasContractNodeToCangine(node);
      expect(runtime.parentId).toBe(
        node.parentId === null ? CANVAS_RUNTIME_CONTENT_LAYER_ID : node.parentId,
      );
      if (node.kind === 'widget-frame') {
        expect(runtime).toMatchObject({
          portal: { portalId: `omnidraw:widget:${node.id}` },
        });
      }
      expect(fnCangineNodeToAuthoredCanvasContract(runtime)).toEqual(
        CanvasSceneNodeCodec.decode(node),
      );
    }
    expect([...kinds].sort()).toEqual([
      'connector',
      'ellipse',
      'group',
      'image',
      'path',
      'polygon',
      'rect',
      'text',
      'widget-frame',
    ]);
  });

  test.each(['layer', 'background', 'html-portal', 'view-3d'] as const)(
    'rejects runtime-only %s nodes at serialization',
    (kind) => {
      expect(() => fnCangineNodeToCanvasContract(
        { kind } as unknown as TSceneNode,
      )).toThrow(/runtime-only|not an authored/);
    },
  );

  test('rejects malformed authored nodes and renderer widget portals', () => {
    expect(() => fnCanvasContractNodeToCangine({
      kind: 'rect',
      id: 'invalid',
    })).toThrow('Invalid Canvas scene node');

    const widget = CANVAS_CONFORMANCE_AUTHORED_NODES.find(
      (node) => node.kind === 'widget-frame',
    )!;
    expect(() => fnCangineNodeToCanvasContract(
      fnCanvasContractNodeToCangine(widget),
    )).toThrow('portal');
  });

  test('materializes a versioned renderer snapshot without serializing its layer', () => {
    const nodes = CANVAS_CONFORMANCE_AUTHORED_NODES.slice(0, 3);
    const document: TCanvasDocument = {
      schemaVersion: '1.0.0',
      canvasId: 'canvas-a',
      revision: 3,
      items: nodes.map((node, index) => ({
        id: node.id,
        item: node,
        itemRevision: index + 1,
        createdAtSec: '2026-01-01 00:00:00',
        updatedAtSec: '2026-01-01 00:00:00',
      })),
    };
    const snapshot = fnCanvasDocumentToCangineSnapshot(document);

    expect(snapshot.schemaVersion).toBe('1.0.0');
    expect(snapshot.rootLayerIds).toEqual([CANVAS_RUNTIME_CONTENT_LAYER_ID]);
    expect(snapshot.nodes[0]).toMatchObject({
      id: CANVAS_RUNTIME_CONTENT_LAYER_ID,
      kind: 'layer',
    });
    expect(snapshot.nodes.slice(1).map((node) => node.id))
      .toEqual(nodes.map((node) => node.id));
    expect(() => fnCanvasDocumentToCangineSnapshot({
      ...document,
      schemaVersion: '0.9.0',
    } as unknown as TCanvasDocument)).toThrow('schemaVersion');
  });
});
