import { describe, expect, test } from "bun:test";
import {
  CANVAS_IMAGE_EXTENSION_KEY,
  CANVAS_SCENE_SCHEMA_VERSION,
  CANVAS_WIDGET_EXTENSION_KEY,
  CanvasCommandCodec,
  CanvasContractDecodeError,
  CanvasDocumentCodec,
  CanvasDocumentSchema,
  CanvasEventCodec,
  CanvasItemPageCodec,
  CanvasQueryCodec,
  CanvasSceneNodeCodec,
  fnCanonicalCanvasJson,
  fnReadCanvasWidgetExtension,
  fnStringifyCanonicalCanvasJson,
  fnValidateCanvasCommand,
  fnValidateCanvasDocument,
  fnValidateCanvasEvent,
  fnValidateCanvasItemPage,
  fnValidateCanvasItems,
  fnValidateCanvasQuery,
  fnValidateCanvasSceneNode,
} from "../src/index.js";
import {
  CANVAS_CONFORMANCE_AUTHORED_NODES,
  CANVAS_CONFORMANCE_CANONICAL_JSON,
  CANVAS_CONFORMANCE_DOCUMENT,
  CANVAS_CONFORMANCE_INVALID_DOCUMENTS,
} from "../src/conformance.js";
import type {
  TCanvasCommand,
  TCanvasEvent,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasSceneNode,
} from "../src/types.js";

const transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

function rect(id: string, parentId: string | null = null): TCanvasSceneNode {
  return {
    id,
    parentId,
    orderKey: "A",
    kind: "rect",
    transform,
    size: { width: 100, height: 60 },
  };
}

