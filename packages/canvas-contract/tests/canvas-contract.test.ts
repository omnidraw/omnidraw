import { describe, expect, test } from "bun:test";
import type { TImageNode, TRectNode, TWidgetFrameNode } from "@omnidraw/cangine";
import {
  CANVAS_IMAGE_EXTENSION_KEY,
  CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
  fnMaterializeCanvasValidationSnapshot,
  fnReadCanvasImageExtension,
  fnValidateCanvasItems,
} from "../src";

const transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

function rect(id: string, parentId: string | null = null): TRectNode {
  return {
    id,
    parentId,
    orderKey: "A",
    kind: "rect",
    transform,
    size: { width: 100, height: 60 },
  };
}

function widget(extension: Record<string, unknown>): TWidgetFrameNode {
  return {
    id: "widget",
    parentId: null,
    orderKey: "B",
    kind: "widget-frame",
    transform,
    size: { width: 320, height: 240 },
    extensions: {
      "vibecanvas:widget": extension as never,
    },
  };
}

describe("@vibecanvas/canvas-contract", () => {
  test("materializes top-level authored nodes beneath a synthetic content layer", () => {
    const snapshot = fnMaterializeCanvasValidationSnapshot([
      rect("root"),
      rect("child", "root"),
    ]);

    expect(snapshot.rootLayerIds).toEqual([CANVAS_SYNTHETIC_CONTENT_LAYER_ID]);
    expect(snapshot.nodes[0]).toMatchObject({
      id: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      kind: "layer",
      parentId: null,
    });
    expect(snapshot.nodes[1]).toMatchObject({
      id: "root",
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
    });
    expect(snapshot.nodes[2]).toMatchObject({
      id: "child",
      parentId: "root",
    });
  });

  test("validates authored hierarchy with the public Cangine validator", () => {
    expect(fnValidateCanvasItems([
      {
        id: "group",
        parentId: null,
        orderKey: "A",
        kind: "group",
        transform,
      },
      rect("child", "group"),
    ])).toEqual({ valid: true, issues: [] });

    expect(fnValidateCanvasItems([rect("orphan", "missing")])).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: "PARENT_NOT_FOUND" })],
    });
  });

  test("accepts namespaced widget identity without a state document", () => {
    expect(fnValidateCanvasItems([
      widget({
        schemaVersion: 1,
        type: "widget-instance",
        instanceId: "instance-1",
        definitionId: "definition-1",
        revisionId: "revision-1",
      }),
    ])).toEqual({ valid: true, issues: [] });
  });

  test("rejects stateDocumentId and runtime-owned scene content", () => {
    const widgetValidation = fnValidateCanvasItems([
      widget({
        schemaVersion: 1,
        type: "widget-instance",
        instanceId: "instance-1",
        definitionId: "definition-1",
        revisionId: "revision-1",
        stateDocumentId: "forbidden",
      }),
    ]);
    expect(widgetValidation).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: "WIDGET_EXTENSION_FIELDS" })],
    });

    expect(fnValidateCanvasItems([{
      id: "layer",
      parentId: null,
      orderKey: "A",
      kind: "layer",
      role: "content",
      coordinateSpace: "world",
      transform,
    }])).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: "RUNTIME_ONLY_NODE_KIND" })],
    });
  });

  test("rejects malformed authoring samples and the reserved layer ID", () => {
    const malformed = rect(CANVAS_SYNTHETIC_CONTENT_LAYER_ID);
    malformed.extensions = {
      "vibecanvas:authoring": {
        schemaVersion: 1,
        penSource: {
          points: [{ x: 0, y: 0 }],
          pressures: [],
          simulatePressure: true,
        },
      },
    };

    const validation = fnValidateCanvasItems([malformed]);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["RESERVED_ITEM_ID", "AUTHORING_EXTENSION_PEN_LENGTH"]),
    );
  });

  test("validates and reads durable image descriptors", () => {
    const image: TImageNode = {
      id: "image-a",
      parentId: null,
      orderKey: "A",
      kind: "image",
      transform,
      resourceId: "resource-a",
      size: { width: 80, height: 60 },
      extensions: {
        [CANVAS_IMAGE_EXTENSION_KEY]: {
          schemaVersion: 1,
          url: "https://media.test/image-a.png",
          mimeType: "image/png",
        },
      },
    };

    expect(fnValidateCanvasItems([image])).toEqual({ valid: true, issues: [] });
    expect(fnReadCanvasImageExtension(image)).toEqual({
      schemaVersion: 1,
      url: "https://media.test/image-a.png",
      mimeType: "image/png",
    });

    const sourceLess: TImageNode = {
      ...image,
      extensions: undefined,
    };
    expect(fnValidateCanvasItems([sourceLess])).toMatchObject({
      valid: false,
      issues: [
        expect.objectContaining({ code: "IMAGE_EXTENSION_REQUIRED" }),
      ],
    });

    image.extensions![CANVAS_IMAGE_EXTENSION_KEY] = {
      schemaVersion: 1,
      url: "",
      mimeType: "image/svg+xml",
    };
    expect(fnValidateCanvasItems([image])).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "IMAGE_EXTENSION_URL" }),
        expect.objectContaining({ code: "IMAGE_EXTENSION_MIME_TYPE" }),
      ]),
    });

    const wrongKind = rect("rect-with-image");
    wrongKind.extensions = {
      [CANVAS_IMAGE_EXTENSION_KEY]: {
        schemaVersion: 1,
        url: "https://media.test/image-a.png",
        mimeType: "image/png",
      },
    };
    expect(fnValidateCanvasItems([wrongKind])).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: "IMAGE_EXTENSION_NODE_KIND" })],
    });

    const conflictingClone: TImageNode = {
      ...sourceLess,
      id: "image-b",
      orderKey: "B",
      extensions: {
        [CANVAS_IMAGE_EXTENSION_KEY]: {
          schemaVersion: 1,
          url: "https://media.test/image-b.png",
          mimeType: "image/png",
        },
      },
    };
    const originalWithDescriptor: TImageNode = {
      ...sourceLess,
      extensions: {
        [CANVAS_IMAGE_EXTENSION_KEY]: {
          schemaVersion: 1,
          url: "https://media.test/image-a.png",
          mimeType: "image/png",
        },
      },
    };
    expect(fnValidateCanvasItems([
      originalWithDescriptor,
      conflictingClone,
    ])).toMatchObject({
      valid: false,
      issues: [
        expect.objectContaining({
          code: "IMAGE_RESOURCE_DESCRIPTOR_CONFLICT",
          itemId: "image-b",
        }),
      ],
    });
  });
});
