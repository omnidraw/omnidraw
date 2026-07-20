import Konva from "konva";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { WidgetDropPlacementService } from "../../../src/services/widget-placement/WidgetDropPlacementService";
import type { TWidgetDropRequest } from "../../../src/services/widget-placement/types";
import { ensureDom } from "../../test-setup";

function pointerEvent(type: string, args: {
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  button?: number;
  isPrimary?: boolean;
} = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: args.pointerId ?? 7 },
    clientX: { value: args.clientX ?? 0 },
    clientY: { value: args.clientY ?? 0 },
    button: { value: args.button ?? 0 },
    isPrimary: { value: args.isPrimary ?? true },
  });
  return event;
}

function fixture() {
  const container = document.createElement("div");
  document.body.append(container);
  const canvas = document.createElement("div");
  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 }),
  });
  const dynamicLayer = new Konva.Layer();
  const service = new WidgetDropPlacementService({
    camera: { x: 0, y: 0, zoom: 1 } as never,
    scene: {
      container,
      stage: { container: () => canvas },
      dynamicLayer,
    } as never,
  });
  const onCommit = vi.fn(async () => undefined);
  const onCancel = vi.fn();
  const onDragStart = vi.fn();
  const onDragEnd = vi.fn();
  const request: TWidgetDropRequest = {
    reference: { source: "published", name: "Weather", revision: "revision-1" },
    bounds: { width: 360, height: 320 },
    label: "Weather",
    onCommit,
    onCancel,
    onDragStart,
    onDragEnd,
  };
  return { container, dynamicLayer, service, request, onCommit, onCancel, onDragStart, onDragEnd };
}

describe("WidgetDropPlacementService", () => {
  beforeEach(() => ensureDom());

  test("keeps a sub-threshold gesture as a click without committing", () => {
    const { container, service, request, onCommit, onDragStart, onDragEnd } = fixture();
    expect(service.beginPointerSession(request, pointerEvent("pointerdown", { clientX: 20, clientY: 20 }))).toBe(true);

    document.dispatchEvent(pointerEvent("pointermove", { clientX: 25, clientY: 20 }));
    document.dispatchEvent(pointerEvent("pointerup", { clientX: 25, clientY: 20 }));

    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDragEnd).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    container.remove();
  });

  test("places the keyboard action with the complete frame centered in the viewport", async () => {
    const { container, service, request, onCommit } = fixture();

    await service.addAtViewportCenter(request);

    expect(onCommit).toHaveBeenCalledWith({
      reference: request.reference,
      bounds: request.bounds,
      clientPoint: { x: 320, y: 190 },
    });
    container.remove();
  });

  test("commits one in-canvas drop and suppresses duplicate pointer-up events", async () => {
    const { container, dynamicLayer, service, request, onCommit, onDragStart, onDragEnd } = fixture();
    service.beginPointerSession(request, pointerEvent("pointerdown", { clientX: 110, clientY: 60 }));

    document.dispatchEvent(pointerEvent("pointermove", { clientX: 220, clientY: 170 }));
    expect(onDragStart).toHaveBeenCalledOnce();
    expect(dynamicLayer.findOne(".widget-placement-ghost-frame")).not.toBeUndefined();

    document.dispatchEvent(pointerEvent("pointerup", { clientX: 220, clientY: 170 }));
    document.dispatchEvent(pointerEvent("pointerup", { clientX: 220, clientY: 170 }));
    await Promise.resolve();

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith({
      reference: request.reference,
      bounds: request.bounds,
      clientPoint: { x: 220, y: 170 },
    });
    expect(onDragEnd).toHaveBeenCalledOnce();
    expect(dynamicLayer.findOne(".widget-placement-ghost-frame")).toBeUndefined();
    expect(document.body.style.userSelect).toBe("");
    container.remove();
  });

  test("keeps a building shell visible until an asynchronous draft commit settles", async () => {
    const { container, dynamicLayer, service, request } = fixture();
    let resolveCommit!: () => void;
    const pendingCommit = new Promise<void>((resolve) => { resolveCommit = resolve; });
    request.reference = { source: "draft", name: "Weather", revision: "revision-1" };
    request.onCommit = vi.fn(() => pendingCommit);
    service.beginPointerSession(request, pointerEvent("pointerdown", { clientX: 110, clientY: 60 }));
    document.dispatchEvent(pointerEvent("pointermove", { clientX: 220, clientY: 170 }));

    document.dispatchEvent(pointerEvent("pointerup", { clientX: 220, clientY: 170 }));

    expect(dynamicLayer.findOne(".widget-placement-ghost-frame")).not.toBeUndefined();
    const label = dynamicLayer.findOne(".widget-placement-ghost-label");
    expect(label).toBeInstanceOf(Konva.Text);
    expect((label as Konva.Text).text()).toBe("Building Weather Preview…");

    resolveCommit();
    await pendingCommit;
    await Promise.resolve();
    expect(dynamicLayer.findOne(".widget-placement-ghost-frame")).toBeUndefined();
    container.remove();
  });

  test("Escape cancels a drag and removes its ghost and listeners", () => {
    const { container, dynamicLayer, service, request, onCommit, onCancel, onDragEnd } = fixture();
    service.beginPointerSession(request, pointerEvent("pointerdown", { clientX: 110, clientY: 60 }));
    document.dispatchEvent(pointerEvent("pointermove", { clientX: 220, clientY: 170 }));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    document.dispatchEvent(pointerEvent("pointerup", { clientX: 220, clientY: 170 }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledWith("escape");
    expect(onDragEnd).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(dynamicLayer.findOne(".widget-placement-ghost-frame")).toBeUndefined();
    expect(document.body.style.userSelect).toBe("");
    container.remove();
  });

  test("keeps an active drag when its exact source remains available", () => {
    const { container, service, request, onCancel, onCommit } = fixture();
    service.beginPointerSession(request, pointerEvent("pointerdown", { clientX: 110, clientY: 60 }));
    document.dispatchEvent(pointerEvent("pointermove", { clientX: 220, clientY: 170 }));

    service.cancelIfReferenceUnavailable([request.reference]);
    document.dispatchEvent(pointerEvent("pointerup", { clientX: 220, clientY: 170 }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledOnce();
    container.remove();
  });

  test("cancels an active drag when its exact revision disappears", () => {
    const { container, service, request, onCancel, onCommit } = fixture();
    service.beginPointerSession(request, pointerEvent("pointerdown", { clientX: 110, clientY: 60 }));
    document.dispatchEvent(pointerEvent("pointermove", { clientX: 220, clientY: 170 }));

    service.cancelIfReferenceUnavailable([{ ...request.reference, revision: "revision-2" }]);
    document.dispatchEvent(pointerEvent("pointerup", { clientX: 220, clientY: 170 }));

    expect(onCancel).toHaveBeenCalledWith("source-changed");
    expect(onCommit).not.toHaveBeenCalled();
    container.remove();
  });
});
