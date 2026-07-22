import { describe, expect, test } from "vitest";
import Konva from "konva";
import { WidgetManagerService } from "../../src/widget/WidgetManagerService";
import {
  WIDGET_HOST_MIN_HEIGHT,
  WIDGET_HOST_MIN_WIDTH,
} from "../../src/widget/CONSTANTS";
import { ELEMENT_DATA_ATTR } from "@vibecanvas/canvas/core/CONSTANTS";
import { createTestWidgetBrowser } from "../test-setup";

describe("widget transform options", () => {
  test("stops transformer resize boxes below widget minimum dimensions", () => {
    let registeredDefinition: { getTransformOptions?: () => unknown } | null = null;
    const service = new WidgetManagerService({
      crdtService: {} as never,
      contextMenuService: {} as never,
      loggingService: {} as never,
      themeService: {} as never,
      selectionService: {} as never,
      elementService: {
        unregisterElement() {},
        registerElement(definition: { getTransformOptions?: () => unknown }) {
          registeredDefinition = definition;
        },
      } as never,
      toolService: {
        unregisterTool() {},
      } as never,
      sceneService: {} as never,
      renderOrderService: {} as never,
      cameraService: {} as never,
      confirmDialogService: {} as never,
      browser: createTestWidgetBrowser(),
      transport: {} as never,
    });

    service.registerWidget({ id: "example" });

    expect(registeredDefinition).not.toBeNull();
    const definition = registeredDefinition as unknown as { getTransformOptions?: () => unknown };
    const options = definition.getTransformOptions?.() as {
      boundBoxFunc?: (oldBox: { x: number; y: number; width: number; height: number }, newBox: { x: number; y: number; width: number; height: number }) => { x: number; y: number; width: number; height: number };
    } | undefined;
    expect(options?.boundBoxFunc).toBeTypeOf("function");

    const oldBox = { x: 0, y: 0, width: WIDGET_HOST_MIN_WIDTH, height: WIDGET_HOST_MIN_HEIGHT };
    const tooNarrowBox = { x: 10, y: 0, width: WIDGET_HOST_MIN_WIDTH - 1, height: WIDGET_HOST_MIN_HEIGHT };
    const tooShortBox = { x: 0, y: 10, width: WIDGET_HOST_MIN_WIDTH, height: WIDGET_HOST_MIN_HEIGHT - 1 };
    const validBox = { x: -10, y: -10, width: WIDGET_HOST_MIN_WIDTH + 10, height: WIDGET_HOST_MIN_HEIGHT + 10 };

    expect(options?.boundBoxFunc?.(oldBox, tooNarrowBox)).toBe(oldBox);
    expect(options?.boundBoxFunc?.(oldBox, tooShortBox)).toBe(oldBox);
    expect(options?.boundBoxFunc?.(oldBox, validBox)).toBe(validBox);
  });

  test("matches widget nodes only for the registered widget kind", () => {
    let registeredDefinition: { matchesNode?: (node: Konva.Node) => boolean } | null = null;
    const service = new WidgetManagerService({
      crdtService: {} as never,
      contextMenuService: {} as never,
      loggingService: {} as never,
      themeService: {} as never,
      selectionService: {} as never,
      elementService: {
        unregisterElement() {},
        registerElement(definition: { matchesNode?: (node: Konva.Node) => boolean }) {
          registeredDefinition = definition;
        },
      } as never,
      toolService: {
        unregisterTool() {},
      } as never,
      sceneService: {} as never,
      renderOrderService: {} as never,
      cameraService: {} as never,
      confirmDialogService: {} as never,
      browser: createTestWidgetBrowser(),
      transport: {} as never,
    });

    service.registerWidget({ id: "terminal" });

    const uiTerminalNode = new Konva.Group();
    uiTerminalNode.setAttr(ELEMENT_DATA_ATTR, {
      type: "ui-widget",
      kind: "terminal",
    });

    expect(registeredDefinition).not.toBeNull();
    const definition = registeredDefinition as unknown as { matchesNode?: (node: Konva.Node) => boolean };
    expect(definition.matchesNode?.(uiTerminalNode)).toBe(true);
  });
});
