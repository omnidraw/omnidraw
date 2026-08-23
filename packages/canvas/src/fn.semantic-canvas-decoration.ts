/** @file Pure Cangine host-hook decoration for semantic canvas color intent. */

import type {
  TColor,
  TPaint,
  TSceneNode,
  TStrokeStyle,
} from '@omnidraw/cangine';
import type {
  TSelectionStylePropertyId,
  TStandardCreationKind,
} from '@omnidraw/cangine/editor';
import type {
  TCanvasFillColorCode,
  TCanvasInkColorCode,
  TCanvasSemanticStyleExtensionV1,
} from '@omnidraw/canvas-contract';
import {
  CANVAS_SEMANTIC_STYLE_EXTENSION_KEY,
} from '@omnidraw/canvas-contract/CONSTANTS';
import type { TThemeCanvasColorPalette } from '@omnidraw/theme';
import {
  fnIsCanvasColorCode,
  fnIsCanvasInkColorCode,
} from '@omnidraw/theme';
import type {
  TThemeBuiltinStyleScopeId,
} from '@omnidraw/theme';
import { fnCanvasSemanticStyleIntent } from './fn.semantic-canvas-style';

export type TCanvasSemanticColorMutationIntent = Readonly<{
  schemaVersion: 1;
  role: 'background' | 'ink';
  code: TCanvasFillColorCode | TCanvasInkColorCode;
}>;

type TArgsCreation = Readonly<{
  kind: TStandardCreationKind;
  node: Readonly<TSceneNode>;
  colors: TThemeCanvasColorPalette;
  background?: TCanvasFillColorCode;
  ink?: TCanvasInkColorCode;
}>;

type TArgsMutation = Readonly<{
  node: Readonly<TSceneNode>;
  propertyId: TSelectionStylePropertyId;
  intent?: unknown;
}>;

function fnColor(color: Readonly<TColor>): TColor {
  return { ...color };
}

function fnPaint(color: Readonly<TColor>): TPaint {
  return { type: 'solid', color: fnColor(color) };
}

function fnStroke(
  stroke: Readonly<TStrokeStyle>,
  color: Readonly<TColor>,
): TStrokeStyle {
  return { ...stroke, paint: fnPaint(color) };
}

function fnWithSemanticStyle(
  node: TSceneNode,
  style: TCanvasSemanticStyleExtensionV1,
): TSceneNode {
  return {
    ...node,
    extensions: {
      ...node.extensions,
      [CANVAS_SEMANTIC_STYLE_EXTENSION_KEY]: style,
    },
  };
}

function fnMutationIntent(value: unknown): TCanvasSemanticColorMutationIntent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<TCanvasSemanticColorMutationIntent>;
  if (candidate.schemaVersion !== 1) return null;
  if (candidate.role === 'background') {
    return fnIsCanvasColorCode(candidate.code)
      ? candidate as TCanvasSemanticColorMutationIntent
      : null;
  }
  if (candidate.role === 'ink') {
    return fnIsCanvasInkColorCode(candidate.code)
      ? candidate as TCanvasSemanticColorMutationIntent
      : null;
  }
  return null;
}

export function fnThemeStyleScopeForCangineCreation(
  kind: TStandardCreationKind,
): TThemeBuiltinStyleScopeId {
  if (kind === 'connector') return 'line';
  if (kind === 'widget') return 'rect';
  return kind;
}

/** Adds resolved concrete creation paint and its durable semantic fallback. */
export function fnDecorateSemanticCanvasCreation(args: TArgsCreation): TSceneNode {
  let node = structuredClone(args.node) as TSceneNode;
  let style: TCanvasSemanticStyleExtensionV1 | null = null;
  if (
    args.background !== undefined
    && (args.kind === 'rect' || args.kind === 'ellipse')
    && node.kind === args.kind
  ) {
    node = { ...node, fill: fnPaint(args.colors[args.background].fill) };
    style = { schemaVersion: 1, background: args.background };
  } else if (
    args.background !== undefined
    && args.kind === 'widget'
    && node.kind === 'widget-frame'
  ) {
    node = {
      ...node,
      titleBarColor: fnColor(args.colors[args.background].fill),
    };
    style = { schemaVersion: 1, background: args.background };
  } else if (
    args.ink !== undefined
    && args.kind === 'pen'
    && node.kind === 'path'
  ) {
    node = { ...node, fill: fnPaint(args.colors[args.ink].ink) };
    style = { schemaVersion: 1, ink: args.ink };
  } else if (
    args.ink !== undefined
    && args.kind === 'text'
    && node.kind === 'text'
  ) {
    node = {
      ...node,
      style: { ...node.style, fill: fnPaint(args.colors[args.ink].ink) },
    };
    style = { schemaVersion: 1, ink: args.ink };
  } else if (
    args.ink !== undefined
    && (args.kind === 'connector' || args.kind === 'arrow')
    && node.kind === 'connector'
  ) {
    node = { ...node, stroke: fnStroke(node.stroke, args.colors[args.ink].ink) };
    style = { schemaVersion: 1, ink: args.ink };
  }
  return style === null ? node : fnWithSemanticStyle(node, style);
}

/** Decorates Cangine's already-planned concrete selection mutation. */
export function fnDecorateSemanticCanvasStyleMutation(
  args: TArgsMutation,
): TSceneNode {
  if (args.propertyId !== 'background' && args.propertyId !== 'foreground') {
    return structuredClone(args.node) as TSceneNode;
  }
  const existing = fnCanvasSemanticStyleIntent(args.node);
  const operationIntent = fnMutationIntent(args.intent);
  const role = args.propertyId === 'background' ? 'background' : 'ink';
  const next: {
    schemaVersion: 1;
    background?: TCanvasFillColorCode;
    ink?: TCanvasInkColorCode;
  } = {
    schemaVersion: 1,
    ...(existing?.background === undefined
      ? {}
      : { background: existing.background }),
    ...(existing?.ink === undefined ? {} : { ink: existing.ink }),
  };
  if (role === 'background') {
    if (operationIntent?.role === role) {
      next.background = operationIntent.code as TCanvasFillColorCode;
    } else {
      delete next.background;
    }
  } else if (operationIntent?.role === role) {
    next.ink = operationIntent.code as TCanvasInkColorCode;
  } else {
    delete next.ink;
  }
  const node = structuredClone(args.node) as TSceneNode;
  const extensions = { ...node.extensions };
  if (next.background === undefined && next.ink === undefined) {
    delete extensions[CANVAS_SEMANTIC_STYLE_EXTENSION_KEY];
  } else {
    extensions[CANVAS_SEMANTIC_STYLE_EXTENSION_KEY] = next;
  }
  return { ...node, extensions };
}
