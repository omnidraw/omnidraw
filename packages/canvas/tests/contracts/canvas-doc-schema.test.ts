import {
  zArrowData,
  zBaseElement,
  zBinding,
  zCanvasDoc,
  zDrawingStyle,
  zElement,
  zElementData,
  zElementStyle,
  zGroup,
  zImageData,
  zLineData,
  zWidgetWindow,
} from "@vibecanvas/service-automerge/types/canvas-doc.zod";
import type {
  TCanvasDoc,
  TElement,
  TElementData,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ZodObject, ZodType } from "zod";
import { describe, expect, it } from "vitest";

type TFieldSchema = ZodType & {
  isNullable(): boolean;
  isOptional(): boolean;
};

function schemaFields(schema: ZodObject): string[] {
  return Object.entries(schema.shape).map(([name, field]) => {
    const typedField = field as TFieldSchema;
    const presence = typedField.isOptional() ? "optional" : "required";
    const nullability = typedField.isNullable() ? "nullable" : "non-null";
    return `${name}:${presence}:${nullability}`;
  });
}

function literalOptions(schema: {
  options: readonly { value: string }[];
}): string[] {
  return schema.options.map((option) => option.value);
}

function createElement(
  id: string,
  data: TElementData,
  order: number,
  overrides: Partial<TElement> = {},
): TElement {
  return {
    id,
    x: order * 10,
    y: order * -5,
    rotation: order === 1 ? 450 : -90,
    scaleX: 1.25,
    scaleY: 0.75,
    zIndex: `z${String(order).padStart(8, "0")}`,
    parentGroupId: "group-child",
    bindings: [{
      targetId: "target-element",
      anchor: { x: 0.25, y: 0.75 },
    }],
    locked: order === 2,
    createdAt: 1_700_000_000_000 + order,
    updatedAt: 1_700_000_001_000 + order,
    data,
    style: {
      backgroundColor: "@surface/canvas",
      strokeColor: "@color/primary",
      strokeWidth: "@stroke-width/medium",
      opacity: 0.8,
      cornerRadius: "@radius/m",
      strokeStyle: "dashed",
      fontSize: "@text/m",
      textAlign: "center",
      verticalAlign: "middle",
    },
    ...overrides,
  };
}

const INLINE_TEXT = {
  type: "text",
  w: 160,
  h: 80,
  text: "Inline text",
  originalText: "Inline text",
  fontFamily: "Inter",
  link: null,
  containerId: "rect",
  autoResize: false,
} as const;

const ELEMENT_DATA = {
  rect: {
    type: "rect",
    w: 160,
    h: 80,
    radius: 12,
    text: INLINE_TEXT,
  },
  ellipse: {
    type: "ellipse",
    rx: 80,
    ry: 40,
    text: { ...INLINE_TEXT, containerId: "ellipse" },
  },
  diamond: {
    type: "diamond",
    w: 140,
    h: 100,
    radius: 4,
    text: { ...INLINE_TEXT, containerId: "diamond" },
  },
  arrow: {
    type: "arrow",
    lineType: "curved",
    points: [[0, 0], [40, 20], [100, -10]],
    startBinding: {
      targetId: "rect",
      anchor: { x: 1, y: 0.5 },
    },
    endBinding: null,
    startCap: "dot",
    endCap: "arrow",
  },
  line: {
    type: "line",
    lineType: "straight",
    points: [[0, 0], [100, 50]],
    startBinding: null,
    endBinding: {
      targetId: "diamond",
      anchor: { x: 0, y: 0.5 },
    },
  },
  pen: {
    type: "pen",
    points: [[0, 0], [10, 4], [20, -2]],
    pressures: [0.2, 0.7, 0.4],
    simulatePressure: false,
  },
  text: {
    ...INLINE_TEXT,
    containerId: null,
    autoResize: true,
  },
  image: {
    type: "image",
    url: "https://example.invalid/image.png",
    base64: null,
    w: 320,
    h: 180,
    crop: {
      x: 4,
      y: 8,
      width: 300,
      height: 160,
      naturalWidth: 640,
      naturalHeight: 360,
    },
  },
  "ui-widget": {
    type: "ui-widget",
    kind: "counter",
    w: 480,
    h: 320,
    expanded: true,
    window: "fullscreen",
    payload: { count: 2, labels: ["one", "two"] },
    uiProps: { accent: "blue" },
  },
  "widget-instance": {
    type: "widget-instance",
    definitionId: "11111111-1111-4111-8111-111111111111",
    revisionId: "22222222-2222-4222-8222-222222222222",
    instanceId: "33333333-3333-4333-8333-333333333333",
    stateDocumentId: "automerge:4P9w8qKtNvbzkexUwmBRETTKQgLf",
    w: 640,
    h: 400,
    expanded: false,
    window: "minimized",
  },
} satisfies Record<string, TElementData>;

