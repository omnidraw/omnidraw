// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { txMountWidgetPortal } from "../../src/widget/tx.mount-widget-portal";

function element(): TElement {
  return {
    id: "widget-1",
    x: 0,
    y: 0,
    rotation: 0,
    zIndex: "z00000001",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    data: {
      type: "ui-widget",
      kind: "example",
      w: 320,
      h: 200,
      expanded: true,
      window: "contained",
      payload: {},
    },
    style: {},
  };
}

describe("txMountWidgetPortal", () => {
  test("mounts only product content while using engine-owned title actions", () => {
    const host = document.createElement("div");
    host.style.position = "absolute";
    host.style.width = "320px";
    host.style.height = "172px";
    host.style.overflow = "hidden";
    const leakedPointer = vi.fn();
    const leakedKey = vi.fn();
    const leakedContextMenu = vi.fn();
    host.addEventListener("pointerdown", leakedPointer);
    host.addEventListener("keydown", leakedKey);
    host.addEventListener("contextmenu", leakedContextMenu);
    const cleanup = vi.fn();
    const action = vi.fn();
    const handlers = new Map<string, () => void>();
    const setActionState = vi.fn();
    const dispose = txMountWidgetPortal({ document }, {
      host,
      element: element(),
      error: null,
      titleBar: {
        onAction(id, handler) {
          handlers.set(id, handler);
          return () => handlers.delete(id);
        },
        setActionState,
      },
      config: {
        id: "example",
        titleBarActions: [{ id: "refresh", label: "Refresh" }],
        renderDom: ({ root, titleBar }) => {
          root.textContent = "mounted";
          titleBar?.onAction("refresh", action);
          titleBar?.setActionState("refresh", { pressed: true });
          return cleanup;
        },
      },
    });

    expect(host.querySelector("[data-widget-content-root]")?.textContent)
      .toBe("mounted");
    expect(host.querySelector("[data-widget-title-action]")).toBeNull();
    expect(setActionState).toHaveBeenCalledWith("refresh", { pressed: true });
    expect(host.style.position).toBe("absolute");
    expect(host.style.width).toBe("320px");
    expect(host.style.height).toBe("172px");
    expect(host.style.overflow).toBe("hidden");
    const content = host.querySelector<HTMLElement>(
      "[data-widget-content-root]",
    );
    content?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    content?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "Enter",
    }));
    content?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    expect(leakedPointer).not.toHaveBeenCalled();
    expect(leakedKey).not.toHaveBeenCalled();
    expect(leakedContextMenu).not.toHaveBeenCalled();
    handlers.get("refresh")?.();
    expect(action).toHaveBeenCalledOnce();

    dispose();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(host.childElementCount).toBe(0);
  });

  test("lets frame-edge pointer events reach engine resize handling", () => {
    const host = document.createElement("div");
    const leakedPointer = vi.fn();
    const focusContent = vi.fn();
    host.addEventListener("pointerdown", leakedPointer);
    txMountWidgetPortal({ document }, {
      host,
      element: element(),
      error: null,
      onContentPointerDown: focusContent,
      config: {
        id: "example",
        renderDom: ({ root }) => {
          vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
            x: 10,
            y: 20,
            left: 10,
            top: 20,
            right: 310,
            bottom: 180,
            width: 300,
            height: 160,
            toJSON: () => ({}),
          });
        },
      },
    });

    const content = host.querySelector<HTMLElement>("[data-widget-content-root]");
    content?.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      clientX: 306,
      clientY: 100,
    }));
    expect(leakedPointer).toHaveBeenCalledOnce();
    expect(focusContent).not.toHaveBeenCalled();

    content?.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      clientX: 100,
      clientY: 100,
    }));
    expect(focusContent).toHaveBeenCalledOnce();
  });

  test("keeps fullscreen edge events inside widget content", () => {
    const host = document.createElement("div");
    const leakedPointer = vi.fn();
    const focusContent = vi.fn();
    host.addEventListener("pointerdown", leakedPointer);
    const fullscreen = {
      ...element(),
      data: {
        ...element().data,
        window: "fullscreen" as const,
      },
    } as TElement;
    txMountWidgetPortal({ document }, {
      host,
      element: fullscreen,
      error: null,
      onContentPointerDown: focusContent,
      config: {
        id: "example",
        renderDom: ({ root }) => {
          vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: 300,
            bottom: 200,
            width: 300,
            height: 200,
            toJSON: () => ({}),
          });
        },
      },
    });

    host.querySelector<HTMLElement>("[data-widget-content-root]")
      ?.dispatchEvent(new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 299,
        clientY: 199,
      }));
    expect(focusContent).toHaveBeenCalledOnce();
    expect(leakedPointer).not.toHaveBeenCalled();
  });

  test("renders persisted host errors without invoking a widget renderer", () => {
    const host = document.createElement("div");
    const renderDom = vi.fn();
    txMountWidgetPortal({ document }, {
      host,
      element: element(),
      config: { id: "example", renderDom },
      error: {
        phase: "definition-fetch",
        code: "WIDGET_DEFINITION_UNAVAILABLE",
        message: "Unavailable",
        retryable: true,
      },
    });

    expect(renderDom).not.toHaveBeenCalled();
    expect(host.querySelector('[data-widget-host-error="true"]'))
      .not.toBeNull();
  });
});
