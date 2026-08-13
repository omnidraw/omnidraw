import type {
  TCanvasDocument,
  TCanvasSceneNode,
  TJsonValue,
} from "./types.js";

const transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
} as const;

const black = {
  space: "srgb",
  r: 0,
  g: 0,
  b: 0,
  a: 1,
} as const;

const white = {
  space: "srgb",
  r: 1,
  g: 1,
  b: 1,
  a: 1,
} as const;

/** One valid fixture for every authored node kind and nested serialized shape. */
export const CANVAS_CONFORMANCE_AUTHORED_NODES: TCanvasSceneNode[] = [
  {
    id: "group-a",
    parentId: null,
    orderKey: "A",
    kind: "group",
    transform,
    layout: {
      type: "stack",
      axis: "horizontal",
      gap: 8,
      padding: { top: 4, right: 4, bottom: 4, left: 4 },
      align: "center",
    },
    isolateBlend: true,
  },
  {
    id: "rect-a",
    parentId: "group-a",
    orderKey: "A",
    kind: "rect",
    transform,
    size: { width: 100, height: 60 },
    radius: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 },
    fill: { type: "solid", color: white },
    stroke: { paint: { type: "solid", color: black }, width: 2 },
    extensions: {
      "omnidraw:style": { schemaVersion: 1, background: "neutral", ink: "blue" },
    },
  },
  {
    id: "ellipse-a",
    parentId: null,
    orderKey: "B",
    kind: "ellipse",
    transform,
    size: { width: 80, height: 80 },
    fill: {
      type: "radial-gradient",
      center: { x: 40, y: 40 },
      radius: 40,
      stops: [
        { offset: 0, color: white },
        { offset: 1, color: black },
      ],
    },
    clip: { type: "node", nodeId: "rect-a" },
  },
  {
    id: "polygon-a",
    parentId: null,
    orderKey: "C",
    kind: "polygon",
    transform,
    points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 40, y: 60 }],
    closed: true,
    fill: {
      type: "linear-gradient",
      from: { x: 0, y: 0 },
      to: { x: 80, y: 60 },
      stops: [
        { offset: 0, color: black },
        { offset: 1, color: white },
      ],
      space: "local",
    },
  },
  {
    id: "path-a",
    parentId: null,
    orderKey: "D",
    kind: "path",
    transform,
    path: {
      commands: [
        { type: "M", to: { x: 0, y: 0 } },
        { type: "L", to: { x: 10, y: 10 } },
        { type: "Q", control: { x: 15, y: 0 }, to: { x: 20, y: 10 } },
        { type: "C", control1: { x: 25, y: 0 }, control2: { x: 30, y: 20 }, to: { x: 35, y: 10 } },
        { type: "A", radius: { x: 4, y: 4 }, xAxisRotation: 0, largeArc: false, sweep: true, to: { x: 40, y: 10 } },
        { type: "Z" },
      ],
      fillRule: "evenodd",
    },
    stroke: { paint: { type: "solid", color: black }, width: 1, dash: [3, 2] },
    extensions: {
      "omnidraw:authoring": {
        schemaVersion: 1,
        locked: false,
        penSource: {
          points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
          pressures: [0.25, 0.75],
          simulatePressure: false,
        },
      },
    },
  },
  {
    id: "image-a",
    parentId: null,
    orderKey: "E",
    kind: "image",
    transform,
    resourceId: "resource-image-a",
    size: { width: 640, height: 480 },
    fit: "cover",
    crop: { x: 0, y: 0, width: 640, height: 480 },
    extensions: {
      "omnidraw:image": {
        schemaVersion: 1,
        url: "https://example.invalid/image.png",
        mimeType: "image/png",
      },
    },
  },
  {
    id: "connector-a",
    parentId: null,
    orderKey: "F",
    kind: "connector",
    transform,
    from: { type: "node", nodeId: "rect-a", anchor: "right", gap: 4 },
    to: { type: "node", nodeId: "ellipse-a", anchor: { name: "input" } },
    routing: { type: "orthogonal", cornerRadius: 6, preferredAxis: "horizontal" },
    waypoints: [{ x: 120, y: 20 }],
    stroke: { paint: { type: "solid", color: black }, width: 2 },
    endMarker: { shape: "arrow", size: 8, filled: true },
    avoidNodeIds: ["polygon-a"],
    labelNodeId: "text-a",
  },
  {
    id: "widget-a",
    parentId: null,
    orderKey: "G",
    kind: "widget-frame",
    transform,
    size: { width: 320, height: 240 },
    title: "Counter",
    titleBarColor: black,
    headerItems: [{
      type: "dropdown",
      id: "menu",
      label: "Menu",
      content: { type: "text", text: "Menu" },
      items: [{ id: "reset", text: "Reset" }],
    }],
    resizable: true,
    minSize: { width: 160, height: 120 },
    extensions: {
      "omnidraw:widget": {
        schemaVersion: 1,
        type: "widget-instance",
        instanceId: "instance-a",
        widgetKey: "counter",
        uiProps: { start: 1 },
      },
    },
  },
  {
    id: "text-a",
    parentId: null,
    orderKey: "H",
    kind: "text",
    transform,
    runs: [{ text: "Label", style: { fontWeight: 700 } }],
    style: {
      fontFamilies: ["Inter", "sans-serif"],
      fontSize: 16,
      fill: { type: "solid", color: black },
    },
    layout: { type: "auto-height", width: 120 },
    align: "center",
  },
];

