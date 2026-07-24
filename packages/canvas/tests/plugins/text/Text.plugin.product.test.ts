import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createTextPlugin } from "../../../src/plugins/text/Text.plugin";
import { fnCreateTextElement } from "../../../src/plugins/text/fn.create-text-element";
import { CanvasActiveSessionService } from "../../../src/services/active-session/CanvasActiveSessionService";
import {
  CrdtService,
  type TCrdtChangeSummary,
} from "../../../src/services/crdt/CrdtService";
import { HistoryService } from "../../../src/services/history/HistoryService";
import { SelectionService } from "../../../src/services/selection/SelectionService";
import { SessionService } from "../../../src/services/session/SessionService";
import { createMockDocHandle, ensureDom } from "../../test-setup";

ensureDom();

class TestHook<TArgs extends unknown[]> {
  readonly listeners: Array<(...args: TArgs) => unknown> = [];

  tap(listener: (...args: TArgs) => unknown) {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
      return true;
    };
  }

  call(...args: TArgs) {
    for (const listener of [...this.listeners]) {
      const result = listener(...args);
      if (result !== undefined) {
        return result;
      }
    }
  }
}

function textElement(id: string, text = "") {
  const element = fnCreateTextElement({
    id,
    x: 10,
    y: 20,
    createdAt: 1,
    updatedAt: 1,
  });
  if (element.data.type !== "text") {
    throw new Error("Expected text element.");
  }
  element.data.text = text;
  element.data.originalText = text;
  element.data.autoResize = false;
  return element;
}

