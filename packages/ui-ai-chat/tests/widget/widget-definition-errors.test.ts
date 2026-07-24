import { describe, expect, test } from "vitest";
import type { TWidgetError } from "@vibecanvas/service-db/model";
import { WidgetManagerService } from "../../src/widget/WidgetManagerService";
import { createTestWidgetBrowser } from "../test-setup";

describe("widget definition errors", () => {
  test("resolves definition errors from product elements", () => {
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
      selectionService: {} as never,
      elementService: {} as never,
      toolService: {} as never,
      portalService: {} as never,
      product: () => ({}) as never,
      renderOrderService: {} as never,
      confirmDialogService: {} as never,
      browser: createTestWidgetBrowser(),
    });
    const error: TWidgetError = {
      phase: "definition-discovery",
      code: "WIDGET_DEFINITION_UNAVAILABLE",
      message: "Widget definitions could not be loaded.",
      retryable: true,
    };

    const element = {
      id: "ui-widget-1",
      data: {
        type: "ui-widget",
        kind: "missing",
      },
    } as never;

    service.setGlobalDefinitionError(error);
    expect(service.getWidgetError(element)).toEqual(error);
    service.setGlobalDefinitionError(null);
    service.completeDefinitionDiscovery();
    expect(service.getWidgetError(element)).toMatchObject({
      code: "WIDGET_DEFINITION_UNAVAILABLE",
    });
  });
});
