import type { TSceneNode } from '@omnidraw/cangine';
import {
  CANVAS_SEMANTIC_STYLE_EXTENSION_KEY,
  fnValidateCanvasItems,
} from '@omnidraw/canvas-contract';
import { BUILTIN_THEMES } from '@omnidraw/service-theme';
import { describe, expect, test } from 'vitest';
import {
  fnDecorateSemanticCanvasCreation,
  fnDecorateSemanticCanvasStyleMutation,
  fnThemeStyleScopeForCangineCreation,
} from '../src/fn.semantic-canvas-decoration';

const transform = {
  position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 }, origin: { x: 0, y: 0 },
};
const literal = { space: 'srgb' as const, r: 0.1, g: 0.2, b: 0.3, a: 1 };
const colors = BUILTIN_THEMES[1]!.canvas.colors;

const nodes = {
  rect: {
    id: 'rect', parentId: null, orderKey: 'A', kind: 'rect', transform,
    size: { width: 100, height: 60 },
  },
  ellipse: {
    id: 'ellipse', parentId: null, orderKey: 'B', kind: 'ellipse', transform,
    size: { width: 100, height: 60 },
  },
  pen: {
    id: 'pen', parentId: null, orderKey: 'C', kind: 'path', transform,
    path: { commands: [{ type: 'M', to: { x: 0, y: 0 } }] },
    fill: { type: 'solid', color: literal },
    extensions: {
      'org.omnidraw.cangine.editor/freehand': { version: 2 },
    },
  },
  text: {
    id: 'text', parentId: null, orderKey: 'D', kind: 'text', transform,
    runs: [{ text: 'Theme' }],
    style: {
      fontFamilies: ['Inter'], fontSize: 16,
      fill: { type: 'solid', color: literal },
    },
    layout: { type: 'auto-width' },
  },
  connector: {
    id: 'connector', parentId: null, orderKey: 'E', kind: 'connector', transform,
    from: { type: 'point', point: { x: 0, y: 0 } },
    to: { type: 'point', point: { x: 100, y: 0 } },
    routing: { type: 'straight' },
    stroke: { paint: { type: 'solid', color: literal }, width: 2 },
  },
  arrow: {
    id: 'arrow', parentId: null, orderKey: 'F', kind: 'connector', transform,
    from: { type: 'point', point: { x: 0, y: 0 } },
    to: { type: 'point', point: { x: 100, y: 0 } },
    routing: { type: 'straight' },
    stroke: { paint: { type: 'solid', color: literal }, width: 2 },
    endMarker: { shape: 'arrow', size: 10 },
  },
  widget: {
    id: 'widget', parentId: null, orderKey: 'G', kind: 'widget-frame', transform,
    size: { width: 320, height: 240 }, title: 'Widget',
  },
} satisfies Readonly<Record<string, TSceneNode>>;

describe('semantic Cangine hook decoration', () => {
  test('maps every standard creation kind to a ThemeService style scope', () => {
    expect([
      'rect', 'ellipse', 'pen', 'text', 'connector', 'arrow', 'widget',
    ].map((kind) => fnThemeStyleScopeForCangineCreation(kind as never)))
      .toEqual(['rect', 'ellipse', 'pen', 'text', 'line', 'arrow', 'rect']);
  });

  test('decorates all seven Cangine creation kinds with concrete fallback and intent', () => {
    const creations = ([
      ['rect', nodes.rect, 'background'],
      ['ellipse', nodes.ellipse, 'background'],
      ['pen', nodes.pen, 'ink'],
      ['text', nodes.text, 'ink'],
      ['connector', nodes.connector, 'ink'],
      ['arrow', nodes.arrow, 'ink'],
      ['widget', nodes.widget, 'background'],
    ] as const).map(([kind, node, role]) => fnDecorateSemanticCanvasCreation({
      kind,
      node,
      colors,
      ...(role === 'background'
        ? { background: 'green' as const }
        : { ink: 'green' as const }),
    }));

    for (const [index, node] of creations.entries()) {
      const role = index < 2 || index === 6 ? 'background' : 'ink';
      expect(node.extensions?.[CANVAS_SEMANTIC_STYLE_EXTENSION_KEY])
        .toEqual({ schemaVersion: 1, [role]: 'green' });
      expect(fnValidateCanvasItems([node])).toEqual({ valid: true, issues: [] });
    }
    expect(creations[0]).toMatchObject({
      fill: { type: 'solid', color: colors.green.fill },
    });
    expect(creations[2]).toMatchObject({
      fill: { type: 'solid', color: colors.green.ink },
      extensions: {
        'org.omnidraw.cangine.editor/freehand': { version: 2 },
      },
    });
    expect(creations[3]).toMatchObject({
      style: { fill: { type: 'solid', color: colors.green.ink } },
    });
    expect(creations[4]).toMatchObject({
      stroke: { paint: { type: 'solid', color: colors.green.ink } },
    });
    expect(creations[6]).toMatchObject({ titleBarColor: colors.green.fill });
  });

  test('adds and removes only semantic intent around Cangine concrete mutations', () => {
    const after = {
      ...nodes.rect,
      fill: { type: 'solid' as const, color: colors.blue.fill },
      stroke: { paint: { type: 'solid' as const, color: literal }, width: 2 },
      extensions: {
        [CANVAS_SEMANTIC_STYLE_EXTENSION_KEY]: {
          schemaVersion: 1, background: 'green', ink: 'yellow',
        },
        'example:other': { retained: true },
      },
    } satisfies TSceneNode;
    const semantic = fnDecorateSemanticCanvasStyleMutation({
      node: after,
      propertyId: 'background',
      intent: { schemaVersion: 1, role: 'background', code: 'blue' },
    });
    expect(semantic).toMatchObject({
      fill: after.fill,
      extensions: {
        [CANVAS_SEMANTIC_STYLE_EXTENSION_KEY]: {
          schemaVersion: 1, background: 'blue', ink: 'yellow',
        },
        'example:other': { retained: true },
      },
    });

    const literalReplacement = fnDecorateSemanticCanvasStyleMutation({
      node: semantic,
      propertyId: 'background',
    });
    expect(literalReplacement.extensions?.[CANVAS_SEMANTIC_STYLE_EXTENSION_KEY])
      .toEqual({ schemaVersion: 1, ink: 'yellow' });
    expect(literalReplacement.extensions?.['example:other'])
      .toEqual({ retained: true });
  });
});
