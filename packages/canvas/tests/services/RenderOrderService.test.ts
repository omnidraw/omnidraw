import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import { VC_NODE_KIND_ATTR } from "../../src/core/CONSTANTS";
import { fnCreateOrderedZIndex } from "../../src/core/fn.create-ordered-z-index";
import { RenderOrderService } from "../../src/services/render-order/RenderOrderService";

type TNodeKind = "element" | "group" | null;

function setup(args?: {
  elements?: string[];
  groups?: string[];
}) {
  const staticForegroundLayer = new Konva.Layer();
  const history = {
    record: vi.fn(),
  };
  const patchElement = vi.fn();
  const patchGroup = vi.fn();
  const commit = vi.fn();
  const syncDomOrder = vi.fn();
  const nodeKinds = new Map<string, TNodeKind>();
  const docElements = Object.fromEntries((args?.elements ?? []).map((id) => [id, { id }]));
  const docGroups = Object.fromEntries((args?.groups ?? []).map((id) => [id, { id }]));

  const canvasRegistry = {
    getNodeType: (node: Konva.Node) => {
      const kind = nodeKinds.get(node.id()) ?? "element";
      if (kind === "group") {
        return "group";
      }
      if (kind === "element") {
        return "text";
      }
      return null;
    },
  };

  const service = new RenderOrderService({
    crdt: {
      doc: () => ({ elements: docElements, groups: docGroups }),
      build: () => ({ patchElement, patchGroup, commit }),
    } as unknown as RenderOrderService["crdt"],
    history: history as unknown as RenderOrderService["history"],
    scene: { staticForegroundLayer } as unknown as RenderOrderService["scene"],
    canvasRegistry: canvasRegistry as unknown as RenderOrderService["canvasRegistry"],
    syncDomOrder,
  });

  return { staticForegroundLayer, history, patchElement, patchGroup, commit, syncDomOrder, nodeKinds, service };
}