describe("authored Canvas document", () => {
  test("owns and validates every authored node kind", () => {
    expect(CANVAS_CONFORMANCE_AUTHORED_NODES.map((node) => node.kind)).toEqual([
      "group",
      "rect",
      "ellipse",
      "polygon",
      "path",
      "image",
      "connector",
      "widget-frame",
      "text",
    ]);
    for (const node of CANVAS_CONFORMANCE_AUTHORED_NODES) {
      expect(fnValidateCanvasSceneNode(node)).toEqual({ valid: true, issues: [] });
    }
    expect(fnValidateCanvasDocument(CANVAS_CONFORMANCE_DOCUMENT)).toEqual({
      valid: true,
      issues: [],
    });
    expect(CanvasDocumentSchema.is(CANVAS_CONFORMANCE_DOCUMENT)).toBe(true);
  });

  test("requires the clean-install document schema version", () => {
    expect(CANVAS_SCENE_SCHEMA_VERSION).toBe("1.0.0");
    expect(CANVAS_CONFORMANCE_DOCUMENT.schemaVersion).toBe("1.0.0");
    const missing = { ...CANVAS_CONFORMANCE_DOCUMENT } as Record<string, unknown>;
    delete missing.schemaVersion;
    expect(fnValidateCanvasDocument(missing).issues).toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA_VERSION", path: "/schemaVersion" }),
    );
  });

  test("rejects every shared invalid conformance vector deterministically", () => {
    for (const vector of CANVAS_CONFORMANCE_INVALID_DOCUMENTS) {
      const first = fnValidateCanvasDocument(vector.value);
      const second = fnValidateCanvasDocument(vector.value);
      expect(first, vector.name).toEqual(second);
      expect(first.valid, vector.name).toBe(false);
      expect(first.issues.map((issue) => issue.code), vector.name)
        .toContain(vector.expectedIssueCode);
    }
  });

  test("rejects runtime-only and unsupported renderer node kinds", () => {
    for (const kind of ["layer", "background", "html-portal"]) {
      expect(fnValidateCanvasSceneNode({
        id: kind,
        parentId: null,
        orderKey: "A",
        kind,
        transform,
      }).issues).toContainEqual(expect.objectContaining({
        code: "RUNTIME_ONLY_NODE_KIND",
        path: "/kind",
      }));
    }
    expect(fnValidateCanvasSceneNode({
      id: "view",
      parentId: null,
      orderKey: "A",
      kind: "view-3d",
      transform,
      size: { width: 10, height: 10 },
      sceneId: "scene",
      cameraId: "camera",
    }).issues).toContainEqual(expect.objectContaining({
      code: "UNSUPPORTED_AUTHORED_NODE_KIND",
    }));
  });

  test("strictly rejects unknown fields and malformed primitive data", () => {
    expect(fnValidateCanvasSceneNode({ ...rect("a"), rendererCache: true }).issues)
      .toContainEqual(expect.objectContaining({
        code: "UNEXPECTED_FIELD",
        path: "/rendererCache",
      }));
    expect(fnValidateCanvasSceneNode({ ...rect("a"), opacity: 1.1 }).issues)
      .toContainEqual(expect.objectContaining({ code: "NUMBER_TOO_LARGE" }));
    expect(fnValidateCanvasSceneNode({
      ...rect("a"),
      transform: { ...transform, rotation: Number.POSITIVE_INFINITY },
    }).issues).toContainEqual(expect.objectContaining({ code: "NON_FINITE_NUMBER" }));
    expect(fnValidateCanvasSceneNode({ ...rect("a"), size: { width: -1, height: 2 } }).valid)
      .toBe(false);
    expect(fnValidateCanvasSceneNode({ ...rect("a"), parentId: undefined }).valid)
      .toBe(false);
  });

  test("rejects duplicate IDs, missing parents, cycles, and missing references", () => {
    expect(fnValidateCanvasItems([rect("same"), rect("same")]).issues)
      .toContainEqual(expect.objectContaining({ code: "DUPLICATE_ITEM_ID" }));
    expect(fnValidateCanvasItems([rect("orphan", "missing")]).issues)
      .toContainEqual(expect.objectContaining({ code: "PARENT_NOT_FOUND" }));
    expect(fnValidateCanvasItems([rect("a", "b"), rect("b", "a")]).issues)
      .toContainEqual(expect.objectContaining({ code: "HIERARCHY_CYCLE" }));
    expect(fnValidateCanvasItems([{
      ...rect("clipped"),
      clip: { type: "node", nodeId: "missing" },
    }]).issues).toContainEqual(expect.objectContaining({ code: "NODE_REFERENCE_NOT_FOUND" }));
  });

  test("rejects legacy widget bindings instead of normalizing them", () => {
    const widget = {
      ...CANVAS_CONFORMANCE_AUTHORED_NODES.find((node) => node.kind === "widget-frame")!,
      extensions: {
        [CANVAS_WIDGET_EXTENSION_KEY]: {
          schemaVersion: 1,
          type: "widget-instance",
          instanceId: "instance-a",
          widgetKey: "counter",
          resourceBindings: {},
        },
      },
    } as TCanvasSceneNode;
    const result = fnValidateCanvasSceneNode(widget);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "UNEXPECTED_FIELD",
      path: `/extensions/${CANVAS_WIDGET_EXTENSION_KEY}/resourceBindings`,
    }));
    expect(fnReadCanvasWidgetExtension(widget)).toBeNull();
  });

  test("requires durable image descriptors and rejects descriptor conflicts", () => {
    const image = CANVAS_CONFORMANCE_AUTHORED_NODES.find((node) => node.kind === "image")!;
    expect(fnValidateCanvasSceneNode({ ...image, extensions: {} }).issues)
      .toContainEqual(expect.objectContaining({ code: "IMAGE_EXTENSION_REQUIRED" }));
    expect(fnValidateCanvasItems([
      image,
      {
        ...image,
        id: "image-b",
        extensions: {
          [CANVAS_IMAGE_EXTENSION_KEY]: {
            schemaVersion: 1,
            url: "https://example.invalid/other.png",
            mimeType: "image/png",
          },
        },
      },
    ]).issues).toContainEqual(expect.objectContaining({
      code: "IMAGE_RESOURCE_DESCRIPTOR_CONFLICT",
    }));
  });
});

