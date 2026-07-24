import type { TSceneNode } from "@vibecanvas/canvas-engine";
import type {
  TCanvasDoc,
  TElement,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { CANVAS_ENGINE_LAYER_IDS } from "../CONSTANTS";
import type {
  TCanvasDocumentProjection,
  TCanvasElementProjection,
  TCanvasProjectedPortal,
  TCanvasProjectedResource,
  TCanvasProjectionCollectionDiff,
  TCanvasProjectionDependencies,
  TCanvasProjectionDiagnostic,
  TCanvasProjectionDiagnosticCode,
  TCanvasProjectionDiff,
  TCanvasProjectionIndex,
  TCanvasProjectionTheme,
} from "../typed";
import type { ProjectionRegistry } from "./ProjectionRegistry";
import { fnUpdateCanvasDocumentProjectionSignature } from "./fn.document-signature";
import { fnFreezeCanvasProjectionValue } from "./fn.freeze";
import { fnCanvasEngineGroupId } from "./fn.ids";
import {
  fnCompareCanvasElements,
  fnProjectCanvasElement,
} from "./fn.project-document";
import { fnCanvasProjectionSignature } from "./fn.signature";

export type TCanvasIncrementalElementChanges = {
  added: readonly string[];
  updated: readonly string[];
  deleted: readonly string[];
};

type TForcedPlaceholder = {
  code: Extract<
    TCanvasProjectionDiagnosticCode,
    "PORTAL_REGISTRATION_FAILED" | "RESOURCE_PRELOAD_FAILED"
  >;
  message: string;
};

type TArgsProjectCanvasDocumentIncremental = {
  previous: TCanvasDocumentProjection;
  document: TCanvasDoc;
  changes: TCanvasIncrementalElementChanges;
  registry: ProjectionRegistry;
  theme: TCanvasProjectionTheme;
  dependencies: TCanvasProjectionDependencies;
  revision: number;
  forcedPlaceholders?: Readonly<Record<string, TForcedPlaceholder>>;
};

function fnChangedElementIds(changes: TCanvasIncrementalElementChanges) {
  return [...new Set([
    ...changes.added,
    ...changes.updated,
    ...changes.deleted,
  ])].sort();
}

function fnElementParentNodeId(
  element: TElement,
  groupIds: ReadonlySet<string>,
) {
  const fullscreenWidget = (
    element.data.type === "ui-widget"
    || element.data.type === "widget-instance"
  ) && element.data.window === "fullscreen";
  if (fullscreenWidget) {
    return CANVAS_ENGINE_LAYER_IDS.overlay;
  }
  return element.parentGroupId !== null && groupIds.has(element.parentGroupId)
    ? fnCanvasEngineGroupId({ id: element.parentGroupId })
    : CANVAS_ENGINE_LAYER_IDS.content;
}

function fnCollectionDiff<T>(args: {
  previous: readonly T[];
  next: readonly T[];
  id(value: T): string;
}): TCanvasProjectionCollectionDiff<T> {
  const previousById = new Map(args.previous.map((value) => {
    return [args.id(value), value];
  }));
  const nextById = new Map(args.next.map((value) => {
    return [args.id(value), value];
  }));
  return {
    added: args.next.filter((value) => {
      return !previousById.has(args.id(value));
    }),
    updated: args.next.filter((value) => {
      const previous = previousById.get(args.id(value));
      return previous !== undefined
        && fnCanvasProjectionSignature({ value: previous })
          !== fnCanvasProjectionSignature({ value });
    }),
    removed: [...args.previous].reverse().flatMap((value) => {
      const id = args.id(value);
      return nextById.has(id) ? [] : [id];
    }),
  };
}

function fnHasCollectionChanges<T>(
  diff: TCanvasProjectionCollectionDiff<T>,
) {
  return diff.added.length > 0
    || diff.updated.length > 0
    || diff.removed.length > 0;
}

function fnFreezeRecord<T>(
  value: Record<string, T>,
): Readonly<Record<string, T>> {
  return Object.freeze(value);
}

function fnSameStrings(
  left: readonly string[] | undefined,
  right: readonly string[],
) {
  return left !== undefined
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function fnPatchStringArrayRecord(args: {
  previous: Readonly<Record<string, readonly string[]>>;
  changedIds: readonly string[];
  next(id: string): readonly string[] | undefined;
}) {
  const changed = args.changedIds.some((id) => {
    const next = args.next(id);
    const previous = args.previous[id];
    return next === undefined
      ? previous !== undefined
      : !fnSameStrings(previous, next);
  });
  if (!changed) {
    return args.previous;
  }
  const patched: Record<string, readonly string[]> = {
    ...args.previous,
  };
  for (const id of args.changedIds) {
    const next = args.next(id);
    if (next === undefined) {
      delete patched[id];
    } else {
      patched[id] = Object.freeze([...next]);
    }
  }
  return fnFreezeRecord(patched);
}

function fnPatchStringRecord(args: {
  previous: Readonly<Record<string, string>>;
  changedIds: readonly string[];
  next(id: string): string | undefined;
}) {
  const changed = args.changedIds.some((id) => {
    return args.previous[id] !== args.next(id);
  });
  if (!changed) {
    return args.previous;
  }
  const patched: Record<string, string> = {
    ...args.previous,
  };
  for (const id of args.changedIds) {
    const next = args.next(id);
    if (next === undefined) {
      delete patched[id];
    } else {
      patched[id] = next;
    }
  }
  return fnFreezeRecord(patched);
}

function fnPatchCollection<T>(args: {
  previous: readonly T[];
  previousChangedIds: ReadonlySet<string>;
  nextChanged: readonly T[];
  id(value: T): string;
}) {
  if (args.previousChangedIds.size === 0 && args.nextChanged.length === 0) {
    return {
      all: args.previous,
      previousChanged: [] as T[],
    };
  }
  if (args.previousChangedIds.size === 0) {
    return {
      all: Object.freeze(args.previous.concat(args.nextChanged)),
      previousChanged: [] as T[],
    };
  }
  const replacements = new Map(args.nextChanged.map((value) => {
    return [args.id(value), value];
  }));
  const all: T[] = [];
  const previousChanged: T[] = [];
  for (const value of args.previous) {
    const id = args.id(value);
    if (!args.previousChangedIds.has(id)) {
      all.push(value);
      continue;
    }
    previousChanged.push(value);
    const replacement = replacements.get(id);
    if (replacement !== undefined) {
      all.push(replacement);
      replacements.delete(id);
    }
  }
  for (const value of args.nextChanged) {
    if (replacements.has(args.id(value))) {
      all.push(value);
    }
  }
  return {
    all: Object.freeze(all),
    previousChanged,
  };
}

export function fnProjectCanvasDocumentIncremental(
  args: TArgsProjectCanvasDocumentIncremental,
): {
  projection: TCanvasDocumentProjection;
  diff: TCanvasProjectionDiff;
} {
  const changedElementIds = fnChangedElementIds(args.changes);
  const changedElementIdSet = new Set(changedElementIds);
  const groupIds = new Set(Object.keys(args.document.groups));
  const diagnostics: TCanvasProjectionDiagnostic[] = [];
  const changedElements = changedElementIds.flatMap((id) => {
    const element = args.document.elements[id];
    return element === undefined ? [] : [element];
  }).sort(fnCompareCanvasElements);
  const elementProjections = changedElements.map((element) => {
    if (
      element.parentGroupId !== null
      && !groupIds.has(element.parentGroupId)
    ) {
      diagnostics.push({
        code: "ELEMENT_PARENT_MISSING",
        message: `Element '${element.id}' references missing parent '${element.parentGroupId}'.`,
        target: {
          kind: "element",
          id: element.id,
        },
      });
    }
    return fnFreezeCanvasProjectionValue({
      value: fnProjectCanvasElement({
        element,
        parentNodeId: fnElementParentNodeId(element, groupIds),
        registry: args.registry,
        theme: args.theme,
        dependencies: args.dependencies,
        diagnostics,
        ...(args.forcedPlaceholders?.[element.id] === undefined
          ? {}
          : { forcedFailure: args.forcedPlaceholders[element.id] }),
      }),
    });
  });
  const projectionByElementId = new Map(elementProjections.map((projection) => {
    return [projection.semanticTarget.id, projection];
  }));

  const previousNodeIds = new Set(changedElementIds.flatMap((id) => {
    return [...(args.previous.index.elementNodeIds[id] ?? [])];
  }));
  const previousResourceIds = new Set(changedElementIds.flatMap((id) => {
    return [...(args.previous.index.elementResourceIds[id] ?? [])];
  }));
  const previousPortalIds = new Set(changedElementIds.flatMap((id) => {
    return [...(args.previous.index.elementPortalIds[id] ?? [])];
  }));

  const nextChangedNodes = elementProjections.flatMap((projection) => {
    return [...projection.nodes];
  });
  const nextChangedResources = elementProjections.flatMap((projection) => {
    return [...projection.resources];
  });
  const nextChangedPortals = elementProjections.flatMap((projection) => {
    return [...projection.portals];
  });

  const stableNodePositions = args.previous.index.nodePositions;
  const canPatchNodesByPosition = stableNodePositions !== undefined
    && nextChangedNodes.length === previousNodeIds.size
    && nextChangedNodes.every((node) => {
      return previousNodeIds.has(node.id)
        && stableNodePositions[node.id] !== undefined;
    });
  const nodePatch = canPatchNodesByPosition
    ? (() => {
        const all = args.previous.snapshot.nodes.slice();
        const previousChanged: TSceneNode[] = [];
        for (const node of nextChangedNodes) {
          const position = stableNodePositions[node.id]!;
          previousChanged.push(all[position]!);
          all[position] = node;
        }
        Object.freeze(all);
        return { all, previousChanged };
      })()
    : fnPatchCollection<TSceneNode>({
        previous: args.previous.snapshot.nodes,
        previousChangedIds: previousNodeIds,
        nextChanged: nextChangedNodes,
        id: (node) => node.id,
      });
  const resourcePatch = fnPatchCollection<TCanvasProjectedResource>({
    previous: args.previous.resources,
    previousChangedIds: previousResourceIds,
    nextChanged: nextChangedResources,
    id: (resource) => resource.descriptor.id,
  });
  const portalPatch = fnPatchCollection<TCanvasProjectedPortal>({
    previous: args.previous.portals,
    previousChangedIds: previousPortalIds,
    nextChanged: nextChangedPortals,
    id: (portal) => portal.portalId,
  });
  const nodes = nodePatch.all as TSceneNode[];
  const resources = resourcePatch.all;
  const portals = portalPatch.all;
  const nextDiagnostics = diagnostics.length === 0
    && args.previous.diagnostics.length === 0
    ? args.previous.diagnostics
    : Object.freeze([
        ...args.previous.diagnostics.filter((diagnostic) => {
          return diagnostic.target?.kind !== "element"
            || !changedElementIdSet.has(diagnostic.target.id);
        }),
        ...diagnostics.map((diagnostic) => {
          return fnFreezeCanvasProjectionValue({ value: diagnostic });
        }),
      ]);

  const elementNodeIds = fnPatchStringArrayRecord({
    previous: args.previous.index.elementNodeIds,
    changedIds: changedElementIds,
    next: (id) => projectionByElementId.get(id)?.nodes.map((node) => node.id),
  });
  const elementResourceIds = fnPatchStringArrayRecord({
    previous: args.previous.index.elementResourceIds,
    changedIds: changedElementIds,
    next: (id) => projectionByElementId.get(id)?.resources.map((resource) => {
      return resource.descriptor.id;
    }),
  });
  const elementPortalIds = fnPatchStringArrayRecord({
    previous: args.previous.index.elementPortalIds,
    changedIds: changedElementIds,
    next: (id) => projectionByElementId.get(id)?.portals.map((portal) => {
      return portal.portalId;
    }),
  });
  const elementSignatures = fnPatchStringRecord({
    previous: args.previous.index.elementSignatures,
    changedIds: changedElementIds,
    next: (id) => projectionByElementId.get(id)?.signature,
  });
  const nodeMappingsChanged = elementNodeIds
    !== args.previous.index.elementNodeIds;
  const nodeTargets = nodeMappingsChanged
    ? (() => {
        const patched = { ...args.previous.index.nodeTargets };
        for (const id of changedElementIds) {
          for (const nodeId of args.previous.index.elementNodeIds[id] ?? []) {
            delete patched[nodeId];
          }
          const elementProjection = projectionByElementId.get(id);
          if (elementProjection !== undefined) {
            for (const node of elementProjection.nodes) {
              patched[node.id] = elementProjection.semanticTarget;
            }
          }
        }
        return fnFreezeRecord(patched);
      })()
    : args.previous.index.nodeTargets;

  const signature = fnUpdateCanvasDocumentProjectionSignature({
    previousSignature: args.previous.signature,
    previousElementSignatures: args.previous.index.elementSignatures,
    nextElementSignatures: elementSignatures,
    changedElementIds,
  });
  const index: TCanvasProjectionIndex = Object.freeze({
    elementNodeIds,
    groupNodeIds: args.previous.index.groupNodeIds,
    nodeTargets,
    elementResourceIds,
    elementPortalIds,
    elementSignatures,
    groupSignatures: args.previous.index.groupSignatures,
    nodePositions: canPatchNodesByPosition
      ? args.previous.index.nodePositions
      : fnFreezeRecord(Object.fromEntries(nodes.map((node, position) => {
          return [node.id, position];
        }))),
    activeProjectionSignature: signature,
    lastAppliedRevision: args.revision,
  });
  const projection: TCanvasDocumentProjection = Object.freeze({
    snapshot: Object.freeze({
      ...args.previous.snapshot,
      nodes,
    }),
    resources,
    portals,
    diagnostics: nextDiagnostics,
    index,
    signature,
  });

  const nodeDiff = fnCollectionDiff<TSceneNode>({
    previous: nodePatch.previousChanged,
    next: nextChangedNodes,
    id: (node) => node.id,
  });
  const resourceDiff = fnCollectionDiff<TCanvasProjectedResource>({
    previous: resourcePatch.previousChanged,
    next: nextChangedResources,
    id: (resource) => resource.descriptor.id,
  });
  const portalDiff = fnCollectionDiff<TCanvasProjectedPortal>({
    previous: portalPatch.previousChanged,
    next: nextChangedPortals,
    id: (portal) => portal.portalId,
  });
  const elementAdded: string[] = [];
  const elementUpdated: string[] = [];
  const elementRemoved: string[] = [];
  for (const id of changedElementIds) {
    const before = args.previous.index.elementSignatures[id];
    const after = elementSignatures[id];
    if (before === undefined && after !== undefined) {
      elementAdded.push(id);
    } else if (before !== undefined && after === undefined) {
      elementRemoved.push(id);
    } else if (before !== after) {
      elementUpdated.push(id);
    }
  }
  const changed = fnHasCollectionChanges(nodeDiff)
    || fnHasCollectionChanges(resourceDiff)
    || fnHasCollectionChanges(portalDiff)
    || elementAdded.length > 0
    || elementUpdated.length > 0
    || elementRemoved.length > 0;
  return {
    projection,
    diff: {
      nodes: nodeDiff,
      resources: resourceDiff,
      portals: portalDiff,
      elements: {
        added: elementAdded,
        updated: elementUpdated,
        removed: elementRemoved,
      },
      groups: {
        added: [],
        updated: [],
        removed: [],
      },
      changed,
      previousSignature: args.previous.signature,
      nextSignature: projection.signature,
    },
  };
}
