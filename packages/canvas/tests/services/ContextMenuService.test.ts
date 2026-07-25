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

    const actions = service.getActions({
      scope: "selection",
      target: selection[0],
      targetElement: document.elements.element,
      targetGroup: null,
      selection,
      activeSelection: selection,
      resolvedSelection,
      resolvedActiveSelection: resolvedSelection,
      connectionId: null,
    });

    expect(provider).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: "element", id: "element" },
      targetElement: document.elements.element,
      selection,
      resolvedSelection,
    }));
    expect(actions.map((action) => action.id)).toEqual(["inspect"]);
  });

  test("sorts visible actions and unregisters providers idempotently", () => {
    const service = new ContextMenuService();
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
    expect(service.getActions(emptyContext)).toEqual([]);
  });

  test("delegates close to the active Cangine presenter", () => {
    const service = new ContextMenuService();
    const close = vi.fn();
    const release = service.setPresenter({ close });

    service.close();
    release();
    service.close();

    expect(close).toHaveBeenCalledOnce();
  });
});