const CANONICAL_DOCUMENT = {
  id: "canvas-schema-baseline",
  name: "Canvas schema baseline",
  elements: Object.fromEntries(
    Object.entries(ELEMENT_DATA).map(([id, data], index) => [
      id,
      createElement(id, data, index + 1),
    ]),
  ),
  groups: {
    "group-root": {
      id: "group-root",
      parentGroupId: null,
      zIndex: "z00000001",
      locked: false,
      createdAt: 1_700_000_000_000,
    },
    "group-child": {
      id: "group-child",
      parentGroupId: "group-root",
      zIndex: "z00000002",
      locked: true,
      createdAt: 1_700_000_000_001,
    },
  },
} satisfies TCanvasDoc;

describe("TCanvasDoc migration baseline", () => {
  it("snapshots the complete public schema surface", () => {
    const dataSchemas = Object.fromEntries(
      zElementData.options.map((schema) => [
        schema.shape.type.value,
        schemaFields(schema),
      ]),
    );

    expect({
      canvasDoc: schemaFields(zCanvasDoc),
      baseElement: schemaFields(zBaseElement),
      element: schemaFields(zElement),
      group: schemaFields(zGroup),
      binding: schemaFields(zBinding),
      bindingAnchor: schemaFields(zBinding.shape.anchor),
      drawingStyle: schemaFields(zDrawingStyle),
      elementStyle: schemaFields(zElementStyle),
      data: dataSchemas,
      imageCrop: schemaFields(zImageData.shape.crop),
      enums: {
        elementTypes: Object.keys(dataSchemas),
        lineTypes: literalOptions(zLineData.shape.lineType),
        arrowStartCaps: literalOptions(zArrowData.shape.startCap),
        arrowEndCaps: literalOptions(zArrowData.shape.endCap),
        widgetWindows: zWidgetWindow.options,
        strokeStyles: literalOptions(zElementStyle.shape.strokeStyle.unwrap()),
        textAlign: literalOptions(zElementStyle.shape.textAlign.unwrap()),
        verticalAlign: literalOptions(
          zElementStyle.shape.verticalAlign.unwrap(),
        ),
      },
    }).toMatchInlineSnapshot(`
      {
        "baseElement": [
          "id:required:non-null",
          "x:required:non-null",
          "y:required:non-null",
          "rotation:required:non-null",
          "scaleX:optional:non-null",
          "scaleY:optional:non-null",
          "zIndex:required:non-null",
          "parentGroupId:required:nullable",
          "bindings:required:non-null",
          "locked:required:non-null",
          "createdAt:required:non-null",
          "updatedAt:required:non-null",
        ],
        "binding": [
          "targetId:required:non-null",
          "anchor:required:non-null",
        ],
        "bindingAnchor": [
          "x:required:non-null",
          "y:required:non-null",
        ],
        "canvasDoc": [
          "id:required:non-null",
          "name:required:non-null",
          "elements:required:non-null",
          "groups:required:non-null",
        ],
        "data": {
          "arrow": [
            "type:required:non-null",
            "lineType:required:non-null",
            "points:required:non-null",
            "startBinding:required:nullable",
            "endBinding:required:nullable",
            "startCap:required:non-null",
            "endCap:required:non-null",
          ],
          "diamond": [
            "type:required:non-null",
            "w:required:non-null",
            "h:required:non-null",
            "radius:optional:non-null",
            "text:optional:non-null",
          ],
          "ellipse": [
            "type:required:non-null",
            "rx:required:non-null",
            "ry:required:non-null",
            "text:optional:non-null",
          ],
          "image": [
            "type:required:non-null",
            "url:required:nullable",
            "base64:required:nullable",
            "w:required:non-null",
            "h:required:non-null",
            "crop:required:non-null",
          ],
          "line": [
            "type:required:non-null",
            "lineType:required:non-null",
            "points:required:non-null",
            "startBinding:required:nullable",
            "endBinding:required:nullable",
          ],
          "pen": [
            "type:required:non-null",
            "points:required:non-null",
            "pressures:required:non-null",
            "simulatePressure:required:non-null",
          ],
          "rect": [
            "type:required:non-null",
            "w:required:non-null",
            "h:required:non-null",
            "radius:optional:non-null",
            "text:optional:non-null",
          ],
          "text": [
            "type:required:non-null",
            "w:required:non-null",
            "h:required:non-null",
            "text:required:non-null",
            "originalText:required:non-null",
            "fontFamily:required:non-null",
            "link:required:nullable",
            "containerId:required:nullable",
            "autoResize:required:non-null",
          ],
          "ui-widget": [
            "type:required:non-null",
            "kind:required:non-null",
            "w:required:non-null",
            "h:required:non-null",
            "expanded:required:non-null",
            "window:required:non-null",
            "payload:optional:non-null",
            "uiProps:optional:non-null",
          ],
          "widget-instance": [
            "type:required:non-null",
            "definitionId:required:non-null",
            "revisionId:required:non-null",
            "instanceId:required:non-null",
            "stateDocumentId:optional:non-null",
            "w:required:non-null",
            "h:required:non-null",
            "expanded:required:non-null",
            "window:required:non-null",
          ],
        },
        "drawingStyle": [
          "backgroundColor:optional:non-null",
          "strokeColor:optional:non-null",
          "strokeWidth:optional:non-null",
          "opacity:optional:non-null",
          "cornerRadius:optional:non-null",
          "strokeStyle:optional:non-null",
          "fontSize:optional:non-null",
          "textAlign:optional:non-null",
          "verticalAlign:optional:non-null",
        ],
        "element": [
          "id:required:non-null",
          "x:required:non-null",
          "y:required:non-null",
          "rotation:required:non-null",
          "scaleX:optional:non-null",
          "scaleY:optional:non-null",
          "zIndex:required:non-null",
          "parentGroupId:required:nullable",
          "bindings:required:non-null",
          "locked:required:non-null",
          "createdAt:required:non-null",
          "updatedAt:required:non-null",
          "data:required:non-null",
          "style:required:non-null",
        ],
        "elementStyle": [
          "backgroundColor:optional:non-null",
          "strokeColor:optional:non-null",
          "strokeWidth:optional:non-null",
          "opacity:optional:non-null",
          "cornerRadius:optional:non-null",
          "strokeStyle:optional:non-null",
          "fontSize:optional:non-null",
          "textAlign:optional:non-null",
          "verticalAlign:optional:non-null",
        ],
        "enums": {
          "arrowEndCaps": [
            "none",
            "arrow",
            "dot",
            "diamond",
          ],
          "arrowStartCaps": [
            "none",
            "arrow",
            "dot",
            "diamond",
          ],
          "elementTypes": [
            "rect",
            "ellipse",
            "diamond",
            "arrow",
            "line",
            "pen",
            "text",
            "image",
            "ui-widget",
            "widget-instance",
          ],
          "lineTypes": [
            "straight",
            "curved",
          ],
          "strokeStyles": [
            "solid",
            "dashed",
            "dotted",
          ],
          "textAlign": [
            "left",
            "center",
            "right",
          ],
          "verticalAlign": [
            "top",
            "middle",
            "bottom",
          ],
          "widgetWindows": [
            "contained",
            "minimized",
            "fullscreen",
          ],
        },
        "group": [
          "id:required:non-null",
          "parentGroupId:required:nullable",
          "zIndex:required:non-null",
          "locked:required:non-null",
          "createdAt:required:non-null",
        ],
        "imageCrop": [
          "x:required:non-null",
          "y:required:non-null",
          "width:required:non-null",
          "height:required:non-null",
          "naturalWidth:required:non-null",
          "naturalHeight:required:non-null",
        ],
      }
    `);
  });

  it("accepts every discriminator and preserves product-owned values", () => {
    const parsed = zCanvasDoc.parse(CANONICAL_DOCUMENT);

    expect(parsed).toEqual(CANONICAL_DOCUMENT);
    expect({
      documentKeys: Object.keys(parsed),
      elementTypes: Object.values(parsed.elements).map(
        (element) => element.data.type,
      ),
      rotations: [
        parsed.elements.rect.rotation,
        parsed.elements.ellipse.rotation,
      ],
      scales: [
        parsed.elements.rect.scaleX,
        parsed.elements.rect.scaleY,
      ],
      order: [
        parsed.elements.rect.zIndex,
        parsed.elements["widget-instance"].zIndex,
      ],
      parentGroupId: parsed.elements.rect.parentGroupId,
      bindings: parsed.elements.rect.bindings,
      locked: parsed.elements.ellipse.locked,
      timestamps: [
        parsed.elements.rect.createdAt,
        parsed.elements.rect.updatedAt,
      ],
      styleTokens: parsed.elements.rect.style,
      groupHierarchy: parsed.groups,
      inlineText: parsed.elements.rect.data,
      line: parsed.elements.line.data,
      pen: parsed.elements.pen.data,
      image: parsed.elements.image.data,
      uiWidget: parsed.elements["ui-widget"].data,
      widgetInstance: parsed.elements["widget-instance"].data,
    }).toMatchInlineSnapshot(`
      {
        "bindings": [
          {
            "anchor": {
              "x": 0.25,
              "y": 0.75,
            },
            "targetId": "target-element",
          },
        ],
        "documentKeys": [
          "id",
          "name",
          "elements",
          "groups",
        ],
        "elementTypes": [
          "rect",
          "ellipse",
          "diamond",
          "arrow",
          "line",
          "pen",
          "text",
          "image",
          "ui-widget",
          "widget-instance",
        ],
        "groupHierarchy": {
          "group-child": {
            "createdAt": 1700000000001,
            "id": "group-child",
            "locked": true,
            "parentGroupId": "group-root",
            "zIndex": "z00000002",
          },
          "group-root": {
            "createdAt": 1700000000000,
            "id": "group-root",
            "locked": false,
            "parentGroupId": null,
            "zIndex": "z00000001",
          },
        },
        "image": {
          "base64": null,
          "crop": {
            "height": 160,
            "naturalHeight": 360,
            "naturalWidth": 640,
            "width": 300,
            "x": 4,
            "y": 8,
          },
          "h": 180,
          "type": "image",
          "url": "https://example.invalid/image.png",
          "w": 320,
        },
        "inlineText": {
          "h": 80,
          "radius": 12,
          "text": {
            "autoResize": false,
            "containerId": "rect",
            "fontFamily": "Inter",
            "h": 80,
            "link": null,
            "originalText": "Inline text",
            "text": "Inline text",
            "type": "text",
            "w": 160,
          },
          "type": "rect",
          "w": 160,
        },
        "line": {
          "endBinding": {
            "anchor": {
              "x": 0,
              "y": 0.5,
            },
            "targetId": "diamond",
          },
          "lineType": "straight",
          "points": [
            [
              0,
              0,
            ],
            [
              100,
              50,
            ],
          ],
          "startBinding": null,
          "type": "line",
        },
        "locked": true,
        "order": [
          "z00000001",
          "z00000010",
        ],
        "parentGroupId": "group-child",
        "pen": {
          "points": [
            [
              0,
              0,
            ],
            [
              10,
              4,
            ],
            [
              20,
              -2,
            ],
          ],
          "pressures": [
            0.2,
            0.7,
            0.4,
          ],
          "simulatePressure": false,
          "type": "pen",
        },
        "rotations": [
          450,
          -90,
        ],
        "scales": [
          1.25,
          0.75,
        ],
        "styleTokens": {
          "backgroundColor": "@surface/canvas",
          "cornerRadius": "@radius/m",
          "fontSize": "@text/m",
          "opacity": 0.8,
          "strokeColor": "@color/primary",
          "strokeStyle": "dashed",
          "strokeWidth": "@stroke-width/medium",
          "textAlign": "center",
          "verticalAlign": "middle",
        },
        "timestamps": [
          1700000000001,
          1700000001001,
        ],
        "uiWidget": {
          "expanded": true,
          "h": 320,
          "kind": "counter",
          "payload": {
            "count": 2,
            "labels": [
              "one",
              "two",
            ],
          },
          "type": "ui-widget",
          "uiProps": {
            "accent": "blue",
          },
          "w": 480,
          "window": "fullscreen",
        },
        "widgetInstance": {
          "definitionId": "11111111-1111-4111-8111-111111111111",
          "expanded": false,
          "h": 400,
          "instanceId": "33333333-3333-4333-8333-333333333333",
          "revisionId": "22222222-2222-4222-8222-222222222222",
          "stateDocumentId": "automerge:4P9w8qKtNvbzkexUwmBRETTKQgLf",
          "type": "widget-instance",
          "w": 640,
          "window": "minimized",
        },
      }
    `);
  });
});
