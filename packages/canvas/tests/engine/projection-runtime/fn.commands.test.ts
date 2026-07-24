import type {
  TGroupNode,
  TSceneNode,
  TTransform2D,
} from "@omnidraw/cangine";
import {
  describe,
  expect,
  it,
} from "vitest";
import type {
  TCanvasDocumentProjection,
} from "../../../src/engine/typed";
import { fnDiffCanvasProjections } from "../../../src/engine/projection/fn.diff";
import { fnCanvasProjectionCommands } from "../../../src/engine/projection-runtime/fn.commands";

const IDENTITY: TTransform2D = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

function node(
  id: string,
  parentId: string | null,
  orderKey: string,
): TGroupNode {
  return {
    id,
    kind: "group",
    parentId,
    orderKey,
    transform: IDENTITY,
  };
}

function projection(
  nodes: readonly TSceneNode[],
  signature: string,
): TCanvasDocumentProjection {
  return {
    snapshot: {
      schemaVersion: "1.0.0",
      rootLayerIds: [],
      nodes: [...nodes],
    },
    resources: [],
    portals: [],
    diagnostics: [],
    signature,
    index: {
      elementNodeIds: {},
      groupNodeIds: {},
      nodeTargets: {},
      elementResourceIds: {},
      elementPortalIds: {},
      elementSignatures: {},
      groupSignatures: {},
      activeProjectionSignature: signature,
      lastAppliedRevision: 1,
    },
  };
}

describe("fnCanvasProjectionCommands", () => {
  it("orders removals child-first and all add/update upserts parent-first", () => {
    const previous = projection([
      node("root", null, "A"),
      node("kept-parent", "root", "A"),
      node("moving", "kept-parent", "A"),
      node("removed-parent", "root", "B"),
      node("removed-child", "removed-parent", "A"),
    ], "previous");
    const next = projection([
      node("root", null, "A"),
      node("kept-parent", "root", "A"),
      node("added-parent", "root", "B"),
      node("added-child", "added-parent", "A"),
      node("moving", "added-parent", "Z"),
    ], "next");
    const diff = fnDiffCanvasProjections({ previous, next });

    const commands = fnCanvasProjectionCommands({ previous, next, diff });

    expect(commands.map((command) => {
      return command.type === "remove" ? `remove:${command.nodeId}` : `upsert:${command.node.id}`;
    })).toEqual([
      "remove:removed-child",
      "remove:removed-parent",
      "upsert:added-parent",
      "upsert:added-child",
      "upsert:moving",
    ]);
    expect(commands.slice(0, 2)).toEqual([
      { type: "remove", nodeId: "removed-child", descendants: "remove" },
      { type: "remove", nodeId: "removed-parent", descendants: "remove" },
    ]);
    expect(commands.at(-1)).toEqual({
      type: "upsert",
      node: expect.objectContaining({
        id: "moving",
        parentId: "added-parent",
        orderKey: "Z",
      }),
    });
  });

  it("is deterministic and represents reorder-only updates as complete upserts", () => {
    const previous = projection([
      node("root", null, "A"),
      node("one", "root", "A"),
      node("two", "root", "B"),
    ], "previous");
    const next = projection([
      node("root", null, "A"),
      node("one", "root", "Z"),
      node("two", "root", "B"),
    ], "next");
    const diff = fnDiffCanvasProjections({ previous, next });

    const first = fnCanvasProjectionCommands({ previous, next, diff });
    const second = fnCanvasProjectionCommands({ previous, next, diff });

    expect(first).toEqual(second);
    expect(first).toEqual([{
      type: "upsert",
      node: expect.objectContaining({
        id: "one",
        parentId: "root",
        orderKey: "Z",
      }),
    }]);
  });
});
