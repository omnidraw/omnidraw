import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { createShape1dPlugin } from "../../../src/plugins/shape1d/Shape1d.plugin";
import { CanvasActiveSessionService } from "../../../src/services/active-session/CanvasActiveSessionService";
import type {
  TCrdtChangeSummary,
  TCrdtEntityChangeSet,
} from "../../../src/services/crdt/CrdtService";
import { describe, expect, it, vi } from "vitest";
import {
  createCanvasDoc,
  createElement,
  createGroup,
} from "../../services/crdt/helpers";

class TestHook<TArgs extends unknown[]> {
  readonly listeners: Array<(...args: TArgs) => unknown> = [];

  tap(listener: (...args: TArgs) => unknown) {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  call(...args: TArgs) {
    for (const listener of [...this.listeners]) {
      listener(...args);
    }
  }
}

function emptyChanges<TEntity>(): TCrdtEntityChangeSet<TEntity> {
  return {
    added: [],
    updated: [],
    deleted: [],
    changes: {},
  };
}

function summary(
  revision: number,
  before: TElement,
  after: TElement,
  changedFields: string[],
): TCrdtChangeSummary {
  return {
    revision,
    origin: "remote",
    fullReload: false,
    elements: {
      added: [],
      updated: [before.id],
      deleted: [],
      changes: {
        [before.id]: {
          kind: "updated",
          before,
          after,
          changedFields,
        },
      },
    },
    groups: emptyChanges(),
  };
}

function lineElement(id: string, parentGroupId: string | null = null) {
  return createElement(id, {
    parentGroupId,
    data: {
      type: "line",
      lineType: "straight",
      points: [[0, 0], [20, 20]],
      startBinding: null,
      endBinding: null,
    },
  });
}

describe("Shape1d point-edit active-session policy", () => {
  it("keeps style updates and cancels point-basis conflicts", () => {
    const line = lineElement("line", "parent");
    const document = createCanvasDoc({
      elements: { line },
      groups: { parent: createGroup("parent") },
    });
    const activeSession = new CanvasActiveSessionService();
    const destroyOwner = vi.fn();
    const createOwner = vi.fn(({ ownerId }) => ({
      id: ownerId,
      replace: vi.fn(),
      clear: vi.fn(),
      destroy: destroyOwner,
    }));
    const hooks = {
      destroy: new TestHook<[]>(),
      elementPointerDoubleClick: new TestHook<[{
        hit: { target: { kind: "element"; id: string } };
      }]>(),
      keydown: new TestHook<[KeyboardEvent]>(),
      pointerCancel: new TestHook<[never]>(),
      pointerDown: new TestHook<[never]>(),
      pointerMove: new TestHook<[never]>(),
      pointerUp: new TestHook<[never]>(),
    };
    const selectionChange = new TestHook<[{
      selection: readonly { kind: "element"; id: string }[];
    }]>();
    const services = new Map<string, unknown>([
      ["activeSession", activeSession],
      ["crdt", {
        doc: () => document,
        revision: 3,
      }],
      ["element", {
        registerElement: vi.fn(() => vi.fn()),
      }],
      ["history", {}],
      ["scene", {
        product: {
          geometry: {
            localToWorld: vi.fn((_target, point) => point),
            worldToViewport: vi.fn((point) => point),
          },
          interactions: {
            beginConnector: vi.fn(),
            cancel: vi.fn(),
          },
          transients: { createOwner },
        },
      }],
      ["selection", {
        hooks: { change: selectionChange },
        select: vi.fn(),
      }],
      ["theme", {
        getRememberedStyle: vi.fn(() => ({})),
      }],
      ["tool", {
        registerTool: vi.fn(() => vi.fn()),
      }],
    ]);

    createShape1dPlugin().apply({
      hooks,
      services: {
        require: (name: string) => services.get(name),
      },
      config: {},
    } as never);
    hooks.elementPointerDoubleClick.call({
      hit: { target: { kind: "element", id: "line" } },
    });

    expect(activeSession.active).toMatchObject({
      kind: "line-point-edit",
      dependencies: {
        elements: {
          line: [
            "x",
            "y",
            "rotation",
            "scaleX",
            "scaleY",
            "parentGroupId",
            "data",
            "bindings",
            "locked",
          ],
        },
        groups: {
          parent: ["parentGroupId", "locked"],
        },
      },
    });

    const styleAfter = lineElement("line", "parent");
    styleAfter.style = { ...line.style, opacity: 0.5 };
    expect(activeSession.handleChange(summary(
      4,
      line,
      styleAfter,
      ["style"],
    ))).toMatchObject({ action: "continue" });
    expect(destroyOwner).not.toHaveBeenCalled();

    const pointsAfter = lineElement("line", "parent");
    if (
      pointsAfter.data.type !== "line"
      || line.data.type !== "line"
    ) {
      throw new Error("Expected line data.");
    }
    pointsAfter.data.points = [[0, 0], [40, 40]];
    expect(activeSession.handleChange(summary(
      5,
      styleAfter,
      pointsAfter,
      ["data"],
    ))).toMatchObject({
      action: "cancel",
      reason: "remote-element-fields-changed",
    });
    expect(destroyOwner).toHaveBeenCalledTimes(2);
    expect(activeSession.active).toBeNull();

    hooks.destroy.call();
  });
});
