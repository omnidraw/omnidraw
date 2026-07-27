// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { WidgetManagerService } from "../../src/widget/WidgetManagerService";
import { createTestWidgetBrowser } from "../test-setup";

describe("WidgetManagerService product creation", () => {
  test("starts creation through the lazy scene product port and persists its DTO", () => {
    let registeredTool: {
      createSession?: (event: unknown) => {
        cancel(reason: string): void;
      } | null;
    } | null = null;
    let creationOptions: {
      onCommit(event: unknown): void;
    } | null = null;
    let persisted: unknown;
    const cancel = vi.fn();
    const builder = {
      patchElement(_id: string, element: unknown) {
        persisted = element;
        return builder;
      },
      commit: () => ({
        rollback: vi.fn(),
        redoOps: [],
        undoOps: [],
      }),
    };
    const getProduct = vi.fn(() => ({
      interactions: {
        beginCreation: (_event: unknown, options: typeof creationOptions) => {
          creationOptions = options;
        },
        cancel,
      },
    }));
    const service = new WidgetManagerService({
      crdtService: {
        doc: () => ({ elements: {}, groups: {} }),
        build: () => builder,
        applyOps: vi.fn(),
      } as never,
      contextMenuService: {} as never,
      selectionService: {
        setSelection: vi.fn(),
        setFocusedTarget: vi.fn(),
      } as never,
      elementService: {
        unregisterElement: vi.fn(),
        registerElement: vi.fn(() => vi.fn()),
      } as never,
      toolService: {
        unregisterTool: vi.fn(),
        registerTool: (tool: typeof registeredTool) => {
          registeredTool = tool;
          return vi.fn();
        },
        setActiveTool: vi.fn(),
      } as never,
      portalService: {} as never,
      product: getProduct as never,
      renderOrderService: {
        getOrderedSiblings: () => [],
      } as never,
      confirmDialogService: {} as never,
      browser: createTestWidgetBrowser(),
    });

    service.registerWidget({
      id: "example",
      tool: { label: "Example" },
      createInitialPayload: () => ({ seeded: true }),
    });
    expect(getProduct).not.toHaveBeenCalled();

    const session = registeredTool?.createSession?.({
      pointerId: 7,
    });
    expect(getProduct).toHaveBeenCalledOnce();
    creationOptions?.onCommit({
      belowThreshold: false,
      worldBounds: { minX: 10, minY: 20, maxX: 210, maxY: 120 },
      current: { world: { x: 210, y: 120 } },
    });

    expect(persisted).toMatchObject({
      x: 10,
      y: 20,
      zIndex: "z00000000",
      data: {
        type: "ui-widget",
        kind: "example",
        w: 200,
        h: 100,
        payload: { seeded: true },
      },
    });
    session?.cancel("escape");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
