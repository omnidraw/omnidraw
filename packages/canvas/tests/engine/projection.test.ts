import { assertValidSceneSnapshot } from "@vibecanvas/canvas-engine/testing";
import type {
  TCanvasDoc,
  TElement,
  TElementData,
  TElementStyle,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { getStroke } from "perfect-freehand";
import {
  describe,
  expect,
  it,
} from "vitest";
import { CANVAS_ENGINE_LAYER_IDS } from "../../src/engine/CONSTANTS";
import type { TCanvasProjectionTheme } from "../../src/engine/typed";
import {
  createBuiltInProjectionRegistry,
  createProjectionRegistry,
} from "../../src/engine/projection/ProjectionRegistry";
import { fnDiffCanvasProjections } from "../../src/engine/projection/fn.diff";
import {
  fnCanvasEngineElementChildId,
  fnCanvasEngineElementId,
  fnCanvasEngineGroupId,
  fnCanvasEngineImageResourceId,
  fnDecodeCanvasEngineIdPart,
  fnEncodeCanvasEngineIdPart,
} from "../../src/engine/projection/fn.ids";
import { fnProjectCanvasDocument } from "../../src/engine/projection/fn.project-document";
import { fnParseCssColor } from "../../src/engine/projection/fn.color";
import {
  fnDegreesToRadians,
  fnRadiansToDegrees,
} from "../../src/engine/projection/fn.units";

const THEME: TCanvasProjectionTheme = {
  id: "projection-test",
  colors: {
    accent: "#dbeafe",
    accentForeground: "#1e3a8a",
    border: "#d6d3d1",
    canvasBackground: "rgba(168, 162, 158, 0.10)",
    canvasGridMajor: "rgba(71, 85, 105, 0.28)",
    canvasGridMinor: "rgba(71, 85, 105, 0.16)",
    canvasSelectionStroke: "#3b82f6",
    canvasText: "#000000",
    card: "#ffffff",
    destructive: "#dc2626",
    muted: "#e7e5e4",
    mutedForeground: "#57534e",
    ring: "#f59e0b",
    success: "#16a34a",
    warning: "#d97706",
  },
  colorTokens: {
    "@transparent": "transparent",
    "@base/100": "#f5f5f4",
    "@base/300": "#d6d3d1",
    "@base/900": "#1c1917",
    "@blue/700": "rgb(29, 78, 216)",
  },
};

const DEPENDENCIES = {
  getStroke,
};

function element(
  id: string,
  zIndex: string,
  data: TElementData,
  style: TElementStyle = {},
  parentGroupId: string | null = "child/group",
): TElement {
  return {
    id,
    x: 10,
    y: 20,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex,
    parentGroupId,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 2,
    data,
    style,
  };
}

function representativeDocument(): TCanvasDoc {
  const inlineText = {
    type: "text",
    w: 120,
    h: 80,
    text: "Inline",
    originalText: "Inline",
    fontFamily: "Arial",
    link: null,
    containerId: null,
    autoResize: false,
  } as const;
  return {
    id: "projection-doc",
    name: "Projection document",
    groups: {
      child: {
        id: "child/group",
        parentGroupId: "parent:group",
        zIndex: "B",
        locked: false,
        createdAt: 1,
      },
      parent: {
        id: "parent:group",
        parentGroupId: null,
        zIndex: "A",
        locked: false,
        createdAt: 1,
      },
    },
    elements: {
      rect: {
        ...element(
          "rect:α",
          "A",
          { type: "rect", w: 120, h: 80, radius: 6, text: inlineText },
          {
            backgroundColor: "@base/300",
            strokeColor: "@blue/700",
            strokeWidth: "@stroke-width/thin",
            fontSize: "@text/m",
          },
        ),
        rotation: 450,
      },
      ellipse: element("ellipse", "B", {
        type: "ellipse",
        rx: 40,
        ry: 25,
      }),
      diamond: element("diamond", "C", {
        type: "diamond",
        w: 90,
        h: 70,
      }),
      line: element(
        "line",
        "D",
        {
          type: "line",
          lineType: "curved",
          points: [[0, 0], [50, 25], [100, 0]],
          startBinding: null,
          endBinding: null,
        },
        {
          strokeColor: "@base/900",
          strokeWidth: "@stroke-width/medium",
        },
      ),
      arrow: element("arrow", "E", {
        type: "arrow",
        lineType: "straight",
        points: [[0, 0], [120, 30]],
        startBinding: null,
        endBinding: null,
        startCap: "dot",
        endCap: "arrow",
      }),
      pen: element(
        "pen",
        "F",
        {
          type: "pen",
          points: [[0, 0], [20, 10], [40, 2], [60, 18]],
          pressures: [0.2, 0.5, 0.8, 0.4],
          simulatePressure: false,
        },
        {
          backgroundColor: "black",
          strokeWidth: "@stroke-width/thick",
        },
      ),
      text: element(
        "text",
        "G",
        {
          type: "text",
          w: 180,
          h: 44,
          text: "Standalone",
          originalText: "Standalone",
          fontFamily: "Arial",
          link: null,
          containerId: null,
          autoResize: false,
        },
        {
          strokeColor: "@base/900",
          fontSize: "@text/s",
        },
      ),
      image: element("image", "H", {
        type: "image",
        url: "https://example.invalid/image.png",
        base64: null,
        w: 100,
        h: 80,
        crop: {
          x: 1,
          y: 2,
          width: 98,
          height: 76,
          naturalWidth: 200,
          naturalHeight: 160,
        },
      }),
      uiWidget: element("ui/widget", "I", {
        type: "ui-widget",
        kind: "calculator",
        w: 320,
        h: 240,
        expanded: true,
        window: "contained",
        payload: {
          expression: "2 + 2",
          nested: { values: [1, true, null] },
        },
        uiProps: {
          compact: false,
        },
      }),
      widgetInstance: element("widget-instance", "J", {
        type: "widget-instance",
        definitionId: "11111111-1111-1111-1111-111111111111",
        revisionId: "22222222-2222-2222-2222-222222222222",
        instanceId: "33333333-3333-3333-3333-333333333333",
        w: 360,
        h: 260,
        expanded: false,
        window: "minimized",
      }),
    },
  };
}

function project(document: TCanvasDoc, revision = 1) {
  return fnProjectCanvasDocument({
    document,
    registry: createBuiltInProjectionRegistry(),
    theme: THEME,
    dependencies: DEPENDENCIES,
    revision,
  });
}

describe("canvas projection primitives", () => {
  it("encodes arbitrary product IDs without collisions and round-trips them", () => {
    const ids = [
      "",
      "a:b",
      "a/b",
      "a%2Fb",
      "emoji-🧭",
      "quote!'()*",
      "\ud800",
    ];
    const encoded = ids.map(fnEncodeCanvasEngineIdPart);

    expect(new Set(encoded).size).toBe(ids.length);
    expect(encoded.map(fnDecodeCanvasEngineIdPart)).toEqual(ids);
    expect(fnCanvasEngineElementId({ id: "a:b" })).not.toBe(
      fnCanvasEngineGroupId({ id: "a:b" }),
    );
    expect(fnCanvasEngineElementChildId({ id: "a:b", child: "render" })).toContain(":render");
    expect(fnCanvasEngineImageResourceId({ id: "image", sourceKey: "one" })).not.toBe(
      fnCanvasEngineImageResourceId({ id: "image", sourceKey: "two" }),
    );
  });

  it("converts degree/radian values without discarding turns or signs", () => {
    for (const angle of [-1080, -90, 0, 450, 1440]) {
      expect(fnRadiansToDegrees({
        angle: fnDegreesToRadians({ angle }),
      })).toBeCloseTo(angle, 12);
    }
  });

  it.each([
    ["#fff", { r: 1, g: 1, b: 1, a: 1 }],
    ["#0008", { r: 0, g: 0, b: 0, a: 136 / 255 }],
    ["#11223344", { r: 17 / 255, g: 34 / 255, b: 51 / 255, a: 68 / 255 }],
    ["rgb(255, 0, 128)", { r: 1, g: 0, b: 128 / 255, a: 1 }],
    ["rgba(10%, 20%, 30%, 50%)", { r: 0.1, g: 0.2, b: 0.3, a: 0.5 }],
    ["rgb(255 255 255 / 25%)", { r: 1, g: 1, b: 1, a: 0.25 }],
    ["transparent", { r: 0, g: 0, b: 0, a: 0 }],
    ["black", { r: 0, g: 0, b: 0, a: 1 }],
    ["white", { r: 1, g: 1, b: 1, a: 1 }],
  ])("parses supported CSS color %s", (value, expected) => {
    const parsed = fnParseCssColor({ value });
    expect(parsed?.space).toBe("srgb");
    expect(parsed?.r).toBeCloseTo(expected.r, 8);
    expect(parsed?.g).toBeCloseTo(expected.g, 8);
    expect(parsed?.b).toBeCloseTo(expected.b, 8);
    expect(parsed?.a).toBeCloseTo(expected.a, 8);
  });

  it("rejects unsupported CSS color syntax", () => {
    expect(fnParseCssColor({ value: "not-a-color" })).toBeNull();
  });
});

describe("full canvas document projection", () => {
  it("projects every persisted discriminator, hierarchy, theme, resources, and portals", () => {
    const document = representativeDocument();
    const before = JSON.stringify(document);
    const projection = project(document, 7);

    expect(projection.diagnostics).toEqual([]);
    expect(() => assertValidSceneSnapshot(projection.snapshot)).not.toThrow();
    expect(projection.index.lastAppliedRevision).toBe(7);
    expect(Object.keys(projection.index.elementNodeIds)).toHaveLength(10);
    expect(projection.resources).toHaveLength(1);
    expect(projection.portals.map((portal) => portal.content.type).sort()).toEqual([
      "ui-widget",
      "widget-instance",
    ]);

    const parentNodeId = fnCanvasEngineGroupId({ id: "parent:group" });
    const childNodeId = fnCanvasEngineGroupId({ id: "child/group" });
    const parentIndex = projection.snapshot.nodes.findIndex((node) => node.id === parentNodeId);
    const childIndex = projection.snapshot.nodes.findIndex((node) => node.id === childNodeId);
    expect(parentIndex).toBeLessThan(childIndex);
    expect(projection.snapshot.nodes[childIndex]?.parentId).toBe(parentNodeId);

    const rectRoot = projection.snapshot.nodes.find((node) => {
      return node.id === fnCanvasEngineElementId({ id: "rect:α" });
    });
    expect(rectRoot?.transform.rotation).toBeCloseTo(5 * Math.PI / 2);
    const ellipseRoot = projection.snapshot.nodes.find((node) => {
      return node.id === fnCanvasEngineElementId({ id: "ellipse" });
    });
    expect(ellipseRoot?.transform.origin).toEqual({ x: 40, y: 25 });
    const inlineText = projection.snapshot.nodes.find((node) => {
      return node.id === fnCanvasEngineElementChildId({
        id: "rect:α",
        child: "inline-text",
      });
    });
    expect(inlineText?.kind).toBe("text");

    const line = projection.snapshot.nodes.find((node) => {
      return node.id === fnCanvasEngineElementChildId({ id: "line", child: "render" });
    });
    expect(line?.kind).toBe("connector");
    if (line?.kind === "connector" && line.routing.type === "manual") {
      expect(line.routing.path.commands.map((command) => command.type)).toEqual(["M", "C", "C"]);
    }

    const pen = projection.snapshot.nodes.find((node) => {
      return node.id === fnCanvasEngineElementChildId({ id: "pen", child: "render" });
    });
    expect(pen?.kind).toBe("polygon");
    if (pen?.kind === "polygon") {
      expect(pen.points.length).toBeGreaterThan(3);
    }

    const expandedWidget = projection.snapshot.nodes.find((node) => {
      return node.id === fnCanvasEngineElementChildId({
        id: "ui/widget",
        child: "render",
      });
    });
    expect(expandedWidget?.kind).toBe("widget-frame");
    if (expandedWidget?.kind === "widget-frame") {
      expect(expandedWidget.collapsed).toBe(false);
      expect(expandedWidget.controls?.map((control) => control.id))
        .toContain("minimize");
    }
    const collapsedWidget = projection.snapshot.nodes.find((node) => {
      return node.id === fnCanvasEngineElementChildId({
        id: "widget-instance",
        child: "render",
      });
    });
    expect(collapsedWidget?.kind).toBe("widget-frame");
    if (collapsedWidget?.kind === "widget-frame") {
      expect(collapsedWidget.collapsed).toBe(true);
      expect(collapsedWidget.controls).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "minimize", kind: "restore" }),
      ]));
    }

    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('"@');
    expect(JSON.parse(serialized)).toEqual(projection);
    expect(JSON.stringify(document)).toBe(before);
  });

  it("is deterministic across record insertion order", () => {
    const document = representativeDocument();
    const reordered: TCanvasDoc = {
      ...document,
      groups: Object.fromEntries(Object.entries(document.groups).reverse()),
      elements: Object.fromEntries(Object.entries(document.elements).reverse()),
    };

    expect(project(reordered).signature).toBe(project(document).signature);
    expect(project(reordered).snapshot).toEqual(project(document).snapshot);
  });

  it("projects fullscreen widgets into the screen overlay without mutating placement", () => {
    const document = representativeDocument();
    const widget = document.elements.uiWidget!;
    if (widget.data.type !== "ui-widget") {
      throw new TypeError("Expected the representative UI widget.");
    }
    widget.data = {
      ...widget.data,
      expanded: true,
      window: "fullscreen",
    };
    document.elements = { uiWidget: widget };
    const before = JSON.stringify(document);
    const projection = fnProjectCanvasDocument({
      document,
      registry: createBuiltInProjectionRegistry(),
      theme: THEME,
      dependencies: {
        getStroke,
        getViewportSize: () => ({ width: 1024, height: 768 }),
      },
    });
    const root = projection.snapshot.nodes.find((node) => {
      return node.id === fnCanvasEngineElementId({ id: widget.id });
    });
    const frame = projection.snapshot.nodes.find((node) => {
      return node.id === fnCanvasEngineElementChildId({
        id: widget.id,
        child: "render",
      });
    });

    expect(root?.parentId).toBe(CANVAS_ENGINE_LAYER_IDS.overlay);
    expect(root?.transform).toMatchObject({
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    });
    expect(frame?.kind).toBe("widget-frame");
    if (frame?.kind === "widget-frame") {
      expect(frame.size).toEqual({ width: 1024, height: 768 });
      expect(frame.resizable).toBe(false);
      expect(frame.portal?.scaleMode).toBe("screen-fixed");
      expect(frame.controls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "maximize",
          kind: "restore",
          label: "Exit fullscreen",
        }),
      ]));
    }
    expect(JSON.stringify(document)).toBe(before);
    expect(() => assertValidSceneSnapshot(projection.snapshot)).not.toThrow();
  });

  it.each([
    {
      name: "missing projector",
      registry: createProjectionRegistry(),
      code: "PROJECTOR_MISSING",
    },
    {
      name: "projector exception",
      registry: createProjectionRegistry([{
        id: "broken",
        priority: 1,
        matchesElement: () => true,
        project: () => {
          throw new Error("forced failure");
        },
      }]),
      code: "PROJECTOR_EXCEPTION",
    },
  ])("renders a visible, semantic placeholder for $name", ({ registry, code }) => {
    const document = representativeDocument();
    document.elements = { rect: document.elements.rect! };
    const projection = fnProjectCanvasDocument({
      document,
      registry,
      theme: THEME,
      dependencies: DEPENDENCIES,
    });

    expect(projection.diagnostics[0]?.code).toBe(code);
    const root = projection.snapshot.nodes.find((node) => {
      return node.id === fnCanvasEngineElementId({ id: "rect:α" });
    });
    expect(root?.metadata?.["vibecanvas:placeholder"]).toBe(true);
    const warning = projection.snapshot.nodes.find((node) => {
      return node.id === fnCanvasEngineElementChildId({
        id: "rect:α",
        child: "placeholder-text",
      });
    });
    expect(warning?.kind).toBe("text");
    if (warning?.kind === "text") {
      expect(warning.runs[0]?.text).toContain("UNSUPPORTED CANVAS FEATURE");
      expect(warning.runs[0]?.text).toContain(code);
    }
    expect(() => assertValidSceneSnapshot(projection.snapshot)).not.toThrow();
    expect(JSON.parse(JSON.stringify(projection))).toEqual(projection);
  });

  it("localizes an element-specific engine capability gap to a placeholder", () => {
    const document = representativeDocument();
    document.elements = {
      widget: document.elements.uiWidget!,
    };
    const projection = fnProjectCanvasDocument({
      document,
      registry: createBuiltInProjectionRegistry(),
      theme: THEME,
      dependencies: {
        ...DEPENDENCIES,
        unsupportedNodeKinds: ["widget-frame"],
        portalsAvailable: false,
      },
    });

    expect(projection.diagnostics).toEqual([
      expect.objectContaining({
        code: "ENGINE_CAPABILITY_MISSING",
        target: {
          kind: "element",
          id: document.elements.widget!.id,
        },
      }),
    ]);
    expect(projection.snapshot.nodes.some((node) => {
      return node.metadata?.["vibecanvas:placeholder"] === true;
    })).toBe(true);
    expect(projection.portals).toEqual([]);
  });

  it("diffs element add/update/delete/reparent and source-revision resources", () => {
    const previousDocument = representativeDocument();
    const nextDocument = structuredClone(previousDocument);
    delete nextDocument.elements.text;
    nextDocument.elements.rect!.parentGroupId = null;
    nextDocument.elements.rect!.style.backgroundColor = "#ffffff";
    nextDocument.elements.image!.data = {
      ...nextDocument.elements.image!.data,
      type: "image",
      url: "https://example.invalid/replacement.png",
    };
    nextDocument.elements.added = element(
      "added",
      "K",
      { type: "rect", w: 20, h: 30 },
      {},
      null,
    );

    const previous = project(previousDocument);
    const next = project(nextDocument);
    const diff = fnDiffCanvasProjections({ previous, next });

    expect(diff.changed).toBe(true);
    expect(diff.elements.added).toContain("added");
    expect(diff.elements.updated).toEqual(expect.arrayContaining(["rect:α", "image"]));
    expect(diff.elements.removed).toContain("text");
    expect(diff.nodes.removed).toEqual(expect.arrayContaining(
      previous.index.elementNodeIds.text as string[],
    ));
    expect(diff.resources.added).toHaveLength(1);
    expect(diff.resources.removed).toHaveLength(1);
  });

  it("recovers cyclic groups to valid top-level projection with diagnostics", () => {
    const document = representativeDocument();
    document.elements = {};
    document.groups.parent!.parentGroupId = "child/group";
    const projection = project(document);

    expect(projection.diagnostics.some((diagnostic) => diagnostic.code === "GROUP_CYCLE")).toBe(true);
    expect(() => assertValidSceneSnapshot(projection.snapshot)).not.toThrow();
  });
});
