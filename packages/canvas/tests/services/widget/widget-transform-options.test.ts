import { describe, expect, test } from "vitest";
import { WidgetManagerService } from "../../../src/services/widget/WidgetManagerService";
import {
  WIDGET_HOST_MIN_HEIGHT,
  WIDGET_HOST_MIN_WIDTH,
} from "../../../src/services/widget/CONSTANTS";

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
        registerElement(definition: { getTransformOptions?: () => unknown }) {
          registeredDefinition = definition;
        },
      } as never,
      toolService: {} as never,
      sceneService: {} as never,
      renderOrderService: {} as never,
      cameraService: {} as never,
    });

    service.registerWidget({ id: "example" });

    const options = registeredDefinition?.getTransformOptions?.() as {
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
});
