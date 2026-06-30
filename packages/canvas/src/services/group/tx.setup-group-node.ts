import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { TCrdtBuilder, TCrdtRecordedOp } from "../../services/crdt/fxBuilder";
import type { CrdtService } from "../../services/crdt/CrdtService";
import type { HistoryService } from "../../services/history/HistoryService";
import type { LoggingService } from "../../services/logging/LoggingService";
import type { SelectionService } from "../../services/selection/SelectionService";
import type { IRuntimeHooks, TElementPointerEvent } from "../../types";
import { fnSerializeSubtreeElements } from "./fn.serialize-subtree-elements";
import type { ElementService } from "../element/ElementService";
import { txSyncWidgetDomPortals } from "../widget/tx.sync-widget-dom-portals";

type TGroupDragMetrics = {
  startedAt: number;
  moveEvents: number;
  serializeCalls: number;
  serializeMs: number;
  boundaryCalls: number;
  boundaryMs: number;
  moveCommitCount: number;
  moveCommitMs: number;
  moveCommitKinds: Record<string, number>;
  finalCommitMs: number;
  finalCommitKinds: Record<string, number>;
  descendantCount: number;
  totalPenPoints: number;
  elementTypes: Record<string, number>;
};

const GROUP_LOG_TARGET = {
  kind: "plugin",
  name: "group",
} as const;

function fxCollectGroupElementTypes(elements: TElement[]) {
  return elements.reduce<Record<string, number>>((acc, element) => {
    const type = element.data.type;
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});
}

function fxCountGroupPenPoints(elements: TElement[]) {
  return elements.reduce((total, element) => {
    if (element.data.type !== "pen") {
      return total;
    }

    return total + element.data.points.length;
  }, 0);
}

function fxRecordGroupOpKinds(counts: Record<string, number>, kinds: string[]) {
  kinds.forEach((kind) => {
    counts[kind] = (counts[kind] ?? 0) + 1;
  });
}

function fxQueueGroupMovePatches(args: {
  builder: TCrdtBuilder;
  elements: TElement[];
}) {
  args.elements.forEach((element) => {
    args.builder.patchElement(element.id, "x", element.x);
    args.builder.patchElement(element.id, "y", element.y);
    args.builder.patchElement(element.id, "updatedAt", element.updatedAt);
  });
}

function fxGetGroupMoveOpKinds(ops: TCrdtRecordedOp[]) {
  return ops.map((op) => {
    if (op.kind !== "set-entity-path") {
      return op.kind;
    }

    return `${op.kind}:${op.path.join(".")}`;
  });
}

function fxRoundGroupMetric(value: number) {
  return Math.round(value * 100) / 100;
}

export type TPortalSetupGroupNode = {
  crdt: CrdtService;
  element: ElementService;
  history: HistoryService;
  logging: LoggingService;
  selection: SelectionService;
  hooks: IRuntimeHooks;
  Shape: typeof Konva.Shape;
  refreshBoundaries: () => void;
  startCloneDrag: (group: Konva.Group) => void;
  createThrottledPatch: (callback: (elements: TElement[]) => void) => (elements: TElement[]) => void;
  now: () => number;
};

export type TArgsSetupGroupNode = {
  group: Konva.Group;
};

