/** @file Pure projection of semantic canvas intent to concrete Cangine paint. */

import type {
  TColor,
  TPaint,
  TSceneNode,
  TSceneSnapshot,
  TStrokeStyle,
} from '@omnidraw/cangine';
import type {
  TCanvasSemanticStyleExtensionV1,
} from '@omnidraw/canvas-contract';
import {
  CANVAS_SEMANTIC_STYLE_EXTENSION_KEY,
} from '@omnidraw/canvas-contract/CONSTANTS';
import {
  fnIsCanvasColorCode,
  fnIsCanvasInkColorCode,
} from '@omnidraw/theme-contract/fn.validation';
import type {
  TThemeCanvasColorPalette,
  TThemeSnapshot,
  TThemeSrgbColor,
} from '@omnidraw/theme-contract';

type TArgsNode = Readonly<{
  node: TSceneNode;
  colors: TThemeCanvasColorPalette;
}>;

type TArgsSnapshot = Readonly<{
  snapshot: TSceneSnapshot;
  themeSnapshot: TThemeSnapshot;
}>;

type TArgsAuthoredNode = Readonly<{
  previousAuthored: TSceneNode | null;
  nextProjected: TSceneNode | null;
}>;

export type TCanvasDeterministicRenderInput = Readonly<{
  documentRevision: number;
  themeId: string;
  themeRevision: number;
  scene: TSceneSnapshot;
}>;

function fnColor(value: TThemeSrgbColor): TColor {
  return { ...value };
}

function fnSolid(value: TThemeSrgbColor): TPaint {
  return { type: 'solid', color: fnColor(value) };
}

function fnStroke(stroke: TStrokeStyle, value: TThemeSrgbColor): TStrokeStyle {
  return { ...stroke, paint: fnSolid(value) };
}

export function fnCanvasSemanticStyleIntent(
  node: Readonly<TSceneNode>,
): TCanvasSemanticStyleExtensionV1 | null {
  const candidate = node.extensions?.[CANVAS_SEMANTIC_STYLE_EXTENSION_KEY];
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return null;
  }
  const background = candidate.background;
  const ink = candidate.ink;
  if (
    candidate.schemaVersion !== 1
    || (background === undefined && ink === undefined)
    || (background !== undefined && !fnIsCanvasColorCode(background))
    || (ink !== undefined && !fnIsCanvasInkColorCode(ink))
  ) return null;
  return candidate as unknown as TCanvasSemanticStyleExtensionV1;
}

export function fnProjectSemanticCanvasNode(args: TArgsNode): TSceneNode {
  const intent = fnCanvasSemanticStyleIntent(args.node);
  if (intent === null) return structuredClone(args.node);
  let node = structuredClone(args.node);
  if (intent.background !== undefined) {
    const fill = fnSolid(args.colors[intent.background].fill);
    if (
      node.kind === 'rect'
      || node.kind === 'ellipse'
      || node.kind === 'polygon'
      || node.kind === 'path'
    ) node = { ...node, fill };
    else if (node.kind === 'widget-frame') {
      node = { ...node, titleBarColor: fnColor(args.colors[intent.background].fill) };
    }
  }
  if (intent.ink !== undefined) {
    const ink = args.colors[intent.ink].ink;
    if (node.kind === 'text') {
      node = { ...node, style: { ...node.style, fill: fnSolid(ink) } };
    } else if (node.kind === 'connector') {
      node = { ...node, stroke: fnStroke(node.stroke, ink) };
    } else if (
      node.kind === 'path'
      && node.stroke === undefined
      && node.fill !== undefined
    ) {
      node = { ...node, fill: fnSolid(ink) };
    } else if (
      (node.kind === 'rect'
        || node.kind === 'ellipse'
        || node.kind === 'polygon'
        || node.kind === 'path')
      && node.stroke !== undefined
    ) {
      node = { ...node, stroke: fnStroke(node.stroke, ink) };
    }
  }
  return node;
}

/**
 * Converts an editor-produced projected node back to its authored form.
 * Unchanged semantic roles retain their existing concrete fallback; changing
 * or removing the semantic code accepts the editor's new concrete paint.
 */
