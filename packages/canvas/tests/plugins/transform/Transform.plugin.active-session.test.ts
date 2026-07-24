import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasProductTransformEvent } from "../../../src/engine/product-runtime/typed";
import { createTransformPlugin } from "../../../src/plugins/transform/Transform.plugin";
import { CanvasActiveSessionService } from "../../../src/services/active-session/CanvasActiveSessionService";
import type {
  TCrdtChangeSummary,
  TCrdtEntityChangeSet,
} from "../../../src/services/crdt/CrdtService";
import { SelectionService } from "../../../src/services/selection/SelectionService";
import { describe, expect, it, vi } from "vitest";
import { ensureDom } from "../../test-setup";
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

function updated(
  id: string,
  before: TElement,
  after: TElement,
  changedFields: string[],
): TCrdtEntityChangeSet<TElement> {
  return {
    added: [],
    updated: [id],
    deleted: [],
    changes: {
      [id]: {
        kind: "updated",
        before,
        after,
        changedFields,
      },
    },
  };
}

function summary(
  revision: number,
  elements: TCrdtEntityChangeSet<TElement>,
): TCrdtChangeSummary {
  return {
    revision,
    origin: "remote",
    fullReload: false,
    elements,
    groups: emptyChanges(),
  };
}

function transformBegin(): TCanvasProductTransformEvent {
  const transform = {
    position: { x: 10, y: 20 },
    rotationRadians: 0,
    scale: { x: 1, y: 1 },
    skew: { x: 0, y: 0 },
    origin: { x: 0, y: 0 },
  };
  return {
    type: "transform-begin",
    gestureId: "gesture-1",
    handle: "move",
    pointerId: 1,
    proposals: [{
      target: { kind: "element", id: "target" },
      previousTransform: transform,
      nextTransform: {
        ...transform,
        position: { x: 30, y: 40 },
      },
    }],
    worldPointer: { x: 30, y: 40 },
    modifiers: {
      alt: false,
      control: false,
      meta: false,
      shift: false,
    },
  };
}

describe("Transform plugin active-session policy", () => {
  it("continues disjoint remote updates and cancels transform-basis conflicts", () => {
    ensureDom();
    const before = createElement("target", { parentGroupId: "parent" });
    const canvasDocument = createCanvasDoc({
      elements: {
        target: before,
        unrelated: createElement("unrelated"),
      },
      groups: {
        parent: createGroup("parent"),
      },
    });
    const activeSession = new CanvasActiveSessionService();
    const selection = new SelectionService({ now: () => 0 });
    const init = new TestHook<[]>();
    const destroy = new TestHook<[]>();
    const projection = new TestHook<[never]>();
    const elementsChange = new TestHook<[]>();
    let transformListener:
      | ((event: TCanvasProductTransformEvent) => void)
      | null = null;
    const cancelForRemoteChange = vi.fn();
    const services = new Map<string, unknown>([
      ["activeSession", activeSession],
      ["crdt", {
        doc: () => canvasDocument,
        revision: 4,
      }],
      ["element", {
        hooks: { elementsChange },
        getTransformPolicy: vi.fn(),
      }],
      ["history", {}],
      ["scene", {
        container: document.createElement("div"),
        hooks: { projection },
        product: {
          transforms: {
            cancelForRemoteChange,
            setClonePlanProvider: vi.fn(() => vi.fn()),
            setSelection: vi.fn(),
            subscribe: vi.fn((listener) => {
              transformListener = listener;
              return vi.fn();
            }),
          },
        },
      }],
      ["selection", selection],
    ]);

    createTransformPlugin().apply({
      hooks: { init, destroy },
      services: {
        require: (name: string) => services.get(name),
      },
      config: {},
    } as never);
    init.call();
    if (transformListener === null) {
      throw new Error("Transform listener was not registered.");
    }

    transformListener(transformBegin());
    expect(activeSession.active?.dependencies).toEqual({
      elements: {
        target: [
          "x",
          "y",
          "rotation",
          "scaleX",
          "scaleY",
          "parentGroupId",
          "data",
          "locked",
        ],
      },
      groups: {
        parent: ["parentGroupId", "locked"],
      },
    });

    const styleAfter = createElement("target", {
      ...before,
      style: { ...before.style, opacity: 0.5 },
    });
    expect(activeSession.handleChange(summary(
      5,
      updated("target", before, styleAfter, ["style"]),
    ))).toMatchObject({ action: "continue" });
    expect(cancelForRemoteChange).not.toHaveBeenCalled();

    const unrelatedBefore = canvasDocument.elements.unrelated!;
    const unrelatedAfter = createElement("unrelated", {
      ...unrelatedBefore,
      x: 100,
    });
    expect(activeSession.handleChange(summary(
      6,
      updated(
        "unrelated",
        unrelatedBefore,
        unrelatedAfter,
        ["x"],
      ),
    ))).toMatchObject({ action: "continue" });

    const geometryAfter = createElement("target", {
      ...styleAfter,
      x: 100,
    });
    expect(activeSession.handleChange(summary(
      7,
      updated("target", styleAfter, geometryAfter, ["x"]),
    ))).toMatchObject({
      action: "cancel",
      reason: "remote-element-fields-changed",
    });
    expect(cancelForRemoteChange).toHaveBeenCalledOnce();
    expect(activeSession.active).toBeNull();

    destroy.call();
  });
});