function harness(initialElements: TCanvasDoc["elements"] = {}) {
  const docHandle = createMockDocHandle({ elements: initialElements });
  const crdt = new CrdtService({ docHandle });
  crdt.start();
  const history = new HistoryService();
  const activeSession = new CanvasActiveSessionService();
  const selection = new SelectionService();
  const sharedSession = new SessionService();
  const projection = new TestHook<[Record<string, unknown>]>();
  const hooks = {
    destroy: new TestHook<[]>(),
    elementPointerDoubleClick: new TestHook<[Record<string, unknown>]>(),
    keydown: new TestHook<[KeyboardEvent]>(),
  };
  let creationOptions: {
    onCommit(commit: {
      start: { world: { x: number; y: number } };
    }): void;
  } | null = null;
  let textSessionOptions: {
    element: HTMLTextAreaElement;
    onCommit?(text: string): void;
    onCancel?(): void;
  } | null = null;
  let registeredTool: {
    createSession?(event: unknown): unknown;
  } | null = null;
  const showInfo = vi.fn();
  let sessionDestroyed = false;
  const scene = {
    container: document.createElement("div"),
    hooks: { projection },
    product: {
      interactions: {
        beginCreation: vi.fn((_event, options) => {
          creationOptions = options;
        }),
        cancel: vi.fn(),
        createTextSession: vi.fn((options) => {
          textSessionOptions = options;
          sessionDestroyed = false;
          return {
            projection: null,
            sync: vi.fn(),
            commit: () => {
              if (!sessionDestroyed) {
                options.onCommit?.(options.element.value);
              }
            },
            cancel: () => {
              if (!sessionDestroyed) {
                options.onCancel?.();
              }
            },
            destroy: () => {
              sessionDestroyed = true;
            },
          };
        }),
      },
    },
  };
  const services = new Map<string, unknown>([
    ["activeSession", activeSession],
    ["crdt", crdt],
    ["element", {
      registerElement: vi.fn(() => vi.fn()),
    }],
    ["history", history],
    ["scene", scene],
    ["selection", selection],
    ["session", sharedSession],
    ["theme", {
      getRememberedStyle: vi.fn(() => ({})),
    }],
    ["tool", {
      registerTool: vi.fn((tool) => {
        registeredTool = tool;
        return vi.fn();
      }),
      setActiveTool: vi.fn(),
    }],
  ]);

  createTextPlugin().apply({
    hooks,
    services: {
      require: (name: string) => services.get(name),
    },
    config: {
      notification: { showInfo },
    },
  } as never);

  return {
    activeSession,
    crdt,
    history,
    hooks,
    selection,
    sharedSession,
    showInfo,
    createTextAt(x = 100, y = 150) {
      registeredTool?.createSession?.({ pointerId: 1 });
      creationOptions?.onCommit({
        start: { world: { x, y } },
      });
      const createdId = Object.keys(crdt.doc().elements)[0];
      if (createdId === undefined) {
        throw new Error("Text creation did not persist an element.");
      }
      return createdId;
    },
    openExisting(id: string) {
      hooks.elementPointerDoubleClick.call({
        hit: {
          target: { kind: "element", id },
        },
      });
    },
    textarea() {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Edit canvas text"]',
      );
      if (textarea === null) {
        throw new Error("Text editor did not open.");
      }
      return textarea;
    },
    activeTextSession: () => textSessionOptions,
    teardown() {
      hooks.destroy.call();
    },
    stop() {
      crdt.stop();
    },
    destroy() {
      hooks.destroy.call();
      crdt.stop();
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Text plugin product editing", () => {
  it("removes a newly click-created empty durable text on Escape", () => {
    const runtime = harness();
    const createdId = runtime.createTextAt();

    expect(runtime.crdt.doc().elements[createdId]).toBeDefined();
    expect(runtime.history.getUndoStackSize()).toBe(1);
    expect(runtime.sharedSession.editingId).toBe(createdId);

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    runtime.hooks.keydown.call(event);

    expect(event.defaultPrevented).toBe(true);
    expect(runtime.crdt.doc().elements[createdId]).toBeUndefined();
    expect(runtime.history.getUndoStackSize()).toBe(0);
    expect(runtime.selection.selection).toEqual([]);
    expect(runtime.sharedSession.editingId).toBeNull();
    expect(document.querySelector("textarea")).toBeNull();

    runtime.destroy();
  });

  it("persists existing text editor contents on Escape with undo and redo", () => {
    const existing = textElement("existing", "before");
    const runtime = harness({ [existing.id]: existing });
    runtime.openExisting(existing.id);
    runtime.textarea().value = "saved on escape";

    runtime.hooks.keydown.call(new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    }));

    expect(runtime.crdt.doc().elements[existing.id]?.data).toMatchObject({
      type: "text",
      text: "saved on escape",
      originalText: "saved on escape",
    });
    expect(runtime.history.getUndoStackSize()).toBe(1);
    expect(document.querySelector("textarea")).toBeNull();

    expect(runtime.history.undo()).toBe(true);
    expect(runtime.crdt.doc().elements[existing.id]?.data).toMatchObject({
      type: "text",
      text: "before",
    });
    expect(runtime.history.redo()).toBe(true);
    expect(runtime.crdt.doc().elements[existing.id]?.data).toMatchObject({
      type: "text",
      text: "saved on escape",
    });

    runtime.destroy();
  });

  it("folds a non-empty new text edit into one creation history entry", () => {
    const runtime = harness();
    const createdId = runtime.createTextAt();
    runtime.textarea().value = "created text";

    runtime.hooks.keydown.call(new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    }));

    expect(runtime.activeTextSession()).toMatchObject({
      element: expect.any(HTMLTextAreaElement),
    });
    expect(runtime.crdt.doc().elements[createdId]?.data).toMatchObject({
      type: "text",
      text: "created text",
    });
    expect(runtime.history.getUndoStackSize()).toBe(1);

    expect(runtime.history.undo()).toBe(true);
    expect(runtime.crdt.doc().elements[createdId]).toBeUndefined();
    expect(runtime.history.redo()).toBe(true);
    expect(runtime.crdt.doc().elements[createdId]?.data).toMatchObject({
      type: "text",
      text: "created text",
    });

    runtime.destroy();
  });

  it("cancels a newly created empty text during repeated teardown", () => {
    const runtime = harness();
    const createdId = runtime.createTextAt();
    const lateSession = runtime.activeTextSession();

    runtime.teardown();
    runtime.teardown();

    expect(runtime.crdt.doc().elements[createdId]).toBeUndefined();
    expect(runtime.history.getUndoStackSize()).toBe(0);
    expect(runtime.sharedSession.editingId).toBeNull();
    expect(document.querySelector("textarea")).toBeNull();

    lateSession?.onCommit?.("late write");
    expect(runtime.crdt.doc().elements[createdId]).toBeUndefined();
    runtime.stop();
  });

  it("commits meaningful new text during teardown", () => {
    const runtime = harness();
    const createdId = runtime.createTextAt();
    runtime.textarea().value = "saved during teardown";

    runtime.teardown();

    expect(runtime.crdt.doc().elements[createdId]?.data).toMatchObject({
      type: "text",
      text: "saved during teardown",
    });
    expect(runtime.history.getUndoStackSize()).toBe(1);
    expect(document.querySelector("textarea")).toBeNull();
    runtime.stop();
  });

  it("commits modified existing text but does not mutate unchanged text", () => {
    const modified = textElement("modified", "before");
    const unchanged = textElement("unchanged", "same");
    const modifiedRuntime = harness({ [modified.id]: modified });
    modifiedRuntime.openExisting(modified.id);
    modifiedRuntime.textarea().value = "after";
    modifiedRuntime.teardown();

    expect(modifiedRuntime.crdt.doc().elements[modified.id]?.data)
      .toMatchObject({ type: "text", text: "after" });
    expect(modifiedRuntime.history.getUndoStackSize()).toBe(1);
    modifiedRuntime.stop();

    const unchangedRuntime = harness({ [unchanged.id]: unchanged });
    unchangedRuntime.openExisting(unchanged.id);
    unchangedRuntime.teardown();

    expect(unchangedRuntime.crdt.doc().elements[unchanged.id]).toEqual(unchanged);
    expect(unchangedRuntime.history.getUndoStackSize()).toBe(0);
    unchangedRuntime.stop();
  });

  it("registers text-basis dependencies and cancels a conflicting remote edit", () => {
    const existing = textElement("existing", "before");
    const runtime = harness({ [existing.id]: existing });
    runtime.openExisting(existing.id);

    expect(runtime.activeSession.active).toMatchObject({
      kind: "text-edit",
      dependencies: {
        elements: {
          existing: [
            "x",
            "y",
            "rotation",
            "scaleX",
            "scaleY",
            "parentGroupId",
            "data",
            "style",
            "locked",
          ],
        },
      },
    });

    const after = textElement("existing", "remote");
    const summary: TCrdtChangeSummary = {
      revision: 1,
      origin: "remote",
      fullReload: false,
      elements: {
        added: [],
        updated: ["existing"],
        deleted: [],
        changes: {
          existing: {
            kind: "updated",
            before: existing,
            after,
            changedFields: ["data"],
          },
        },
      },
      groups: {
        added: [],
        updated: [],
        deleted: [],
        changes: {},
      },
    };

    expect(runtime.activeSession.handleChange(summary)).toMatchObject({
      action: "cancel",
      reason: "remote-element-fields-changed",
    });
    expect(runtime.showInfo).toHaveBeenCalledWith(
      "Text editing stopped",
      "The text changed in another session.",
    );
    expect(runtime.sharedSession.editingId).toBeNull();
    expect(document.querySelector("textarea")).toBeNull();

    runtime.destroy();
  });
});
