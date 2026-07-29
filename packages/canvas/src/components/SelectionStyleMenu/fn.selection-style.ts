import type {
  TColor,
  TPaint,
  TSceneNode,
  TStrokeStyle,
} from '@omnidraw/cangine';

export type TSelectionStylePatch = Readonly<{
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
}>;

export type TSelectionStyleState = Readonly<{
  showFill: boolean;
  showStroke: boolean;
  showStrokeWidth: boolean;
  showOpacity: boolean;
  fillColor: string | null;
  strokeColor: string | null;
  strokeWidth: number | null;
  opacity: number;
}>;

function colorChannel(value: string): number {
  return Number.parseInt(value, 16) / 255;
}

function normalizedHex(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'transparent') return '#00000000';
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  if (/^#[0-9a-f]{4}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}${trimmed[4]}${trimmed[4]}`;
  }
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(trimmed)) return trimmed;
  return '#1c1917';
}

function solidColor(paint: TPaint | undefined): TColor | null {
  return paint?.type === 'solid' ? paint.color : null;
}

function fillPaint(node: TSceneNode): TPaint | undefined {
  switch (node.kind) {
    case 'rect':
    case 'ellipse':
    case 'polygon':
    case 'path':
      return node.fill;
    case 'text':
      return node.style.fill;
    default:
      return undefined;
  }
}

function strokeStyle(node: TSceneNode): TStrokeStyle | undefined {
  switch (node.kind) {
    case 'rect':
    case 'ellipse':
    case 'polygon':
    case 'path':
      return node.stroke;
    case 'text':
      return node.style.stroke;
    case 'connector':
      return node.stroke;
    default:
      return undefined;
  }
}

function supportsFill(node: TSceneNode): boolean {
  return (
    node.kind === 'rect'
    || node.kind === 'ellipse'
    || node.kind === 'polygon'
    || node.kind === 'path'
    || node.kind === 'text'
  );
}

function supportsStroke(node: TSceneNode): boolean {
  return supportsFill(node) || node.kind === 'connector';
}

function withStrokePatch(
  stroke: TStrokeStyle | undefined,
  patch: TSelectionStylePatch,
): TStrokeStyle | undefined {
  if (patch.strokeColor === undefined && patch.strokeWidth === undefined) {
    return stroke;
  }
  const fallbackColor: TColor = {
    space: 'srgb',
    r: 28 / 255,
    g: 25 / 255,
    b: 23 / 255,
    a: 1,
  };
  return {
    paint: patch.strokeColor === undefined
      ? (stroke?.paint ?? { type: 'solid', color: fallbackColor })
      : { type: 'solid', color: fnHexToCanvasColor(patch.strokeColor) },
    width: patch.strokeWidth ?? stroke?.width ?? 2,
    ...(stroke?.alignment === undefined ? {} : { alignment: stroke.alignment }),
    ...(stroke?.cap === undefined ? {} : { cap: stroke.cap }),
    ...(stroke?.join === undefined ? {} : { join: stroke.join }),
    ...(stroke?.miterLimit === undefined ? {} : { miterLimit: stroke.miterLimit }),
    ...(stroke?.dash === undefined ? {} : { dash: [...stroke.dash] }),
    ...(stroke?.dashOffset === undefined ? {} : { dashOffset: stroke.dashOffset }),
  };
}

export function fnHexToCanvasColor(value: string): TColor {
  const hex = normalizedHex(value);
  return {
    space: 'srgb',
    r: colorChannel(hex.slice(1, 3)),
    g: colorChannel(hex.slice(3, 5)),
    b: colorChannel(hex.slice(5, 7)),
    a: hex.length === 9 ? colorChannel(hex.slice(7, 9)) : 1,
  };
}

export function fnCanvasColorToCss(color: TColor | null): string | null {
  if (!color) return null;
  const red = Math.round(color.r * 255);
  const green = Math.round(color.g * 255);
  const blue = Math.round(color.b * 255);
  if (color.a >= 1) {
    return `#${[red, green, blue]
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')}`;
  }
  return `rgba(${red}, ${green}, ${blue}, ${color.a})`;
}

export function fnCanShowSelectionStyleMenu(
  nodes: readonly Readonly<TSceneNode>[],
): boolean {
  return nodes.some((node) => node.kind !== 'widget-frame');
}

export function fnSelectionStyleState(
  nodes: readonly Readonly<TSceneNode>[],
): TSelectionStyleState {
  const fillNode = nodes.find(supportsFill);
  const strokeNode = nodes.find(supportsStroke);
  const stroke = strokeNode ? strokeStyle(strokeNode) : undefined;
  return {
    showFill: Boolean(fillNode),
    showStroke: Boolean(strokeNode),
    showStrokeWidth: Boolean(strokeNode),
    showOpacity: fnCanShowSelectionStyleMenu(nodes),
    fillColor: fnCanvasColorToCss(
      fillNode ? solidColor(fillPaint(fillNode)) : null,
    ),
    strokeColor: fnCanvasColorToCss(
      stroke ? solidColor(stroke.paint) : null,
    ),
    strokeWidth: stroke?.width ?? null,
    opacity: nodes[0]?.opacity ?? 1,
  };
}

export function fnApplySelectionStyle(
  node: TSceneNode,
  patch: TSelectionStylePatch,
): TSceneNode {
  const opacity = patch.opacity === undefined
    ? node.opacity
    : Math.min(1, Math.max(0, patch.opacity));
  const base = opacity === node.opacity ? node : { ...node, opacity };
  const fill = patch.fillColor === undefined
    ? undefined
    : {
        type: 'solid' as const,
        color: fnHexToCanvasColor(patch.fillColor),
      };

  switch (base.kind) {
    case 'rect':
    case 'ellipse':
    case 'polygon':
    case 'path':
      return {
        ...base,
        ...(fill === undefined ? {} : { fill }),
        ...(supportsStroke(base)
          ? { stroke: withStrokePatch(base.stroke, patch) }
          : {}),
      };
    case 'text':
      return {
        ...base,
        style: {
          ...base.style,
          ...(fill === undefined ? {} : { fill }),
          stroke: withStrokePatch(base.style.stroke, patch),
        },
      };
    case 'connector':
      return {
        ...base,
        stroke: withStrokePatch(base.stroke, patch) ?? base.stroke,
      };
    default:
      return base;
  }
}
