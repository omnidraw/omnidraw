import { describe, expect, test, vi } from "vitest";
import {
  CanvasEditorHistoryAdapter,
  type TCanvasEditorHistoryPort,
} from "../../../src/engine/editor/CanvasEditorHistoryAdapter";

function historyPort(): {
  port: TCanvasEditorHistoryPort;
  state: { canUndo: boolean; canRedo: boolean; retainedWeight: number };
  listener: { current: (() => void) | null };
} {
  const state = {
    canUndo: true,
    canRedo: false,
    retainedWeight: 3,
  };
  const listener: { current: (() => void) | null } = { current: null };
  return {
    state,
    listener,
    port: {
      canUndo: () => state.canUndo,
      canRedo: () => state.canRedo,
      retainedWeight: () => state.retainedWeight,
      subscribe: (next) => {
        listener.current = next;
        return () => {
          if (listener.current === next) {
            listener.current = null;
          }
        };
      },
      undo: vi.fn(() => true),
      redo: vi.fn(() => false),
      clear: vi.fn(),
    },
  };
}

describe("CanvasEditorHistoryAdapter", () => {
  test("presents authoritative product history without owning its grouping", () => {
    const harness = historyPort();
    const adapter = new CanvasEditorHistoryAdapter(harness.port);
    const changed = vi.fn();

    adapter.attach();
    const unsubscribe = adapter.subscribe(changed);
    expect(adapter.canUndo).toBe(true);
    expect(adapter.canRedo).toBe(false);
    expect(adapter.retainedWeight).toBe(3);

    adapter.beginCoalescing("product-operation");
    adapter.endCoalescing("product-operation");
    expect(adapter.undo()).toBe(true);
    expect(adapter.redo()).toBe(false);
    adapter.clear();
    expect(harness.port.undo).toHaveBeenCalledOnce();
    expect(harness.port.redo).toHaveBeenCalledOnce();
    expect(harness.port.clear).toHaveBeenCalledOnce();

    harness.listener.current?.();
    expect(changed).toHaveBeenCalledOnce();
    unsubscribe();
    expect(harness.listener.current).toBeNull();
    adapter.detach();
  });

  test("cannot operate after caller-owned destruction", () => {
    const harness = historyPort();
    const adapter = new CanvasEditorHistoryAdapter(harness.port);

    adapter.destroy();
    expect(adapter.canUndo).toBe(false);
    expect(adapter.canRedo).toBe(false);
    expect(adapter.retainedWeight).toBe(0);
    expect(() => adapter.undo()).toThrow(
      "Canvas editor history adapter is destroyed.",
    );
  });
});
