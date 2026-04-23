import Konva from "konva";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { beforeEach, describe, expect, test } from "vitest";
import { CAMERA_VIEWPORTS_LOCAL_STORAGE_KEY, MAX_CAMERA_ZOOM } from "../../../src/plugins/camera-control/CONSTANTS";
import { CanvasMode } from "../../../src/services/selection/CONSTANTS";
import { createMockDocHandle, createNewCanvasHarness, flushCanvasEffects } from "../../new-test-setup";

function createRectElement(id = "shape-1"): TElement {
  return {
    id,
    x: 100,
    y: 100,
    rotation: 0,
    zIndex: "z00000001",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    style: {
      backgroundColor: "#ffffff",
      strokeColor: "#111111",
      strokeWidth: "@stroke-width/thin",
      opacity: 1,
    },
    data: {
      type: "rect",
      w: 40,
      h: 40,
    },
  };
}

function getRectNode(harness: Awaited<ReturnType<typeof createNewCanvasHarness>>, id: string) {
  const node = harness.staticForegroundLayer.findOne((candidate: Konva.Node) => {
    return candidate instanceof Konva.Rect && candidate.id() === id;
  });

  if (!(node instanceof Konva.Rect)) {
    throw new Error(`Expected rect node '${id}'`);
  }

  return node;
}

async function createHandHarness(args?: { canvasId?: string }) {
  const element = createRectElement();
  const harness = await createNewCanvasHarness({
    canvasId: args?.canvasId,
    docHandle: createMockDocHandle({
      elements: {
        [element.id]: structuredClone(element),
      },
    }),
  });
  const tool = harness.runtime.services.require("tool");
  const selection = harness.runtime.services.require("selection");
  const camera = harness.runtime.services.require("camera");
  const shape = getRectNode(harness, element.id);

  const handLayer = Array.from(harness.stage.container().querySelectorAll("div.absolute.inset-0"))
    .find((candidate) => (candidate as HTMLDivElement).style.touchAction === "none") as HTMLDivElement | null;
  expect(handLayer).toBeTruthy();

  return {
    ...harness,
    tool,
    selection,
    camera,
    handLayer: handLayer!,
    shape,
  };
}