export function txSetupGroupNode(
  portal: TPortalSetupGroupNode,
  args: TArgsSetupGroupNode,
) {
  if (args.group.getAttr("vcGroupNodeSetup") === true) {
    return args.group;
  }

  args.group.setAttr("vcGroupNodeSetup", true);
  args.group.draggable(true);

  let beforeElements: TElement[] = [];
  let isCloneDrag = false;
  let dragMetrics: TGroupDragMetrics | null = null;

  const fxIsGroupLoggingEnabled = (level: 1 | 2 | 3) => {
    return portal.logging.isEnabled({
      ...GROUP_LOG_TARGET,
      level,
    });
  };

  const fxLogGroupDragSummary = (didMove: boolean, reason: string) => {
    if (!dragMetrics || !fxIsGroupLoggingEnabled(1)) {
      dragMetrics = null;
      return;
    }

    portal.logging.log({
      ...GROUP_LOG_TARGET,
      level: 1,
      event: "group-drag-summary",
      payload: {
        groupId: args.group.id(),
        didMove,
        reason,
        durationMs: fxRoundGroupMetric(portal.now() - dragMetrics.startedAt),
        descendantCount: dragMetrics.descendantCount,
        elementTypes: dragMetrics.elementTypes,
        totalPenPoints: dragMetrics.totalPenPoints,
        moveEvents: dragMetrics.moveEvents,
        serializeCalls: dragMetrics.serializeCalls,
        serializeMs: fxRoundGroupMetric(dragMetrics.serializeMs),
        boundaryCalls: dragMetrics.boundaryCalls,
        boundaryMs: fxRoundGroupMetric(dragMetrics.boundaryMs),
        moveCommitCount: dragMetrics.moveCommitCount,
        moveCommitMs: fxRoundGroupMetric(dragMetrics.moveCommitMs),
        moveCommitKinds: dragMetrics.moveCommitKinds,
        finalCommitMs: fxRoundGroupMetric(dragMetrics.finalCommitMs),
        finalCommitKinds: dragMetrics.finalCommitKinds,
      },
    });

    dragMetrics = null;
  };

  const throttledPatch = portal.createThrottledPatch((elements) => {
    const commitStartedAt = dragMetrics ? portal.now() : 0;
    const builder = portal.crdt.build();
    fxQueueGroupMovePatches({
      builder,
      elements,
    });
    const commitResult = builder.commit();

    if (dragMetrics && fxIsGroupLoggingEnabled(2)) {
      portal.logging.log({
        ...GROUP_LOG_TARGET,
        level: 2,
        event: "group-drag-move-commit",
        payload: {
          groupId: args.group.id(),
          elementCount: elements.length,
          elementTypes: fxCollectGroupElementTypes(elements),
          opKinds: fxGetGroupMoveOpKinds(commitResult.redoOps),
        },
      });
    }

    if (!dragMetrics) {
      return;
    }

    dragMetrics.moveCommitCount += 1;
    dragMetrics.moveCommitMs += portal.now() - commitStartedAt;
    fxRecordGroupOpKinds(dragMetrics.moveCommitKinds, fxGetGroupMoveOpKinds(commitResult.redoOps));
  });

  args.group.off("pointerclick pointerdown dragstart pointerdblclick dragmove dragend transform");

  args.group.on("pointerclick", (event) => {
    if (portal.selection.mode !== "select") {
      return;
    }

    portal.hooks.elementPointerClick.call(event as TElementPointerEvent);
  });

  args.group.on("pointerdown dragstart", (event) => {
    if (portal.selection.mode !== "select") {
      try {
        if (args.group.isDragging()) {
          args.group.stopDrag();
        }
      } catch {
        return;
      }
      return;
    }

    if (event.type === "pointerdown") {
      const earlyExit = portal.hooks.elementPointerDown.call(event as TElementPointerEvent);
      if (earlyExit) {
        event.cancelBubble = true;
      }
      return;
    }

    if (event.evt?.altKey) {
      isCloneDrag = true;
      try {
        if (args.group.isDragging()) {
          args.group.stopDrag();
        }
      } catch {
        return;
      }
      portal.startCloneDrag(args.group);
      return;
    }

    beforeElements = fnSerializeSubtreeElements({
      element: portal.element,
      Shape: portal.Shape,
      group: args.group,
    }).map((element) => structuredClone(element));

    dragMetrics = fxIsGroupLoggingEnabled(1)
      ? {
        startedAt: portal.now(),
        moveEvents: 0,
        serializeCalls: 0,
        serializeMs: 0,
        boundaryCalls: 0,
        boundaryMs: 0,
        moveCommitCount: 0,
        moveCommitMs: 0,
        moveCommitKinds: {},
        finalCommitMs: 0,
        finalCommitKinds: {},
        descendantCount: beforeElements.length,
        totalPenPoints: fxCountGroupPenPoints(beforeElements),
        elementTypes: fxCollectGroupElementTypes(beforeElements),
      }
      : null;

    if (dragMetrics && fxIsGroupLoggingEnabled(2)) {
      portal.logging.log({
        ...GROUP_LOG_TARGET,
        level: 2,
        event: "group-drag-start",
        payload: {
          groupId: args.group.id(),
          descendantCount: dragMetrics.descendantCount,
          elementTypes: dragMetrics.elementTypes,
          totalPenPoints: dragMetrics.totalPenPoints,
        },
      });
    }
  });

  args.group.on("pointerdblclick", (event) => {
    if (portal.selection.mode !== "select") {
      return;
    }

    const earlyExit = portal.hooks.elementPointerDoubleClick.call(event as TElementPointerEvent);
    if (earlyExit) {
      event.cancelBubble = true;
    }
  });

  args.group.on("dragmove", () => {
    txSyncWidgetDomPortals({}, { node: args.group });

    if (isCloneDrag) {
      isCloneDrag = false;
      return;
    }

    if (dragMetrics) {
      dragMetrics.moveEvents += 1;
      const boundaryStartedAt = portal.now();
      portal.refreshBoundaries();
      dragMetrics.boundaryCalls += 1;
      dragMetrics.boundaryMs += portal.now() - boundaryStartedAt;

      const serializeStartedAt = portal.now();
      const elements = fnSerializeSubtreeElements({
        element: portal.element,
        Shape: portal.Shape,
        group: args.group,
      });
      dragMetrics.serializeCalls += 1;
      dragMetrics.serializeMs += portal.now() - serializeStartedAt;
      throttledPatch(elements);
      return;
    }

    portal.refreshBoundaries();
    throttledPatch(fnSerializeSubtreeElements({
      element: portal.element,
      Shape: portal.Shape,
      group: args.group,
    }));
  });

  args.group.on("transform", () => {
    txSyncWidgetDomPortals({}, { node: args.group });
    portal.refreshBoundaries();
  });

  args.group.on("dragend", () => {
    txSyncWidgetDomPortals({}, { node: args.group });

    if (isCloneDrag) {
      isCloneDrag = false;
      beforeElements = [];
      dragMetrics = null;
      return;
    }

    const afterElements = fnSerializeSubtreeElements({
      element: portal.element,
      Shape: portal.Shape,
      group: args.group,
    }).map((element) => structuredClone(element));
    const finalCommitStartedAt = dragMetrics ? portal.now() : 0;
    const dragCommitResult = (() => {
      const builder = portal.crdt.build();
      fxQueueGroupMovePatches({
        builder,
        elements: afterElements,
      });
      return builder.commit();
    })();

    if (dragMetrics && fxIsGroupLoggingEnabled(2)) {
      portal.logging.log({
        ...GROUP_LOG_TARGET,
        level: 2,
        event: "group-drag-final-commit",
        payload: {
          groupId: args.group.id(),
          elementCount: afterElements.length,
          elementTypes: fxCollectGroupElementTypes(afterElements),
          opKinds: fxGetGroupMoveOpKinds(dragCommitResult.redoOps),
        },
      });
    }

    if (dragMetrics) {
      dragMetrics.finalCommitMs += portal.now() - finalCommitStartedAt;
      fxRecordGroupOpKinds(dragMetrics.finalCommitKinds, fxGetGroupMoveOpKinds(dragCommitResult.redoOps));
    }

    if (beforeElements.length === 0 || afterElements.length === 0) {
      beforeElements = [];
      fxLogGroupDragSummary(false, "empty-elements");
      return;
    }

    const beforeById = new Map(beforeElements.map((element) => [element.id, element]));
    const didMove = afterElements.some((element) => {
      const before = beforeById.get(element.id);
      return before && (before.x !== element.x || before.y !== element.y);
    });

    if (!didMove) {
      beforeElements = [];
      fxLogGroupDragSummary(false, "no-position-change");
      return;
    }

    const undoElements = beforeElements.map((element) => structuredClone(element));
    const redoElements = afterElements.map((element) => structuredClone(element));
    beforeElements = [];

    if (dragMetrics) {
      const boundaryStartedAt = portal.now();
      portal.refreshBoundaries();
      dragMetrics.boundaryCalls += 1;
      dragMetrics.boundaryMs += portal.now() - boundaryStartedAt;
    } else {
      portal.refreshBoundaries();
    }

    portal.history.record({
      label: "drag-group",
      undo() {
        undoElements.forEach((element) => {
          portal.element.updateElement(element);
        });
        dragCommitResult.rollback();
      },
      redo() {
        redoElements.forEach((element) => {
          portal.element.updateElement(element);
        });
        portal.crdt.applyOps({ ops: dragCommitResult.redoOps });
      },
    });

    fxLogGroupDragSummary(true, "history-recorded");
  });

  return args.group;
}
