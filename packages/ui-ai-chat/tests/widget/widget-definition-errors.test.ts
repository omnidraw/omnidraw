import { describe, expect, test, vi } from "vitest";
import type { TWidgetError } from "@vibecanvas/service-db/model";
import { WidgetManagerService } from "../../src/widget/WidgetManagerService";
import { createTestWidgetBrowser } from "../test-setup";

describe("widget definition errors", () => {
  test("invalidates mounted widgets only when the global error changes", () => {
    const invalidate = vi.fn();
    const service = new WidgetManagerService({
      crdtService: {
        doc: () => ({
          elements: {
            "widget-1": {
              id: "widget-1",
              data: {
                type: "widget-instance",
                definitionId: "00000000-0000-4000-8000-000000000001",
                revisionId: "00000000-0000-4000-8000-000000000002",
                instanceId: "00000000-0000-4000-8000-000000000003",
              },
            },
          },
        }),
      } as never,
      contextMenuService: {} as never,
      loggingService: {} as never,
      themeService: {} as never,
      selectionService: {} as never,
      elementService: {} as never,
      toolService: {} as never,
      sceneService: {} as never,
      renderOrderService: {} as never,
      cameraService: {} as never,
      confirmDialogService: {} as never,
      browser: createTestWidgetBrowser(),
      transport: {} as never,
    });
    (service as unknown as { runtimeHooks: { elementDefinitionInvalidated: { call: typeof invalidate } } }).runtimeHooks = {
      elementDefinitionInvalidated: { call: invalidate },
    };
    const error: TWidgetError = {
      phase: "definition-discovery",
      code: "WIDGET_DEFINITION_UNAVAILABLE",
      message: "Widget definitions could not be loaded.",
      retryable: true,
    };

    service.setGlobalDefinitionError(null);
    service.setGlobalDefinitionError(error);
    service.setGlobalDefinitionError({ ...error });
    service.setGlobalDefinitionError(null);
    service.setGlobalDefinitionError(null);

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenNthCalledWith(1, { elementIds: ["widget-1"] });
    expect(invalidate).toHaveBeenNthCalledWith(2, { elementIds: ["widget-1"] });
  });
});
