import type {
  TRectNode,
  TPathNode,
  TSceneNode,
  TSceneSnapshot,
  TTextNode,
  TWidgetFrameNode,
} from '@omnidraw/cangine';
import {
  CANVAS_SEMANTIC_STYLE_EXTENSION_KEY,
} from '@omnidraw/canvas-contract';
import { BUILTIN_THEMES } from '@omnidraw/service-theme';
import { describe, expect, test } from 'vitest';
import {
  fnAuthoredSemanticCanvasNode,
  fnCanvasDeterministicRenderInput,
  fnProjectSemanticCanvasNode,
  fnProjectSemanticCanvasSnapshot,
} from '../src/fn.semantic-canvas-style';

const transform = {
  position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 }, origin: { x: 0, y: 0 },
};
const literal = { space: 'srgb' as const, r: 0.2, g: 0.3, b: 0.4, a: 1 };

function rect(semantic: boolean): TRectNode {
  return {
    id: semantic ? 'semantic' : 'literal', parentId: null, orderKey: 'A',
    kind: 'rect', transform, size: { width: 100, height: 60 },
    fill: { type: 'solid', color: literal },
    stroke: { paint: { type: 'solid', color: literal }, width: 2 },
    ...(semantic ? {
      extensions: {
        [CANVAS_SEMANTIC_STYLE_EXTENSION_KEY]: {
          schemaVersion: 1, background: 'green', ink: 'green',
        },
      },
    } : {}),
  };
}

describe('semantic canvas style projection', () => {
  test('changes semantic fill and ink by role and viewer theme', () => {
    const light = fnProjectSemanticCanvasNode({
      node: rect(true), colors: BUILTIN_THEMES[0].canvas.colors,
    }) as TRectNode;
    const dark = fnProjectSemanticCanvasNode({
      node: rect(true), colors: BUILTIN_THEMES[1].canvas.colors,
    }) as TRectNode;
    expect(light.fill).toEqual({
      type: 'solid', color: BUILTIN_THEMES[0].canvas.colors.green.fill,
    });
    expect(light.stroke?.paint).toEqual({
      type: 'solid', color: BUILTIN_THEMES[0].canvas.colors.green.ink,
    });
    expect(dark.fill).not.toEqual(light.fill);
    expect(dark.stroke?.paint).not.toEqual(light.stroke?.paint);
  });

  test('leaves literal paint stable', () => {
    expect(fnProjectSemanticCanvasNode({
      node: rect(false), colors: BUILTIN_THEMES[1].canvas.colors,
    })).toEqual(rect(false));
  });

  test('projects text ink and produces deterministic explicit-theme snapshots', () => {
    const text: TTextNode = {
      id: 'text', parentId: null, orderKey: 'A', kind: 'text', transform,
      runs: [{ text: 'Theme' }],
      style: {
        fontFamilies: ['Inter'], fontSize: 16,
        fill: { type: 'solid', color: literal },
      },
      layout: { type: 'auto-width' },
      extensions: {
        [CANVAS_SEMANTIC_STYLE_EXTENSION_KEY]: {
          schemaVersion: 1, ink: 'blue',
        },
      },
    };
    const snapshot: TSceneSnapshot = {
      schemaVersion: '1.0.0', rootLayerIds: [], nodes: [text],
    };
    const themeSnapshot = {
      revision: 7,
      themeId: BUILTIN_THEMES[2].id,
      definition: BUILTIN_THEMES[2],
    };
    const first = fnProjectSemanticCanvasSnapshot({ snapshot, themeSnapshot });
    const second = fnProjectSemanticCanvasSnapshot({ snapshot, themeSnapshot });
    expect(first).toEqual(second);
    expect((first.nodes[0] as TTextNode).style.fill).toEqual({
      type: 'solid', color: BUILTIN_THEMES[2].canvas.colors.blue.ink,
    });
    expect(fnCanvasDeterministicRenderInput({
      documentRevision: 42,
      snapshot,
      themeSnapshot,
    })).toEqual({
      documentRevision: 42,
      themeId: 'sepia',
      themeRevision: 7,
      scene: first,
    });
  });

  test('retains stored fallbacks for unrelated edits and accepts intent changes', () => {
    const authored = rect(true);
    const projected = fnProjectSemanticCanvasNode({
      node: authored,
      colors: BUILTIN_THEMES[1].canvas.colors,
    }) as TRectNode;
    const unrelatedEdit: TRectNode = { ...projected, opacity: 0.5 };
    expect(fnAuthoredSemanticCanvasNode({
      previousAuthored: authored,
      nextProjected: unrelatedEdit,
    })).toMatchObject({ fill: authored.fill, stroke: authored.stroke, opacity: 0.5 });

    const changedIntent = {
      ...projected,
      extensions: {
        ...projected.extensions,
        [CANVAS_SEMANTIC_STYLE_EXTENSION_KEY]: {
          schemaVersion: 1,
          background: 'blue',
          ink: 'red',
        },
      },
    } as TSceneNode;
    expect(fnAuthoredSemanticCanvasNode({
      previousAuthored: authored,
      nextProjected: changedIntent,
    })).toMatchObject({ fill: projected.fill, stroke: projected.stroke });
  });

  test('projects pen ink through path fill and widget background through title bar', () => {
    const pen: TPathNode = {
      id: 'pen', parentId: null, orderKey: 'A', kind: 'path', transform,
      path: { commands: [{ type: 'M', to: { x: 0, y: 0 } }] },
      fill: { type: 'solid', color: literal },
      extensions: {
        [CANVAS_SEMANTIC_STYLE_EXTENSION_KEY]: {
          schemaVersion: 1, ink: 'green',
        },
      },
    };
    const widget: TWidgetFrameNode = {
      id: 'widget', parentId: null, orderKey: 'B', kind: 'widget-frame',
      transform, size: { width: 320, height: 240 }, titleBarColor: literal,
      extensions: {
        [CANVAS_SEMANTIC_STYLE_EXTENSION_KEY]: {
          schemaVersion: 1, background: 'blue',
        },
      },
    };
    const projectedPen = fnProjectSemanticCanvasNode({
      node: pen, colors: BUILTIN_THEMES[1].canvas.colors,
    }) as TPathNode;
    const projectedWidget = fnProjectSemanticCanvasNode({
      node: widget, colors: BUILTIN_THEMES[1].canvas.colors,
    }) as TWidgetFrameNode;
    expect(projectedPen.fill).toEqual({
      type: 'solid', color: BUILTIN_THEMES[1].canvas.colors.green.ink,
    });
    expect(projectedWidget.titleBarColor)
      .toEqual(BUILTIN_THEMES[1].canvas.colors.blue.fill);
    expect(fnAuthoredSemanticCanvasNode({
      previousAuthored: pen,
      nextProjected: { ...projectedPen, opacity: 0.5 },
    })).toMatchObject({ fill: pen.fill, opacity: 0.5 });
    expect(fnAuthoredSemanticCanvasNode({
      previousAuthored: widget,
      nextProjected: { ...projectedWidget, opacity: 0.75 },
    })).toMatchObject({ titleBarColor: widget.titleBarColor, opacity: 0.75 });
  });
});