export const CANVAS_CONFORMANCE_DOCUMENT: TCanvasDocument = {
  schemaVersion: "1.0.0",
  canvasId: "canvas-conformance",
  revision: 9,
  items: CANVAS_CONFORMANCE_AUTHORED_NODES.map((item, index) => ({
    id: item.id,
    item,
    itemRevision: index + 1,
    createdAtSec: "2026-01-01 00:00:00",
    updatedAtSec: "2026-01-01 00:00:00",
  })),
};

export type TCanvasInvalidConformanceVector = Readonly<{
  name: string;
  value: unknown;
  expectedIssueCode: string;
}>;

/** Invalid boundary vectors shared by adapters and implementations. */
export const CANVAS_CONFORMANCE_INVALID_DOCUMENTS: readonly TCanvasInvalidConformanceVector[] = [
  {
    name: "unknown-document-version",
    value: { ...CANVAS_CONFORMANCE_DOCUMENT, schemaVersion: "0.6.0" },
    expectedIssueCode: "UNSUPPORTED_SCHEMA_VERSION",
  },
  ...["layer", "background", "html-portal"].map((kind) => ({
    name: `runtime-only-${kind}`,
    value: {
      ...CANVAS_CONFORMANCE_DOCUMENT,
      items: [{
        id: `runtime-${kind}`,
        itemRevision: 1,
        createdAtSec: "2026-01-01 00:00:00",
        updatedAtSec: "2026-01-01 00:00:00",
        item: { id: `runtime-${kind}`, parentId: null, orderKey: "A", kind, transform },
      }],
    },
    expectedIssueCode: "RUNTIME_ONLY_NODE_KIND",
  })),
  {
    name: "unsupported-view-3d",
    value: {
      ...CANVAS_CONFORMANCE_DOCUMENT,
      items: [{
        id: "view",
        itemRevision: 1,
        createdAtSec: "2026-01-01 00:00:00",
        updatedAtSec: "2026-01-01 00:00:00",
        item: { id: "view", parentId: null, orderKey: "A", kind: "view-3d", transform, size: { width: 10, height: 10 }, sceneId: "scene", cameraId: "camera" },
      }],
    },
    expectedIssueCode: "UNSUPPORTED_AUTHORED_NODE_KIND",
  },
  {
    name: "runtime-widget-portal",
    value: {
      ...CANVAS_CONFORMANCE_DOCUMENT,
      items: [{
        ...CANVAS_CONFORMANCE_DOCUMENT.items[7],
        item: { ...CANVAS_CONFORMANCE_AUTHORED_NODES[7], portal: { portalId: "runtime" } },
      }],
    },
    expectedIssueCode: "UNEXPECTED_FIELD",
  },
  {
    name: "legacy-widget-bindings",
    value: {
      ...CANVAS_CONFORMANCE_DOCUMENT,
      items: [{
        ...CANVAS_CONFORMANCE_DOCUMENT.items[7],
        item: {
          ...CANVAS_CONFORMANCE_AUTHORED_NODES[7],
          extensions: {
            "omnidraw:widget": {
              schemaVersion: 1,
              type: "widget-instance",
              instanceId: "instance-a",
              widgetKey: "counter",
              resourceBindings: {},
            },
          },
        },
      }],
    },
    expectedIssueCode: "UNEXPECTED_FIELD",
  },
  {
    name: "non-finite-geometry",
    value: {
      ...CANVAS_CONFORMANCE_DOCUMENT,
      items: [{
        ...CANVAS_CONFORMANCE_DOCUMENT.items[1],
        item: { ...CANVAS_CONFORMANCE_AUTHORED_NODES[1], size: { width: Number.NaN, height: 10 } },
      }],
    },
    expectedIssueCode: "NON_FINITE_NUMBER",
  },
  {
    name: "missing-image-descriptor",
    value: {
      ...CANVAS_CONFORMANCE_DOCUMENT,
      items: [{
        ...CANVAS_CONFORMANCE_DOCUMENT.items[5],
        item: { ...CANVAS_CONFORMANCE_AUTHORED_NODES[5], extensions: {} },
      }],
    },
    expectedIssueCode: "IMAGE_EXTENSION_REQUIRED",
  },
];

export type TCanvasCanonicalConformanceVector = Readonly<{
  name: string;
  value: TJsonValue;
  canonical: string;
}>;

export const CANVAS_CONFORMANCE_CANONICAL_JSON: readonly TCanvasCanonicalConformanceVector[] = [
  {
    name: "recursive-key-order-and-negative-zero",
    value: { z: -0, a: { y: 2, x: 1 }, list: [{ b: true, a: null }] },
    canonical: "{\"a\":{\"x\":1,\"y\":2},\"list\":[{\"a\":null,\"b\":true}],\"z\":0}",
  },
  {
    name: "unicode-and-array-order",
    value: { omega: "Ω", array: [3, 2, 1] },
    canonical: "{\"array\":[3,2,1],\"omega\":\"Ω\"}",
  },
];
