import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { SelectionStyleMenu } from "../../../src/components/SelectionStyleMenu";
import { txMountSelectionStyleMenu } from "../../../src/plugins/selection-style-menu/tx.mount-selection-style-menu";
import { ensureDom } from "../../test-setup";

class TestHook<TArgs extends unknown[] = unknown[]> {
  readonly listeners: Array<(...args: TArgs) => unknown> = [];
  tap(listener: (...args: TArgs) => unknown) {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
      return true;
    };
  }
}

function rect(): TElement {
  return {
    id: "rect-1",
    x: 0,
    y: 0,
    rotation: 0,
    zIndex: "A",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    data: { type: "rect", w: 100, h: 80 },
    style: { backgroundColor: "#ffffff", opacity: 1 },
  };
}

describe("SelectionStyleMenu product mount", () => {
  beforeEach(() => {
    ensureDom();
  });

  it("commits style changes to CRDT without runtime node mutation", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const element = rect();
    const patchElement = vi.fn();
    const commit = {
      rollback: vi.fn(),
      redoOps: [],
      undoOps: [],
    };
    const historyRecord = vi.fn();
    const setRememberedStyle = vi.fn();
    let componentProps: Record<string, unknown> | null = null;

    const createSignal = <T,>(initial: T) => {
      let value = initial;
      return [
        () => value,
        (next: T | ((current: T) => T)) => {
          value = typeof next === "function"
            ? (next as (current: T) => T)(value)
            : next;
          return value;
        },
      ] as const;
    };
    const mount = txMountSelectionStyleMenu({
      SelectionStyleMenu: (() => null) as never,
      createComponent: ((_component: unknown, props: Record<string, unknown>) => {
        componentProps = props;
        return null;
      }) as never,
      createMemo: ((computation: () => unknown) => computation) as never,
      createSignal: createSignal as never,
      render: ((renderRoot: () => unknown) => {
        renderRoot();
        return vi.fn();
      }) as never,
      now: () => 42,
      setTimeout: (handler: () => void, timeout: number) => {
        return window.setTimeout(handler, timeout);
      },
      clearTimeout: (timer: number) => window.clearTimeout(timer),
      crdt: {
        doc: () => ({
          id: "doc",
          name: "doc",
          elements: { [element.id]: element },
          groups: {},
        }),
        build: () => ({
          patchElement,
          commit: () => commit,
        }),
        applyOps: vi.fn(),
        hooks: { change: new TestHook() },
      },
      element: {
        getSelectionStyleMenuConfigByElement: () => ({
          sections: { showFillPicker: true },
        }),
        getSelectionStyleMenuConfigById: () => null,
        hooks: { elementsChange: new TestHook() },
      },
      history: { record: historyRecord },
      scene: { container },
      selection: {
        resolveSelection: () => [{
          target: { kind: "element", id: element.id },
          element,
          group: null,
        }],
        hooks: { change: new TestHook() },
      },
      session: {
        editingId: null,
        hooks: { editingChange: new TestHook() },
      },
      theme: {
        getThemeColorPickerPalette: () => [],
        setRememberedStyle,
        hooks: {
          change: new TestHook(),
          rememberedStyleChange: new TestHook(),
        },
      },
      tool: {
        activeToolId: "select",
        getTool: () => ({
          id: "select",
          behavior: { type: "mode", mode: "select" },
        }),
        setActiveTool: vi.fn(),
        hooks: { activeToolChange: new TestHook() },
      },
    } as never, {});

    const onFillChange = componentProps?.onFillChange;
    expect(onFillChange).toBeTypeOf("function");
    (onFillChange as (value: string) => void)("#112233");

    expect(patchElement).toHaveBeenCalledWith(
      element.id,
      expect.objectContaining({
        updatedAt: 42,
        style: expect.objectContaining({
          backgroundColor: "#112233",
        }),
      }),
    );
    expect(historyRecord).toHaveBeenCalledWith(expect.objectContaining({
      label: "selection-style-fill",
    }));
    expect(setRememberedStyle).toHaveBeenCalledWith("rect", {
      fillColor: "#112233",
    });
    expect(container.querySelector("#selection-style-menu")).not.toBeNull();

    mount.dispose();
    expect(container.querySelector("#selection-style-menu")).toBeNull();
    container.remove();
  });

  it("coalesces opacity input and remembers selected plus active draw tool defaults", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const element = rect();
    const applyOps = vi.fn();
    const historyRecord = vi.fn();
    const setRememberedStyle = vi.fn();
    const commit = vi.fn()
      .mockReturnValueOnce({
        rollback: vi.fn(),
        undoOps: ["undo-first"],
        redoOps: ["redo-first"],
      })
      .mockReturnValueOnce({
        rollback: vi.fn(),
        undoOps: ["undo-last"],
        redoOps: ["redo-last"],
      });
    const timers = new Map<number, () => void>();
    let timerId = 0;
    let scheduledDelay = 0;
    let componentProps: Record<string, unknown> | null = null;

    const createSignal = <T,>(initial: T) => {
      let value = initial;
      return [
        () => value,
        (next: T | ((current: T) => T)) => {
          value = typeof next === "function"
            ? (next as (current: T) => T)(value)
            : next;
          return value;
        },
      ] as const;
    };
    const mount = txMountSelectionStyleMenu({
      SelectionStyleMenu: (() => null) as never,
      createComponent: ((_component: unknown, props: Record<string, unknown>) => {
        componentProps = props;
        return null;
      }) as never,
      createMemo: ((computation: () => unknown) => computation) as never,
      createSignal: createSignal as never,
      render: ((renderRoot: () => unknown) => {
        renderRoot();
        return vi.fn();
      }) as never,
      now: () => 42,
      setTimeout: (handler: () => void, timeout: number) => {
        timerId += 1;
        scheduledDelay = timeout;
        timers.set(timerId, handler);
        return timerId;
      },
      clearTimeout: (id: number) => {
        timers.delete(id);
      },
      crdt: {
        doc: () => ({
          id: "doc",
          name: "doc",
          elements: { [element.id]: element },
          groups: {},
        }),
        build: () => ({
          patchElement: vi.fn(),
          commit,
        }),
        applyOps,
        hooks: { change: new TestHook() },
      },
      element: {
        getSelectionStyleMenuConfigByElement: () => ({
          sections: { showOpacityPicker: true },
        }),
        getSelectionStyleMenuConfigById: ({ id }: { id: string }) => {
          return id === "arrow"
            ? { sections: { showOpacityPicker: true } }
            : null;
        },
        hooks: { elementsChange: new TestHook() },
      },
      history: { record: historyRecord },
      scene: { container },
      selection: {
        resolveSelection: () => [{
          target: { kind: "element", id: element.id },
          element,
          group: null,
        }],
        hooks: { change: new TestHook() },
      },
      session: {
        editingId: null,
        hooks: { editingChange: new TestHook() },
      },
      theme: {
        getThemeColorPickerPalette: () => [],
        setRememberedStyle,
        hooks: {
          change: new TestHook(),
          rememberedStyleChange: new TestHook(),
        },
      },
      tool: {
        activeToolId: "arrow",
        getTool: () => ({
          id: "arrow",
          behavior: { type: "mode", mode: "draw-create" },
        }),
        setActiveTool: vi.fn(),
        hooks: { activeToolChange: new TestHook() },
      },
    } as never, {});

    const onOpacityChange = componentProps?.onOpacityChange;
    expect(onOpacityChange).toBeTypeOf("function");
    (onOpacityChange as (value: number) => void)(0.8);
    (onOpacityChange as (value: number) => void)(0.6);

    expect(commit).toHaveBeenCalledTimes(2);
    expect(historyRecord).not.toHaveBeenCalled();
    expect(timers.size).toBe(1);
    expect(scheduledDelay).toBe(120);
    expect(setRememberedStyle).toHaveBeenCalledWith("rect", {
      opacity: 0.8,
    });
    expect(setRememberedStyle).toHaveBeenCalledWith("arrow", {
      opacity: 0.6,
    });

    const flush = [...timers.values()][0];
    expect(flush).toBeTypeOf("function");
    flush?.();

    expect(historyRecord).toHaveBeenCalledTimes(1);
    expect(historyRecord).toHaveBeenCalledWith(expect.objectContaining({
      label: "selection-style-opacity",
    }));
    const historyEntry = historyRecord.mock.calls[0]?.[0] as {
      undo(): void;
      redo(): void;
    };
    historyEntry.undo();
    historyEntry.redo();
    expect(applyOps).toHaveBeenNthCalledWith(1, { ops: ["undo-first"] });
    expect(applyOps).toHaveBeenNthCalledWith(2, { ops: ["redo-last"] });

    mount.dispose();
    container.remove();
  });

  it("keeps overlay pointer, wheel, and key input out of the engine host", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const pointerDown = vi.fn();
    const wheel = vi.fn();
    const keyDown = vi.fn();
    host.addEventListener("pointerdown", pointerDown);
    host.addEventListener("wheel", wheel);
    host.addEventListener("keydown", keyDown);

    const dispose = render(() => createComponent(SelectionStyleMenu, {
      visible: () => true,
      sections: () => ({
        showFillPicker: true,
        showStrokeColorPicker: false,
        showStrokeWidthPicker: false,
        showTextPickers: false,
        showOpacityPicker: false,
        showLineTypePicker: false,
        showStartCapPicker: false,
        showEndCapPicker: false,
      }),
      values: () => ({ fillColor: "@transparent" }),
      colorPalette: () => ({
        fillQuick: [{
          token: "@transparent",
          label: "Transparent",
          color: "transparent",
        }],
        strokeQuick: [],
        groups: [],
      }),
      onFillChange: vi.fn(),
      onStrokeChange: vi.fn(),
      onStrokeWidthChange: vi.fn(),
      onOpacityChange: vi.fn(),
      onFontFamilyChange: vi.fn(),
      onLineTypeChange: vi.fn(),
      onStartCapChange: vi.fn(),
      onEndCapChange: vi.fn(),
    }), host);

    const button = host.querySelector("button");
    expect(button).not.toBeNull();
    button?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    button?.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    button?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "Enter",
    }));

    expect(pointerDown).not.toHaveBeenCalled();
    expect(wheel).not.toHaveBeenCalled();
    expect(keyDown).not.toHaveBeenCalled();
    dispose();
    host.remove();
  });
});
