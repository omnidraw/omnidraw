import Konva from "konva";
import { describe, expect, test } from "vitest";
import { CanvasMode } from "../../../src/services/selection/CONSTANTS";
import { createNewCanvasHarness, flushCanvasEffects } from "../../new-test-setup";

function firePointerUp(stage: Konva.Stage, layer: Konva.Layer, runtime: ReturnType<typeof createNewCanvasHarness> extends Promise<infer T> ? T["runtime"] : never, x: number, y: number) {
  const originalGetPos = layer.getRelativePointerPosition.bind(layer);
  layer.getRelativePointerPosition = () => ({ x, y });

  runtime.hooks.pointerUp.call({
    target: stage,
    currentTarget: stage,
    evt: new PointerEvent("pointerup"),
    cancelBubble: false,
  } as unknown as Konva.KonvaEventObject<PointerEvent>);

  layer.getRelativePointerPosition = originalGetPos;
}

describe("new Text plugin click-create", () => {
  test("pointerUp in click-create + text tool adds a text node", async () => {
    const harness = await createNewCanvasHarness();
    const tool = harness.runtime.services.require("tool");
    const selection = harness.runtime.services.require("selection");

    tool.setActiveTool("text");
    await flushCanvasEffects();

    const before = harness.staticForegroundLayer.getChildren().filter((node) => node instanceof Konva.Text).length;
    firePointerUp(harness.stage, harness.staticForegroundLayer, harness.runtime, 100, 150);
    await flushCanvasEffects();

    const textNodes = harness.staticForegroundLayer.getChildren().filter((node) => node instanceof Konva.Text) as Konva.Text[];
    const added = textNodes.at(-1);

    expect(selection.mode).toBe(CanvasMode.SELECT);
    expect(tool.activeToolId).toBe("select");
    expect(textNodes.length).toBe(before + 1);
    expect(added).toBeTruthy();
    expect(added?.x()).toBeCloseTo(100, 0);
    expect(added?.y()).toBeCloseTo(150, 0);

    await harness.destroy();
  });

  test("remembered text tool style is used for new text", async () => {
    const harness = await createNewCanvasHarness();
    const tool = harness.runtime.services.require("tool");
    const theme = harness.runtime.services.require("theme");

    theme.setRememberedStyle("text", {
      strokeColor: "@purple/700",
      fontFamily: "monospace",
      fontSize: "@text/xl",
      textAlign: "center",
      verticalAlign: "middle",
      opacity: 0.5,
    });
    tool.setActiveTool("text");
    await flushCanvasEffects();

    firePointerUp(harness.stage, harness.staticForegroundLayer, harness.runtime, 100, 150);
    await flushCanvasEffects();

    const textNodes = harness.staticForegroundLayer.getChildren().filter((node) => node instanceof Konva.Text) as Konva.Text[];
    const added = textNodes.at(-1);

    expect(added).toBeTruthy();
    expect(added?.fill()).toBe("#7e22ce");
    expect(added?.fontFamily()).toBe("monospace");
    expect(added?.fontSize()).toBe(36);
    expect(added?.align()).toBe("center");
    expect(added?.verticalAlign()).toBe("middle");
    expect(added?.opacity()).toBe(0.5);

    await harness.destroy();
  });

  test("new text opens textarea edit UI and Escape cancels the empty new node", async () => {
    const harness = await createNewCanvasHarness();
    const tool = harness.runtime.services.require("tool");

    tool.setActiveTool("text");
    await flushCanvasEffects();

    firePointerUp(harness.stage, harness.staticForegroundLayer, harness.runtime, 100, 150);
    await flushCanvasEffects();

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    expect(parseFloat(textarea!.style.height)).toBeGreaterThan(0);

    textarea!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushCanvasEffects();

    expect(harness.stage.container().querySelector("textarea")).toBeNull();
    expect(harness.staticForegroundLayer.getChildren().filter((node) => node instanceof Konva.Text)).toHaveLength(0);

    await harness.destroy();
  });

  test("pointerUp outside click-create mode is ignored", async () => {
    const harness = await createNewCanvasHarness();
    const tool = harness.runtime.services.require("tool");
    const selection = harness.runtime.services.require("selection");

    tool.setActiveTool("text");
    selection.mode = CanvasMode.DRAW_CREATE;
    await flushCanvasEffects();

    const before = harness.staticForegroundLayer.getChildren().length;
    firePointerUp(harness.stage, harness.staticForegroundLayer, harness.runtime, 100, 150);
    await flushCanvasEffects();

    expect(harness.staticForegroundLayer.getChildren().length).toBe(before);

    await harness.destroy();
  });
});
