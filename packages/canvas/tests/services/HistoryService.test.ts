import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  HistoryService,
  type THistoryEntry,
} from "../../src/services/history/HistoryService";

describe("HistoryService", () => {
  it("discards an exact pending undo entry", () => {
    const history = new HistoryService();
    const entry: THistoryEntry = {
      undo: vi.fn(),
      redo: vi.fn(),
    };
    history.record(entry);

    expect(history.discard(entry)).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBe(false);
    expect(history.discard(entry)).toBe(false);
  });

  it("discards the same entry after it moves to the redo stack", () => {
    const history = new HistoryService();
    const entry: THistoryEntry = {
      undo: vi.fn(),
      redo: vi.fn(),
    };
    history.record(entry);
    history.undo();

    expect(history.discard(entry)).toBe(true);
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBe(false);
  });
});
