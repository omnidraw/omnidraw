import {
  IDENTITY_TRANSFORM_2D,
  type TColor,
  type TConnectorMarker,
  type TConnectorNode,
  type TGroupNode,
  type TImageNode,
  type TLayerNode,
  type TPaint,
  type TPathCommand,
  type TPolygonNode,
  type TResourceDescriptor,
  type TResourceSource,
  type TSceneNode,
  type TSceneSnapshot,
  type TStrokeStyle,
  type TTextNode,
  type TTransform2D,
  type TWidgetFrameNode,
} from "@vibecanvas/canvas-engine";
import type {
  TCanvasDoc,
  TElement,
  TElementStyle,
  TPoint2D,
  TTextData,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { getStroke } from "perfect-freehand";

type TProjectedResource = {
  descriptor: TResourceDescriptor;
  source?: TResourceSource;
};

export type TProjectedCanvasDocument = {
  snapshot: TSceneSnapshot;
  resources: TProjectedResource[];
};

const STROKE_WIDTHS: Record<string, number> = {
  "@stroke-width/none": 0,
  "@stroke-width/thin": 1,
  "@stroke-width/medium": 4,
  "@stroke-width/thick": 7,
  "@stroke-width/heavy": 12,
};

const FONT_SIZES: Record<string, number> = {
  "@text/xs": 12,
  "@text/s": 14,
  "@text/m": 16,
  "@text/l": 20,
  "@text/xl": 28,
};

const CORNER_RADII: Record<string, number> = {
  "@corner-radius/none": 0,
  "@corner-radius/sm": 8,
  "@corner-radius/md": 16,
  "@corner-radius/lg": 24,
};

const FALLBACK_DARK = color(31, 41, 55);
const FALLBACK_LIGHT = color(255, 255, 255);
const FALLBACK_BLUE = color(37, 99, 235);

function color(red: number, green: number, blue: number, alpha = 1): TColor {
  return {
    space: "srgb",
    r: red / 255,
    g: green / 255,
    b: blue / 255,
    a: alpha,
  };
}

function parseHexColor(value: string | undefined, fallback: TColor): TColor {
  if (!value?.startsWith("#")) return fallback;
  const hex = value.slice(1);
  if (hex.length === 3) {
    return color(
      Number.parseInt(hex[0]! + hex[0]!, 16),
      Number.parseInt(hex[1]! + hex[1]!, 16),
      Number.parseInt(hex[2]! + hex[2]!, 16),
    );
  }
  if (hex.length === 6 || hex.length === 8) {
    return color(
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
    );
  }
  return fallback;
}

function solid(value: string | undefined, fallback: TColor): TPaint {
  return { type: "solid", color: parseHexColor(value, fallback) };
}

function resolveNumber(
  value: string | undefined,
  tokens: Record<string, number>,
  fallback: number,
): number {
  if (value && value in tokens) return tokens[value]!;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stroke(style: TElementStyle, fallbackWidth: number): TStrokeStyle | undefined {
  const width = resolveNumber(style.strokeWidth, STROKE_WIDTHS, fallbackWidth);
  if (width <= 0) return undefined;
  const dash = style.strokeStyle === "dashed"
    ? [width * 3, width * 2]
    : style.strokeStyle === "dotted" ? [width, width * 1.5] : undefined;
  return {
    paint: solid(style.strokeColor, FALLBACK_DARK),
    width,
    cap: "round",
    join: "round",
    ...(dash === undefined ? {} : { dash }),
  };
}

function transform(element: TElement): TTransform2D {
  return {
    ...IDENTITY_TRANSFORM_2D,
    position: { x: element.x, y: element.y },
    rotation: element.rotation * Math.PI / 180,
    scale: { x: element.scaleX ?? 1, y: element.scaleY ?? 1 },
  };
}

function elementRoot(element: TElement): TGroupNode {
  return {
    id: element.id,
    kind: "group",
    parentId: element.parentGroupId ?? "content",
    orderKey: element.zIndex,
    transform: transform(element),
    opacity: element.style.opacity ?? 1,
    pointerEvents: element.locked ? "none" : "auto",
    metadata: {
      "vibecanvas:element-id": element.id,
      "vibecanvas:element-type": element.data.type,
      "vibecanvas:locked": element.locked,
    },
  };
}

function childBase(element: TElement, suffix = "render") {
  return {
    id: `${element.id}::${suffix}`,
    parentId: element.id,
    orderKey: suffix === "render" ? "A" : "B",
    transform: IDENTITY_TRANSFORM_2D,
    metadata: {
      "vibecanvas:element-id": element.id,
      "vibecanvas:derived": true,
    },
  } as const;
}

function shapeTextNode(
  element: TElement,
  text: TTextData,
  width: number,
  height: number,
): TTextNode {
  return {
    ...childBase(element, "inline-text"),
    kind: "text",
    runs: [{ text: text.text }],
    style: {
      fontFamilies: [text.fontFamily],
      fontSize: resolveNumber(element.style.fontSize, FONT_SIZES, 16),
      lineHeight: resolveNumber(element.style.fontSize, FONT_SIZES, 16) * 1.2,
      fill: solid(element.style.strokeColor, FALLBACK_DARK),
    },
    layout: { type: "fixed", size: { width, height }, overflow: "clip" },
    align: element.style.textAlign ?? "center",
    verticalAlign: element.style.verticalAlign ?? "middle",
    wrap: "word",
  };
}

function catmullRomPath(points: TPoint2D[], curved: boolean): TPathCommand[] {
  const first = points[0] ?? [0, 0];
  const commands: TPathCommand[] = [{ type: "M", to: { x: first[0], y: first[1] } }];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[index + 2] ?? p2;
    if (!curved) {
      commands.push({ type: "L", to: { x: p2[0], y: p2[1] } });
      continue;
    }
    commands.push({
      type: "C",
      control1: {
        x: p1[0] + (p2[0] - p0[0]) / 6,
        y: p1[1] + (p2[1] - p0[1]) / 6,
      },
      control2: {
        x: p2[0] - (p3[0] - p1[0]) / 6,
        y: p2[1] - (p3[1] - p1[1]) / 6,
      },
      to: { x: p2[0], y: p2[1] },
    });
  }
  return commands;
}

function marker(cap: "none" | "arrow" | "dot" | "diamond"): TConnectorMarker | undefined {
  if (cap === "none") return undefined;
  return {
    shape: cap === "dot" ? "circle" : cap,
    size: 10,
    filled: true,
  };
}

function projectLine(element: TElement): TConnectorNode {
  if (element.data.type !== "line" && element.data.type !== "arrow") {
    throw new TypeError("Expected a line or arrow element.");
  }
  const points = element.data.points.length >= 2 ? element.data.points : [[0, 0], [0, 0]];
  const first = points[0]!;
  const last = points.at(-1)!;
  const lineStroke = stroke(element.style, 4) ?? {
    paint: solid(element.style.strokeColor, FALLBACK_DARK),
    width: 4,
  };
  return {
    ...childBase(element),
    kind: "connector",
    from: { type: "point", point: { x: first[0], y: first[1] } },
    to: { type: "point", point: { x: last[0], y: last[1] } },
    routing: {
      type: "manual",
      path: {
        commands: catmullRomPath(points, element.data.lineType === "curved"),
      },
    },
    stroke: lineStroke,
    ...(element.data.type === "arrow"
      ? {
          startMarker: marker(element.data.startCap),
          endMarker: marker(element.data.endCap),
        }
      : {}),
  };
}

function projectPen(element: TElement): TPolygonNode {
  if (element.data.type !== "pen") throw new TypeError("Expected a pen element.");
  const input = element.data.points.map((point, index) => [
    point[0],
    point[1],
    element.data.type === "pen" ? element.data.pressures[index] ?? 0.5 : 0.5,
  ] as [number, number, number]);
  const normalized = input.length === 1
    ? [input[0]!, [input[0]![0] + 0.5, input[0]![1] + 0.5, input[0]![2]] as [number, number, number]]
    : input;
  const outline = getStroke(normalized, {
    size: resolveNumber(element.style.strokeWidth, STROKE_WIDTHS, 7),
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.35,
    simulatePressure: element.data.simulatePressure,
    last: true,
  });
  return {
    ...childBase(element),
    kind: "polygon",
    points: outline.map((point) => ({ x: point[0]!, y: point[1]! })),
    closed: true,
    fill: solid(
      element.style.backgroundColor ?? element.style.strokeColor,
      FALLBACK_DARK,
    ),
  };
}

function projectElement(element: TElement, resources: TProjectedResource[]): TSceneNode[] {
  const root = elementRoot(element);
  const data = element.data;

  if (data.type === "rect") {
    const shapeStroke = stroke(element.style, 0);
    const nodes: TSceneNode[] = [
      root,
      {
        ...childBase(element),
        kind: "rect",
        size: { width: data.w, height: data.h },
        radius: data.radius ?? resolveNumber(element.style.cornerRadius, CORNER_RADII, 0),
        fill: solid(element.style.backgroundColor, FALLBACK_LIGHT),
        ...(shapeStroke === undefined ? {} : { stroke: shapeStroke }),
      },
    ];
    if (data.text) nodes.push(shapeTextNode(element, data.text, data.w, data.h));
    return nodes;
  }

  if (data.type === "ellipse") {
    const width = data.rx * 2;
    const height = data.ry * 2;
    const shapeStroke = stroke(element.style, 0);
    const nodes: TSceneNode[] = [
      root,
      {
        ...childBase(element),
        kind: "ellipse",
        size: { width, height },
        fill: solid(element.style.backgroundColor, FALLBACK_LIGHT),
        ...(shapeStroke === undefined ? {} : { stroke: shapeStroke }),
      },
    ];
    if (data.text) nodes.push(shapeTextNode(element, data.text, width, height));
    return nodes;
  }

  if (data.type === "diamond") {
    const shapeStroke = stroke(element.style, 0);
    const nodes: TSceneNode[] = [
      root,
      {
        ...childBase(element),
        kind: "polygon",
        points: [
          { x: data.w / 2, y: 0 },
          { x: data.w, y: data.h / 2 },
          { x: data.w / 2, y: data.h },
          { x: 0, y: data.h / 2 },
        ],
        closed: true,
        fill: solid(element.style.backgroundColor, FALLBACK_LIGHT),
        ...(shapeStroke === undefined ? {} : { stroke: shapeStroke }),
      },
    ];
    if (data.text) nodes.push(shapeTextNode(element, data.text, data.w, data.h));
    return nodes;
  }

  if (data.type === "line" || data.type === "arrow") {
    return [root, projectLine(element)];
  }

  if (data.type === "pen") {
    return [root, projectPen(element)];
  }

  if (data.type === "text") {
    const textNode: TTextNode = {
      ...childBase(element),
      kind: "text",
      runs: [{ text: data.text }],
      style: {
        fontFamilies: [data.fontFamily],
        fontSize: resolveNumber(element.style.fontSize, FONT_SIZES, 16),
        lineHeight: resolveNumber(element.style.fontSize, FONT_SIZES, 16) * 1.2,
        fill: solid(element.style.strokeColor, FALLBACK_DARK),
      },
      layout: data.autoResize
        ? { type: "auto-width", maxWidth: Math.max(data.w, 1) }
        : { type: "fixed", size: { width: data.w, height: data.h }, overflow: "clip" },
      align: element.style.textAlign ?? "left",
      verticalAlign: element.style.verticalAlign ?? "top",
      wrap: "word",
    };
    return [root, textNode];
  }

  if (data.type === "image") {
    const resourceId = `image:${element.id}`;
    const url = data.url ?? data.base64;
    resources.push({
      descriptor: {
        id: resourceId,
        type: "image",
        ...(data.url ? { url: data.url } : {}),
      },
      ...(url ? { source: { type: "url", url } } : {}),
    });
    const imageNode: TImageNode = {
      ...childBase(element),
      kind: "image",
      resourceId,
      size: { width: data.w, height: data.h },
      fit: "fill",
      crop: {
        x: data.crop.x,
        y: data.crop.y,
        width: data.crop.width,
        height: data.crop.height,
      },
    };
    return [root, imageNode];
  }

  const widgetNode: TWidgetFrameNode = {
    ...childBase(element),
    kind: "widget-frame",
    size: { width: data.w, height: data.h },
    title: data.type === "ui-widget" ? data.kind : `Widget ${data.definitionId.slice(0, 8)}`,
    controls: [
      { id: "close", kind: "close", label: "Close", side: "left" },
      { id: "minimize", kind: "minimize", label: "Minimize", side: "left" },
      { id: "maximize", kind: "maximize", label: "Maximize", side: "left" },
      { id: "menu", kind: "menu", label: "Menu", side: "right" },
    ],
    style: {
      background: { type: "solid", color: FALLBACK_LIGHT },
      border: { paint: { type: "solid", color: color(209, 213, 219) }, width: 1 },
      titleBarBackground: { type: "solid", color: color(249, 250, 251) },
      titleColor: FALLBACK_DARK,
      cornerRadius: 10,
      titleBarHeight: 32,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      activeOutline: { paint: { type: "solid", color: FALLBACK_BLUE }, width: 2 },
    },
    portal: {
      portalId: `portal:${element.id}`,
      scaleMode: "world",
      interactive: true,
      suspendWhenOffscreen: true,
    },
    collapsed: data.expanded === false,
    resizable: true,
    minSize: { width: 240, height: 80 },
  };
  return [root, widgetNode];
}

/**
 * Vertical-slice migration proof only. Theme resolution, error reporting,
 * incremental diffing, and collaboration conflict policy remain production
 * adapter work.
 */
export function pocProjectCanvasDocument(document: TCanvasDoc): TProjectedCanvasDocument {
  const backgroundLayer: TLayerNode = {
    id: "background",
    parentId: null,
    orderKey: "A",
    kind: "layer",
    role: "background",
    coordinateSpace: "world",
    transform: IDENTITY_TRANSFORM_2D,
  };
  const contentLayer: TLayerNode = {
    id: "content",
    parentId: null,
    orderKey: "B",
    kind: "layer",
    role: "content",
    coordinateSpace: "world",
    transform: IDENTITY_TRANSFORM_2D,
  };
  const nodes: TSceneNode[] = [
    backgroundLayer,
    contentLayer,
    {
      id: "grid",
      parentId: "background",
      orderKey: "A",
      kind: "background",
      transform: IDENTITY_TRANSFORM_2D,
      background: {
        type: "grid",
        minorSize: 32,
        majorEvery: 4,
        minorColor: color(229, 231, 235),
        majorColor: color(209, 213, 219),
        lineWidth: 1,
      },
    },
  ];
  const resources: TProjectedResource[] = [];

  for (const group of Object.values(document.groups)) {
    nodes.push({
      id: group.id,
      kind: "group",
      parentId: group.parentGroupId ?? "content",
      orderKey: group.zIndex,
      transform: IDENTITY_TRANSFORM_2D,
      pointerEvents: group.locked ? "none" : "auto",
      metadata: {
        "vibecanvas:group-id": group.id,
        "vibecanvas:locked": group.locked,
      },
    });
  }

  for (const element of Object.values(document.elements)) {
    nodes.push(...projectElement(element, resources));
  }

  return {
    snapshot: {
      schemaVersion: "1.0.0",
      rootLayerIds: ["background", "content"],
      nodes,
    },
    resources,
  };
}