describe("strict codecs and canonical JSON", () => {
  test("canonicalizes object keys recursively and preserves array order", () => {
    for (const vector of CANVAS_CONFORMANCE_CANONICAL_JSON) {
      expect(fnStringifyCanonicalCanvasJson(vector.value), vector.name)
        .toBe(vector.canonical);
    }
    expect(fnCanonicalCanvasJson({ b: 1, a: -0 })).toEqual({ a: 0, b: 1 });
  });

  test("document codec is stable, detached, and rejects malformed input", () => {
    const canonical = CanvasDocumentCodec.stringify(CANVAS_CONFORMANCE_DOCUMENT);
    expect(CanvasDocumentCodec.stringify(CanvasDocumentCodec.parse(canonical))).toBe(canonical);
    const decoded = CanvasDocumentCodec.decode(CANVAS_CONFORMANCE_DOCUMENT);
    expect(decoded).toEqual(CANVAS_CONFORMANCE_DOCUMENT);
    expect(decoded).not.toBe(CANVAS_CONFORMANCE_DOCUMENT);
    expect(() => CanvasDocumentCodec.decode({
      ...CANVAS_CONFORMANCE_DOCUMENT,
      schemaVersion: "2.0.0",
    })).toThrow(CanvasContractDecodeError);
    expect(() => CanvasDocumentCodec.parse("{"))
      .toThrow(CanvasContractDecodeError);
  });

  test("canonical JSON rejects cycles, sparse arrays, nonfinite values, and class objects", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse = Array(1);
    class Example { value = 1; }
    expect(() => fnCanonicalCanvasJson(cyclic)).toThrow("Cyclic value");
    expect(() => fnCanonicalCanvasJson(sparse)).toThrow("Sparse array");
    expect(() => fnCanonicalCanvasJson(Number.NaN)).toThrow("Non-finite number");
    expect(() => fnCanonicalCanvasJson(new Example())).toThrow("Non-plain object");
  });

  test("scene-node codec round-trips all authored kinds", () => {
    for (const node of CANVAS_CONFORMANCE_AUTHORED_NODES) {
      const text = CanvasSceneNodeCodec.stringify(node);
      expect(CanvasSceneNodeCodec.parse(text)).toEqual(node);
    }
  });
});

describe("commands, queries, pages, and events", () => {
  const command: TCanvasCommand = {
    commandId: "command-a",
    canvasId: "canvas-a",
    baseRevision: 0,
    operations: [{ type: "insert", item: rect("rect-a") }],
    preconditions: [{ type: "item-absent", itemId: "rect-a" }],
  };
  const query: TCanvasItemQuery = {
    canvasId: "canvas-a",
    filter: { type: "parent", parentId: null },
    limit: 25,
    cursor: { type: "parent-order", orderKey: "A", id: "rect-a" },
  };
  const page: TCanvasItemPage = {
    items: [CANVAS_CONFORMANCE_DOCUMENT.items[0]!],
    nextCursor: { type: "id", id: "group-a" },
  };
  const event: TCanvasEvent = {
    type: "items-changed",
    canvasId: "canvas-a",
    commandId: "command-a",
    revision: 1,
    changedItems: [CANVAS_CONFORMANCE_DOCUMENT.items[0]!],
    deletedItemIds: [],
  };

  test("validates and round-trips each protocol value", () => {
    expect(fnValidateCanvasCommand(command).valid).toBe(true);
    expect(fnValidateCanvasQuery(query).valid).toBe(true);
    expect(fnValidateCanvasItemPage(page).valid).toBe(true);
    expect(fnValidateCanvasEvent(event).valid).toBe(true);
    expect(CanvasCommandCodec.parse(CanvasCommandCodec.stringify(command))).toEqual(command);
    expect(CanvasQueryCodec.parse(CanvasQueryCodec.stringify(query))).toEqual(query);
    expect(CanvasItemPageCodec.parse(CanvasItemPageCodec.stringify(page))).toEqual(page);
    expect(CanvasEventCodec.parse(CanvasEventCodec.stringify(event))).toEqual(event);
  });

  test("enforces command bounds and cursor/filter compatibility", () => {
    expect(fnValidateCanvasCommand({ ...command, operations: [] }).valid).toBe(false);
    expect(fnValidateCanvasCommand({ ...command, baseRevision: -1 }).valid).toBe(false);
    expect(fnValidateCanvasQuery({
      canvasId: "canvas-a",
      filter: { type: "parent", parentId: null },
      cursor: { type: "id", id: "rect-a" },
    }).issues).toContainEqual(expect.objectContaining({
      code: "QUERY_CURSOR_FILTER_MISMATCH",
    }));
    expect(fnValidateCanvasQuery({ ...query, limit: 1001 }).valid).toBe(false);
  });
});
