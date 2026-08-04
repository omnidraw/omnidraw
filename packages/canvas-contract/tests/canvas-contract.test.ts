import { describe, expect, test } from "bun:test";
import type {
  TImageNode,
  TRectNode,
  TSceneNode,
  TWidgetFrameNode,
} from "@omnidraw/cangine";
import {
  CANVAS_IMAGE_EXTENSION_KEY,
  CANVAS_SEMANTIC_STYLE_EXTENSION_KEY,
  CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
  fnMaterializeCanvasValidationSnapshot,
  fnReadCanvasImageExtension,
  fnReadCanvasSemanticStyleExtension,
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
      "omnidraw:widget": extension as never,
    },
  };
}

describe("@omnidraw/canvas-contract", () => {
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

  test("accepts filesystem widget identity and concrete local resources without state", () => {
    expect(fnValidateCanvasItems([
      widget({
        schemaVersion: 1,
        type: "widget-instance",
        instanceId: "instance-1",
        widgetKey: "counter",
        resourceBindings: {
          todos: {
            resourceId: "resource-1",
            allowRead: true,
            allowWrite: false,
          },
        },
      }),
    ])).toEqual({ valid: true, issues: [] });
  });

  test("rejects stateDocumentId and runtime-owned scene content", () => {
    const widgetValidation = fnValidateCanvasItems([
      widget({
        schemaVersion: 1,
        type: "widget-instance",
        instanceId: "instance-1",
        widgetKey: "counter",
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

    expect(fnValidateCanvasItems([{
      id: "background",
      parentId: null,
      orderKey: "A",
      kind: "background",
    } as TSceneNode])).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: "RUNTIME_ONLY_NODE_KIND" })],
    });
  });

  test("rejects legacy database identity and invalid concrete resource choices", () => {
    expect(fnValidateCanvasItems([
      widget({
        schemaVersion: 1,
        type: "widget-instance",
        instanceId: "instance-1",
        widgetKey: "Counter",
        definitionId: "legacy-definition",
        revisionId: "legacy-revision",
        resourceBindings: {
          "9bad": {
            resourceId: "r".repeat(201),
            allowRead: false,
            allowWrite: false,
          },
        },
      }),
    ])).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "WIDGET_EXTENSION_FIELDS" }),
        expect.objectContaining({ code: "WIDGET_EXTENSION_WIDGET_KEY" }),
        expect.objectContaining({ code: "WIDGET_EXTENSION_RESOURCE_SLOT" }),
        expect.objectContaining({ code: "WIDGET_EXTENSION_RESOURCE_PERMISSIONS" }),
        expect.objectContaining({ code: "WIDGET_EXTENSION_RESOURCE_ID" }),
      ]),
    });

    expect(fnValidateCanvasItems([
      widget({
        schemaVersion: 1,
        type: "widget-instance",
        instanceId: "i".repeat(201),
        widgetKey: "c".repeat(101),
        resourceBindings: {
          ["a".repeat(201)]: {
            resourceId: "resource-1",
            allowRead: true,
            allowWrite: false,
          },
        },
      }),
    ])).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "WIDGET_EXTENSION_IDENTITY" }),
        expect.objectContaining({ code: "WIDGET_EXTENSION_WIDGET_KEY" }),
        expect.objectContaining({ code: "WIDGET_EXTENSION_RESOURCE_SLOT" }),
      ]),
    });
  });

  test("rejects malformed authoring samples and the synthetic content ID", () => {
    const malformed = rect(CANVAS_SYNTHETIC_CONTENT_LAYER_ID);
    malformed.extensions = {
      "omnidraw:authoring": {
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

  test("validates and reads bounded semantic canvas style intent", () => {
    const semantic = rect("semantic");
    semantic.fill = {
      type: "solid",
      color: { space: "srgb", r: 0.1, g: 0.2, b: 0.3, a: 1 },
    };
    semantic.stroke = {
      paint: {
        type: "solid",
        color: { space: "srgb", r: 0.8, g: 0.7, b: 0.6, a: 1 },
      },
      width: 2,
    };
    semantic.extensions = {
      [CANVAS_SEMANTIC_STYLE_EXTENSION_KEY]: {
        schemaVersion: 1,
        background: "green",
        ink: "blue",
      },
    };

    expect(fnValidateCanvasItems([semantic])).toEqual({ valid: true, issues: [] });
    expect(fnReadCanvasSemanticStyleExtension(semantic)).toEqual({
      schemaVersion: 1,
      background: "green",
      ink: "blue",
    });

    semantic.extensions[CANVAS_SEMANTIC_STYLE_EXTENSION_KEY] = {
      schemaVersion: 1,
      background: "primary",
      ink: "transparent",
      extra: true,
    } as never;
    expect(fnValidateCanvasItems([semantic])).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "SEMANTIC_STYLE_EXTENSION_FIELDS" }),
        expect.objectContaining({ code: "SEMANTIC_STYLE_BACKGROUND_CODE" }),
        expect.objectContaining({ code: "SEMANTIC_STYLE_INK_CODE" }),
      ]),
    });
  });

  test("supports widget title-bar background intent but rejects widget ink", () => {
    const semanticWidget = widget({
      schemaVersion: 1,
      type: "ui-widget",
      kind: "example",
    });
    semanticWidget.extensions![CANVAS_SEMANTIC_STYLE_EXTENSION_KEY] = {
      schemaVersion: 1,
      background: "neutral",
    };
    semanticWidget.titleBarColor = {
      space: "srgb", r: 0.2, g: 0.3, b: 0.4, a: 1,
    };
    expect(fnValidateCanvasItems([semanticWidget]))
      .toEqual({ valid: true, issues: [] });
    semanticWidget.extensions![CANVAS_SEMANTIC_STYLE_EXTENSION_KEY] = {
      schemaVersion: 1,
      ink: "neutral",
    };
    expect(fnValidateCanvasItems([semanticWidget])).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({
        code: "SEMANTIC_STYLE_INK_NODE_KIND",
      })],
    });
  });

  test("requires concrete old-client paint fallbacks for semantic intent", () => {
    const semantic = rect("semantic-without-fallback");
    semantic.extensions = {
      [CANVAS_SEMANTIC_STYLE_EXTENSION_KEY]: {
        schemaVersion: 1,
        background: "green",
        ink: "blue",
      },
    };

    expect(fnValidateCanvasItems([semantic])).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "SEMANTIC_STYLE_BACKGROUND_FALLBACK" }),
        expect.objectContaining({ code: "SEMANTIC_STYLE_INK_FALLBACK" }),
      ]),
    });
  });
});