function dispatchPointerEvent(target: EventTarget, type: string, init: PointerEventInit) {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function readStoredViewports() {
  const storedValue = localStorage.getItem(CAMERA_VIEWPORTS_LOCAL_STORAGE_KEY);
  if (storedValue === null) {
    return {};
  }

  return JSON.parse(storedValue) as Record<string, { x: number; y: number; zoom: number }>;
}

function readStoredViewport(canvasId: string) {
  return readStoredViewports()[canvasId] ?? null;
}

function setStagePointer(stage: Konva.Stage, point: { x: number; y: number }) {
  stage.setPointersPositions(new MouseEvent("mousemove", {
    clientX: point.x,
    clientY: point.y,
  }));
}

describe("new CameraControl plugin", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("hand drag pans camera and resets drag state on release", async () => {
    const { destroy, tool, selection, camera, handLayer } = await createHandHarness();

    tool.setActiveTool("hand");
    await flushCanvasEffects();

    expect(selection.mode).toBe(CanvasMode.HAND);
    expect(handLayer.style.display).toBe("block");
    expect(handLayer.style.pointerEvents).toBe("auto");
    expect(handLayer.style.cursor).toBe("grab");

    dispatchPointerEvent(handLayer, "pointerdown", { pointerId: 1, clientX: 320, clientY: 220 });
    expect(handLayer.style.cursor).toBe("grabbing");

    dispatchPointerEvent(handLayer, "pointermove", { pointerId: 1, clientX: 360, clientY: 250 });

    expect(camera.x).toBe(40);
    expect(camera.y).toBe(30);

    dispatchPointerEvent(handLayer, "pointerup", { pointerId: 1, clientX: 360, clientY: 250 });
    expect(handLayer.style.cursor).toBe("grab");

    dispatchPointerEvent(handLayer, "pointermove", { pointerId: 1, clientX: 410, clientY: 290 });
    expect(camera.x).toBe(40);
    expect(camera.y).toBe(30);

    await destroy();
  });

  test("hand layer blocks selection and shape drag interactions", async () => {
    const { destroy, tool, selection, camera, handLayer, shape } = await createHandHarness();

    tool.setActiveTool("hand");
    await flushCanvasEffects();

    const beforeShapePosition = { x: shape.x(), y: shape.y() };
    dispatchPointerEvent(handLayer, "pointerdown", { pointerId: 2, clientX: 500, clientY: 260 });
    dispatchPointerEvent(handLayer, "pointermove", { pointerId: 2, clientX: 530, clientY: 280 });
    dispatchPointerEvent(handLayer, "pointerup", { pointerId: 2, clientX: 530, clientY: 280 });

    expect(selection.selection).toHaveLength(0);
    expect({ x: shape.x(), y: shape.y() }).toEqual(beforeShapePosition);
    expect(camera.x).toBe(30);
    expect(camera.y).toBe(20);

    await destroy();
  });

  test("leaving hand mode mid-drag clears internal drag state", async () => {
    const { destroy, tool, selection, camera, handLayer } = await createHandHarness();

    tool.setActiveTool("hand");
    await flushCanvasEffects();

    dispatchPointerEvent(handLayer, "pointerdown", { pointerId: 3, clientX: 200, clientY: 180 });
    dispatchPointerEvent(handLayer, "pointermove", { pointerId: 3, clientX: 230, clientY: 210 });

    expect(selection.mode).toBe(CanvasMode.HAND);
    expect(camera.x).toBe(30);
    expect(camera.y).toBe(30);
    expect(handLayer.style.cursor).toBe("grabbing");

    tool.setActiveTool("select");
    await flushCanvasEffects();

    expect(selection.mode).toBe(CanvasMode.SELECT);
    expect(handLayer.style.display).toBe("none");
    expect(handLayer.style.pointerEvents).toBe("none");
    expect(handLayer.style.cursor).toBe("default");

    dispatchPointerEvent(handLayer, "pointermove", { pointerId: 3, clientX: 280, clientY: 260 });
    expect(camera.x).toBe(30);
    expect(camera.y).toBe(30);

    await destroy();
  });

  test("restores a saved viewport for the same canvas id on boot", async () => {
    const canvasId = "camera-restore";
    localStorage.setItem(CAMERA_VIEWPORTS_LOCAL_STORAGE_KEY, JSON.stringify({
      [canvasId]: {
        x: 120,
        y: -40,
        zoom: 2.5,
      },
    }));

    const harness = await createNewCanvasHarness({ canvasId });
    const camera = harness.runtime.services.require("camera");

    expect(camera.x).toBe(120);
    expect(camera.y).toBe(-40);
    expect(camera.zoom).toBe(2.5);

    await harness.destroy();
  });

  test("keeps stored viewport state isolated per canvas id", async () => {
    localStorage.setItem(CAMERA_VIEWPORTS_LOCAL_STORAGE_KEY, JSON.stringify({
      "canvas-a": {
        x: 75,
        y: 25,
        zoom: 1.75,
      },
    }));

    const canvasBHarness = await createNewCanvasHarness({ canvasId: "canvas-b" });
    const canvasBCamera = canvasBHarness.runtime.services.require("camera");

    expect(canvasBCamera.x).toBe(0);
    expect(canvasBCamera.y).toBe(0);
    expect(canvasBCamera.zoom).toBe(1);

    await canvasBHarness.destroy();

    const canvasAHarness = await createNewCanvasHarness({ canvasId: "canvas-a" });
    const canvasACamera = canvasAHarness.runtime.services.require("camera");

    expect(canvasACamera.x).toBe(75);
    expect(canvasACamera.y).toBe(25);
    expect(canvasACamera.zoom).toBe(1.75);

    await canvasAHarness.destroy();
  });

  test("falls back safely for malformed or invalid stored viewport state", async () => {
    const scenarios = [
      {
        canvasId: "camera-missing-fields",
        rawValue: JSON.stringify({ x: 10, y: 20 }),
        expected: { x: 0, y: 0, zoom: 1 },
      },
      {
        canvasId: "camera-non-finite",
        rawValue: "{\"x\":1e309,\"y\":20,\"zoom\":1}",
        expected: { x: 0, y: 0, zoom: 1 },
      },
      {
        canvasId: "camera-clamped-zoom",
        rawValue: JSON.stringify({ x: 10, y: 20, zoom: 999 }),
        expected: { x: 10, y: 20, zoom: MAX_CAMERA_ZOOM },
      },
    ];

    for (const scenario of scenarios) {
      localStorage.setItem(CAMERA_VIEWPORTS_LOCAL_STORAGE_KEY, JSON.stringify({
        [scenario.canvasId]: JSON.parse(scenario.rawValue),
      }));

      const harness = await createNewCanvasHarness({ canvasId: scenario.canvasId });
      const camera = harness.runtime.services.require("camera");

      expect({ x: camera.x, y: camera.y, zoom: camera.zoom }).toEqual(scenario.expected);

      await harness.destroy();
    }

    localStorage.setItem(CAMERA_VIEWPORTS_LOCAL_STORAGE_KEY, "{\"camera-invalid-json\":");
    const malformedHarness = await createNewCanvasHarness({ canvasId: "camera-invalid-json" });
    const malformedCamera = malformedHarness.runtime.services.require("camera");

    expect({ x: malformedCamera.x, y: malformedCamera.y, zoom: malformedCamera.zoom }).toEqual({ x: 0, y: 0, zoom: 1 });

    await malformedHarness.destroy();
  });

  test("persists viewport changes after hand pan and ctrl-wheel zoom", async () => {
    const canvasId = "camera-persist";
    const { destroy, tool, camera, handLayer, runtime, stage } = await createHandHarness({ canvasId });

    tool.setActiveTool("hand");
    await flushCanvasEffects();

    dispatchPointerEvent(handLayer, "pointerdown", { pointerId: 10, clientX: 320, clientY: 220 });
    dispatchPointerEvent(handLayer, "pointermove", { pointerId: 10, clientX: 360, clientY: 250 });
    dispatchPointerEvent(handLayer, "pointerup", { pointerId: 10, clientX: 360, clientY: 250 });

    expect(readStoredViewport(canvasId)).toEqual({ x: 40, y: 30, zoom: 1 });

    setStagePointer(stage, { x: 400, y: 300 });
    runtime.hooks.pointerWheel.call({
      evt: new WheelEvent("wheel", { ctrlKey: true, deltaY: -120, cancelable: true }),
    } as never);

    const storedViewport = readStoredViewport(canvasId);
    expect(storedViewport).not.toBeNull();
    expect(storedViewport?.x).toBeCloseTo(camera.x, 6);
    expect(storedViewport?.y).toBeCloseTo(camera.y, 6);
    expect(storedViewport?.zoom).toBeCloseTo(camera.zoom, 6);
    expect(storedViewport?.zoom).toBeGreaterThan(1);

    await destroy();
  });
});
