import {
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  CanvasSelectionService,
  SelectionService,
} from "../../src/services";
import { fnApplyCanvasSelectionMode } from "../../src/services/selection/fn.semantic-selection";
import {
  createCanvasDoc,
  createElement,
  createGroup,
} from "./crdt/helpers";

const ELEMENT_A = { kind: "element", id: "a" } as const;
const ELEMENT_B = { kind: "element", id: "b" } as const;
const GROUP_A = { kind: "group", id: "a" } as const;

describe("SelectionService", () => {
  test("keeps the compatibility name on the renderer-neutral production owner", () => {
    expect(new CanvasSelectionService()).toBeInstanceOf(SelectionService);
  });

  test("applies ordered replace/add/toggle/remove operations", () => {
    expect(fnApplyCanvasSelectionMode([], ELEMENT_A, "replace"))
      .toEqual([ELEMENT_A]);
    expect(fnApplyCanvasSelectionMode([ELEMENT_A], ELEMENT_B, "add"))
      .toEqual([ELEMENT_A, ELEMENT_B]);
    expect(fnApplyCanvasSelectionMode(
      [ELEMENT_A, ELEMENT_B],
      ELEMENT_A,
      "toggle",
    )).toEqual([ELEMENT_B]);
    expect(fnApplyCanvasSelectionMode(
      [ELEMENT_A, ELEMENT_B],
      ELEMENT_A,
      "remove",
    )).toEqual([ELEMENT_B]);
  });

  test("keeps element and group targets with the same ID distinct", () => {
    const service = new SelectionService();
    service.setSelection([ELEMENT_A, GROUP_A, ELEMENT_A]);

    expect(service.selection).toEqual([ELEMENT_A, GROUP_A]);
  });

  test("focus is always null or a selected semantic target", () => {
    const service = new SelectionService();
    service.setSelection([ELEMENT_A, ELEMENT_B]);
    service.setFocusedTarget(ELEMENT_B);
    expect(service.focused).toEqual(ELEMENT_B);

    service.setSelection([ELEMENT_A]);
    expect(service.focused).toBeNull();
    expect(service.setFocusedTarget(ELEMENT_B)).toBe(false);
    expect(service.focused).toBeNull();
  });

  test("keeps content focus independently of ordinary canvas selection", () => {
    const service = new SelectionService();
    service.setSelection([ELEMENT_A]);
    service.setFocusedTarget(ELEMENT_B, { allowUnselected: true });

    expect(service.selection).toEqual([ELEMENT_A]);
    expect(service.focused).toEqual(ELEMENT_B);

    service.setSelection([]);
    expect(service.selection).toEqual([]);
    expect(service.focused).toEqual(ELEMENT_B);

    service.prune(new Set(["element:a"]));
    expect(service.focused).toBeNull();
  });

  test("resolves and prunes selection from product document data", () => {
    const service = new SelectionService();
    const document = createCanvasDoc({
      elements: { a: createElement("a") },
      groups: { a: createGroup("a") },
    });
    service.setSelection([ELEMENT_A, ELEMENT_B, GROUP_A]);
    service.setFocusedTarget(ELEMENT_B);

    expect(service.resolveSelection(document).map((item) => item.target))
      .toEqual([ELEMENT_A, GROUP_A]);
    service.pruneDocument(document);

    expect(service.selection).toEqual([ELEMENT_A, GROUP_A]);
    expect(service.focused).toBeNull();
  });

  test("emits immutable snapshots only for observable changes", () => {
    const service = new SelectionService();
    const listener = vi.fn();
    service.hooks.change.tap(listener);

    service.setSelection([ELEMENT_A]);
    service.setSelection([{ ...ELEMENT_A }]);
    service.setFocusedTarget(ELEMENT_A);
    service.clear();
    service.clear();

    expect(listener).toHaveBeenCalledTimes(3);
    const snapshot = listener.mock.calls[0]?.[0];
    expect(snapshot.selection).toEqual([ELEMENT_A]);
    expect(snapshot.selection).not.toBe(service.selection);
  });

  test("uses an injected clock for bounded selection suppression", () => {
    let now = 100;
    const service = new SelectionService({ now: () => now });

    service.suppressSelectionHandling(50);
    expect(service.isSelectionHandlingSuppressed()).toBe(true);
    now = 151;
    expect(service.isSelectionHandlingSuppressed()).toBe(false);
  });
});
