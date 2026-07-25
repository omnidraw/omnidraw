import { describe, expect, test, vi } from "vitest";
import { txMigrateWidgetWindow } from "../../../src/services/crdt/tx.migrate-widget-window";

describe("legacy widget window migration", () => {
  test("maps legacy window modes to one durable collapse field", () => {
    const document = {
      elements: {
        minimized: {
          data: {
            type: "ui-widget",
            expanded: true,
            window: "minimized",
          },
        },
        fullscreen: {
          data: {
            type: "widget-instance",
            expanded: false,
            window: "fullscreen",
          },
        },
        contained: {
          data: {
            type: "ui-widget",
            expanded: false,
            window: "contained",
          },
        },
      },
    };
    const change = vi.fn((callback: (value: unknown) => void) => {
      callback(document);
    });

    expect(txMigrateWidgetWindow({
      read: () => document,
      change,
    }, {})).toBe(3);
    expect(document).toEqual({
      elements: {
        minimized: {
          data: { type: "ui-widget", expanded: false },
        },
        fullscreen: {
          data: { type: "widget-instance", expanded: true },
        },
        contained: {
          data: { type: "ui-widget", expanded: false },
        },
      },
    });
    expect(change).toHaveBeenCalledOnce();

    expect(txMigrateWidgetWindow({
      read: () => document,
      change,
    }, {})).toBe(0);
    expect(change).toHaveBeenCalledOnce();
  });
});