export function fnAuthoredSemanticCanvasNode(
  args: TArgsAuthoredNode,
): TSceneNode | null {
  if (args.nextProjected === null) return null;
  const nextIntent = fnCanvasSemanticStyleIntent(args.nextProjected);
  const previousIntent = args.previousAuthored === null
    ? null
    : fnCanvasSemanticStyleIntent(args.previousAuthored);
  let node = structuredClone(args.nextProjected);
  if (
    args.previousAuthored !== null
    && nextIntent?.background !== undefined
    && nextIntent.background === previousIntent?.background
    && (node.kind === 'rect'
      || node.kind === 'ellipse'
      || node.kind === 'polygon'
      || node.kind === 'path'
      || node.kind === 'widget-frame')
    && (args.previousAuthored.kind === 'rect'
      || args.previousAuthored.kind === 'ellipse'
      || args.previousAuthored.kind === 'polygon'
      || args.previousAuthored.kind === 'path'
      || args.previousAuthored.kind === 'widget-frame')
  ) {
    if (node.kind === 'widget-frame' && args.previousAuthored.kind === 'widget-frame') {
      node = {
        ...node,
        titleBarColor: structuredClone(args.previousAuthored.titleBarColor),
      };
    } else if (node.kind !== 'widget-frame' && args.previousAuthored.kind !== 'widget-frame') {
      node = { ...node, fill: structuredClone(args.previousAuthored.fill) };
    }
  }
  if (
    args.previousAuthored !== null
    && nextIntent?.ink !== undefined
    && nextIntent.ink === previousIntent?.ink
  ) {
    if (node.kind === 'text' && args.previousAuthored.kind === 'text') {
      node = {
        ...node,
        style: {
          ...node.style,
          fill: structuredClone(args.previousAuthored.style.fill),
        },
      };
    } else if (
      node.kind === 'connector'
      && args.previousAuthored.kind === 'connector'
    ) {
      node = {
        ...node,
        stroke: {
          ...node.stroke,
          paint: structuredClone(args.previousAuthored.stroke.paint),
        },
      };
    } else if (
      node.kind === 'path'
      && args.previousAuthored.kind === 'path'
      && node.stroke === undefined
      && args.previousAuthored.stroke === undefined
      && node.fill !== undefined
      && args.previousAuthored.fill !== undefined
    ) {
      node = { ...node, fill: structuredClone(args.previousAuthored.fill) };
    } else if (
      (node.kind === 'rect'
        || node.kind === 'ellipse'
        || node.kind === 'polygon'
        || node.kind === 'path')
      && (args.previousAuthored.kind === 'rect'
        || args.previousAuthored.kind === 'ellipse'
        || args.previousAuthored.kind === 'polygon'
        || args.previousAuthored.kind === 'path')
      && node.stroke !== undefined
      && args.previousAuthored.stroke !== undefined
    ) {
      node = {
        ...node,
        stroke: {
          ...node.stroke,
          paint: structuredClone(args.previousAuthored.stroke.paint),
        },
      };
    }
  }
  return node;
}

/** Deterministic export/render input for one explicit theme snapshot. */
export function fnProjectSemanticCanvasSnapshot(
  args: TArgsSnapshot,
): TSceneSnapshot {
  return {
    ...structuredClone(args.snapshot),
    nodes: args.snapshot.nodes.map((node) => fnProjectSemanticCanvasNode({
      node,
      colors: args.themeSnapshot.definition.canvas.colors,
    })),
  };
}

/** Binds one document revision to one immutable theme generation for export. */
export function fnCanvasDeterministicRenderInput(args: Readonly<{
  documentRevision: number;
  snapshot: TSceneSnapshot;
  themeSnapshot: TThemeSnapshot;
}>): TCanvasDeterministicRenderInput {
  return Object.freeze({
    documentRevision: args.documentRevision,
    themeId: args.themeSnapshot.themeId,
    themeRevision: args.themeSnapshot.revision,
    scene: fnProjectSemanticCanvasSnapshot({
      snapshot: args.snapshot,
      themeSnapshot: args.themeSnapshot,
    }),
  });
}
