import {
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { ContextMenuService } from "../../src/services/context-menu/ContextMenuService";
import {
  fnResolveCanvasSelection,
} from "../../src/services/selection/fn.resolve-selection";
import {
  createCanvasDoc,
  createElement,
  createGroup,
} from "./crdt/helpers";

describe("ContextMenuService", () => {
  test("passes semantic targets and resolved product records to providers", () => {
    const service = new ContextMenuService();
    const document = createCanvasDoc({
      elements: { element: createElement("element") },
      groups: { group: createGroup("group") },
    });
    const selection = [
      { kind: "element", id: "element" },
      { kind: "group", id: "group" },
    ] as const;
    const resolvedSelection = fnResolveCanvasSelection({
      document,
      selection,
    });
    const provider = vi.fn(() => [{
      id: "inspect",
      label: "Inspect",
      onSelect: () => undefined,
    }]);
    service.registerProvider("test", provider);

    service.openAt({
      x: 12,
      y: 24,
      context: {
        scope: "selection",
        target: selection[0],
        targetElement: document.elements.element,
        targetGroup: null,
        selection,
        activeSelection: selection,
        resolvedSelection,
        resolvedActiveSelection: resolvedSelection,
        connectionId: null,
      },
    });

    expect(provider).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: "element", id: "element" },
      targetElement: document.elements.element,
      selection,
      resolvedSelection,
    }));
    expect(service.actions.map((action) => action.id)).toEqual(["inspect"]);
  });

  test("sorts visible actions and unregisters providers idempotently", () => {
    const service = new ContextMenuService();
    const providersChange = vi.fn();
    service.hooks.providersChange.tap(providersChange);
    const unregister = service.registerProvider("test", () => [
      { id: "z", label: "Zulu", priority: 10, onSelect: () => undefined },
      { id: "a", label: "Alpha", priority: 10, onSelect: () => undefined },
      {
        id: "hidden",
        label: "Hidden",
        hidden: true,
        onSelect: () => undefined,
      },
    ]);
    const emptyContext = {
      scope: "canvas",
      target: null,
      targetElement: null,
      targetGroup: null,
      selection: [],
      activeSelection: [],
      resolvedSelection: [],
      resolvedActiveSelection: [],
      connectionId: null,
    } as const;

    expect(service.getActions(emptyContext).map((action) => action.id))
      .toEqual(["a", "z"]);
    unregister();
    unregister();
    expect(providersChange).toHaveBeenCalledTimes(2);
  });

  test("uses a disabled fallback and closes without touching product state", () => {
    const service = new ContextMenuService();
    const stateChange = vi.fn();
    service.hooks.stateChange.tap(stateChange);

    service.openWithActionsAt({ x: 1, y: 2, actions: [] });
    expect(service.actions).toEqual([
      expect.objectContaining({ id: "no-actions", disabled: true }),
    ]);
    service.close();
    service.close();

    expect(service.open).toBe(false);
    expect(service.actions).toEqual([]);
    expect(stateChange).toHaveBeenCalledTimes(2);
  });
});