describe("RenderOrderService", () => {
  test("assignOrderOnInsert ignores nodes from another parent and nodes without ids in persisted patches", () => {
    const { staticForegroundLayer, patchElement, commit, service } = setup({ elements: ["a"] });
    const otherParent = new Konva.Group({ id: "other-parent" });
    const a = new Konva.Rect({ id: "a" });
    const blank = new Konva.Rect();
    const external = new Konva.Rect({ id: "external" });

    staticForegroundLayer.add(a);
    staticForegroundLayer.add(blank);
    otherParent.add(external);

    const result = service.assignOrderOnInsert({
      parent: staticForegroundLayer,
      nodes: [external, blank, a],
      position: "back",
    });

    expect(staticForegroundLayer.getChildren().map((node) => node.id())).toEqual(["a", ""]);
    expect(result).toEqual([{ id: "a", zIndex: fnCreateOrderedZIndex(0) }]);
    expect(patchElement).toHaveBeenCalledOnce();
    expect(patchElement).toHaveBeenCalledWith("a", "zIndex", fnCreateOrderedZIndex(0));
    expect(commit).toHaveBeenCalledOnce();
  });

  test("moveSelectionUp and moveSelectionDown record history and preserve grouped bundles", () => {
    const { staticForegroundLayer, history, patchElement, commit, service } = setup({ elements: ["a", "b", "c", "d"] });
    const a = new Konva.Rect({ id: "a" });
    const b = new Konva.Rect({ id: "b" });
    const c = new Konva.Rect({ id: "c" });
    const d = new Konva.Rect({ id: "d" });

    staticForegroundLayer.add(a);
    staticForegroundLayer.add(b);
    staticForegroundLayer.add(c);
    staticForegroundLayer.add(d);
    service.assignOrderOnInsert({ parent: staticForegroundLayer, nodes: [a, b, c, d], position: "back" });
    patchElement.mockClear();
    commit.mockClear();

    service.registerBundleResolver("bc", (node) => {
      if (node.id() !== "b" && node.id() !== "c") {
        return null;
      }
      return [b, c];
    });

    service.moveSelectionUp([b]);
    expect(staticForegroundLayer.getChildren().map((node) => node.id())).toEqual(["b", "c", "a", "d"]);

    service.moveSelectionDown([b]);
    expect(staticForegroundLayer.getChildren().map((node) => node.id())).toEqual(["b", "c", "a", "d"]);

    expect(history.record).toHaveBeenCalledTimes(2);
    const firstRecord = history.record.mock.calls[0]?.[0];
    expect(firstRecord.label).toBe("render-order");

    firstRecord.undo();
    expect(staticForegroundLayer.getChildren().map((node) => node.id())).toEqual(["a", "b", "c", "d"]);
    firstRecord.redo();
    expect(staticForegroundLayer.getChildren().map((node) => node.id())).toEqual(["b", "c", "a", "d"]);
    expect(patchElement).toHaveBeenCalled();
    expect(commit).toHaveBeenCalled();
  });

  test("bringSelectionToFront and sendSelectionToBack handle duplicates and mixed parents safely", () => {
    const { staticForegroundLayer, history, service } = setup({ elements: ["a", "b", "c"] });
    const otherParent = new Konva.Group({ id: "other-parent" });
    const a = new Konva.Rect({ id: "a" });
    const b = new Konva.Rect({ id: "b" });
    const c = new Konva.Rect({ id: "c" });
    const external = new Konva.Rect({ id: "external" });

    staticForegroundLayer.add(a);
    staticForegroundLayer.add(b);
    staticForegroundLayer.add(c);
    otherParent.add(external);
    service.assignOrderOnInsert({ parent: staticForegroundLayer, nodes: [a, b, c], position: "back" });

    service.bringSelectionToFront([b, b]);
    expect(staticForegroundLayer.getChildren().map((node) => node.id())).toEqual(["a", "c", "b"]);

    service.sendSelectionToBack([external, b]);
    expect(staticForegroundLayer.getChildren().map((node) => node.id())).toEqual(["a", "c", "b"]);
    expect(history.record).toHaveBeenCalledTimes(1);
  });

  test("snapshot and restore work for both layer and group parents and group patches persist separately", () => {
    const { staticForegroundLayer, nodeKinds, patchElement, patchGroup, commit, service } = setup({ elements: ["shape-1"], groups: ["group-1"] });
    const host = new Konva.Group({ id: "host" });
    const shape = new Konva.Rect({ id: "shape-1" });
    const groupNode = new Konva.Group({ id: "group-1" });

    nodeKinds.set("group-1", "group");
    staticForegroundLayer.add(host);
    host.add(shape);
    host.add(groupNode);
    groupNode.setAttr(VC_NODE_KIND_ATTR, "group");

    service.assignOrderOnInsert({ parent: host, nodes: [shape, groupNode], position: "back" });
    expect(patchElement).toHaveBeenCalledWith("shape-1", "zIndex", fnCreateOrderedZIndex(0));
    expect(patchGroup).toHaveBeenCalledWith("group-1", "zIndex", fnCreateOrderedZIndex(1));
    expect(commit).toHaveBeenCalledOnce();

    const snapshot = service.snapshotParentOrder(host);
    expect(snapshot).toEqual({
      parentId: "host",
      items: [
        { id: "shape-1", zIndex: fnCreateOrderedZIndex(0), kind: "element" },
        { id: "group-1", zIndex: fnCreateOrderedZIndex(1), kind: "group" },
      ],
    });

    service.sendSelectionToBack([groupNode]);
    expect(host.getChildren().map((node) => node.id())).toEqual(["group-1", "shape-1"]);

    service.restoreParentOrder(snapshot);
    expect(host.getChildren().map((node) => node.id())).toEqual(["shape-1", "group-1"]);
  });

  test("sortChildren uses persisted zIndex then id tie-breaker and syncs dom order", () => {
    const { staticForegroundLayer, syncDomOrder, service } = setup();
    const b = new Konva.Rect({ id: "b" });
    const a = new Konva.Rect({ id: "a" });
    const c = new Konva.Rect({ id: "c" });

    staticForegroundLayer.add(b);
    staticForegroundLayer.add(a);
    staticForegroundLayer.add(c);

    service.setNodeZIndex(b, fnCreateOrderedZIndex(1));
    service.setNodeZIndex(a, fnCreateOrderedZIndex(1));
    service.setNodeZIndex(c, fnCreateOrderedZIndex(0));

    expect(service.getOrderedSiblings(staticForegroundLayer).map((node) => node.id())).toEqual(["c", "a", "b"]);

    service.sortChildren(staticForegroundLayer);
    expect(staticForegroundLayer.getChildren().map((node) => node.id())).toEqual(["c", "a", "b"]);
    expect(syncDomOrder).toHaveBeenCalledTimes(1);
  });
});
