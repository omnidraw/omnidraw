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
  TCanvasProjectionWork,
} from "../typed";
import type { ProjectionRegistry } from "./ProjectionRegistry";
import { fnUpdateCanvasDocumentProjectionSignature } from "./fn.document-signature";
import { fnFreezeCanvasProjectionValue } from "./fn.freeze";
import { fnCanvasEngineGroupId } from "./fn.ids";
import { fnResolveCanvasProjectionNodePosition } from "./fn.node-position";
import { fnPatchPersistentRecord } from "./fn.persistent-record";
import {
  fnCreatePersistentSequence,
  fnPatchPersistentSequence,
  fnSplicePersistentSequence,
} from "./fn.persistent-sequence";
import {
  fnCompareCanvasElements,
  fnProjectCanvasElement,
} from "./fn.project-document";
import { fnProjectCanvasGroup } from "./fn.project-group";
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
  groupChanges?: TCanvasIncrementalElementChanges;
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

function fnOrderChangedGroupIds(
  canvasDocument: TCanvasDoc,
  groupIds: readonly string[],
): string[] {
  const changed = new Set(groupIds);
  const visited = new Set<string>();
  const ordered: string[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) {
      return;
    }
    visited.add(id);
    const parentId = canvasDocument.groups[id]?.parentGroupId;
    if (parentId !== null && parentId !== undefined && changed.has(parentId)) {
      visit(parentId);
    }
    ordered.push(id);
  };
  for (const id of groupIds) {
    visit(id);
  }
  return ordered;
}

function fnOrderChangedNodes(nodes: readonly TSceneNode[]): TSceneNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const ordered: TSceneNode[] = [];
  const visit = (node: TSceneNode) => {
    if (visited.has(node.id)) {
      return;
    }
    visited.add(node.id);
    const parent = node.parentId === null ? undefined : byId.get(node.parentId);
    if (parent !== undefined) {
      visit(parent);
    }
    ordered.push(node);
  };
  for (const node of nodes) {
    visit(node);
  }
  return ordered;
}

function fnElementParentNodeId(
  element: TElement,
  groups: TCanvasDoc["groups"],
) {
  const fullscreenWidget = (
    element.data.type === "ui-widget"
    || element.data.type === "widget-instance"
  ) && element.data.window === "fullscreen";
  if (fullscreenWidget) {
    return CANVAS_ENGINE_LAYER_IDS.overlay;
  }
  return element.parentGroupId !== null
    && groups[element.parentGroupId] !== undefined
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
  return fnPatchPersistentRecord({
    previous: args.previous,
    changes: args.changedIds.map((id) => {
      const next = args.next(id);
      return {
        key: id,
        value: next === undefined ? undefined : Object.freeze([...next]),
      };
    }),
  });
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
  return fnPatchPersistentRecord({
    previous: args.previous,
    changes: args.changedIds.map((id) => ({
      key: id,
      value: args.next(id),
    })),
  });
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
  work: TCanvasProjectionWork;
} {
  const changedElementIds = fnChangedElementIds(args.changes);
  const changedGroupIds = fnOrderChangedGroupIds(
    args.document,
    fnChangedElementIds(args.groupChanges ?? {
      added: [],
      updated: [],
      deleted: [],
    }),
  );
  const changedElementIdSet = new Set(changedElementIds);
  const diagnostics: TCanvasProjectionDiagnostic[] = [];
  const changedElements = changedElementIds.flatMap((id) => {
    const element = args.document.elements[id];
    return element === undefined ? [] : [element];
  }).sort(fnCompareCanvasElements);
  const elementProjections = changedElements.map((element) => {
    if (
      element.parentGroupId !== null
      && args.document.groups[element.parentGroupId] === undefined
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
        parentNodeId: fnElementParentNodeId(element, args.document.groups),
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
  const groupProjections = changedGroupIds.flatMap((id) => {
    const group = args.document.groups[id];
    if (group === undefined) {
      return [];
    }
    const parentGroupId = group.parentGroupId;
    const parentExists = parentGroupId === null
      || args.document.groups[parentGroupId] !== undefined;
    if (!parentExists) {
      diagnostics.push({
        code: "GROUP_PARENT_MISSING",
        message: `Group '${group.id}' references missing parent '${parentGroupId}'.`,
        target: { kind: "group", id: group.id },
      });
    }
    return [fnFreezeCanvasProjectionValue({
      value: fnProjectCanvasGroup({
        group,
        parentNodeId: parentExists && parentGroupId !== null
          ? fnCanvasEngineGroupId({ id: parentGroupId })
          : CANVAS_ENGINE_LAYER_IDS.content,
      }),
    })];
  });
  const projectionByGroupId = new Map(groupProjections.map((projection) => {
    return [projection.semanticTarget.id, projection];
  }));

  const previousNodeIds = new Set(changedElementIds.flatMap((id) => {
    return [...(args.previous.index.elementNodeIds[id] ?? [])];
  }).concat(changedGroupIds.flatMap((id) => {
    const nodeId = args.previous.index.groupNodeIds[id];
    return nodeId === undefined ? [] : [nodeId];
  })));
  const previousResourceIds = new Set(changedElementIds.flatMap((id) => {
    return [...(args.previous.index.elementResourceIds[id] ?? [])];
  }));
  const previousPortalIds = new Set(changedElementIds.flatMap((id) => {
    return [...(args.previous.index.elementPortalIds[id] ?? [])];
  }));

  const nextChangedNodes = fnOrderChangedNodes(groupProjections.flatMap((projection) => {
    return [...projection.nodes];
  }).concat(elementProjections.flatMap((projection) => {
    return [...projection.nodes];
  })));
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
        && fnResolveCanvasProjectionNodePosition({
          index: args.previous.index,
          nodeId: node.id,
        }) !== undefined;
    });
  const nodePatch = canPatchNodesByPosition
    ? (() => {
        const replacements: {
          index: number;
          value: TSceneNode;
        }[] = [];
        const previousChanged: TSceneNode[] = [];
        for (const node of nextChangedNodes) {
          const position = fnResolveCanvasProjectionNodePosition({
            index: args.previous.index,
            nodeId: node.id,
          })!;
          previousChanged.push(args.previous.snapshot.nodes[position]!);
          replacements.push({ index: position, value: node });
        }
        const patched = fnPatchPersistentSequence({
          previous: args.previous.index.nodeSequence
            ?? args.previous.snapshot.nodes,
          replacements,
        });
        return {
          all: patched.value,
          previousChanged,
          copiedSlots: patched.copiedSlots,
          nodePositions: args.previous.index.nodePositions,
          nodePositionEpochs: args.previous.index.nodePositionEpochs,
          nodePositionEdits: args.previous.index.nodePositionEdits,
        };
      })()
    : (() => {
        const nextById = new Map(nextChangedNodes.map((node) => {
          return [node.id, node];
        }));
        const addedIds = new Set(nextChangedNodes.flatMap((node) => {
          return previousNodeIds.has(node.id) ? [] : [node.id];
        }));
        const hasAddedAncestor = (node: TSceneNode) => {
          let parentId = node.parentId;
          const visited = new Set<string>();
          while (parentId !== null && !visited.has(parentId)) {
            if (addedIds.has(parentId)) {
              return true;
            }
            visited.add(parentId);
            parentId = nextById.get(parentId)?.parentId ?? null;
          }
          return false;
        };
        const relocatedIds = new Set(nextChangedNodes.flatMap((node) => {
          return previousNodeIds.has(node.id) && hasAddedAncestor(node)
            ? [node.id]
            : [];
        }));
        const previousChanged = [...previousNodeIds].flatMap((nodeId) => {
          const position = fnResolveCanvasProjectionNodePosition({
            index: args.previous.index,
            nodeId,
          });
          return position === undefined
            ? []
            : [args.previous.snapshot.nodes[position]!];
        });
        let all = args.previous.index.nodeSequence
          ?? args.previous.snapshot.nodes;
        let copiedSlots = 0;
        let edits = args.previous.index.nodePositionEdits
          ?? fnCreatePersistentSequence<{
            position: number;
            delta: number;
          }>([]);
        const removedFromSequence = [...previousNodeIds].filter((nodeId) => {
          return !nextById.has(nodeId) || relocatedIds.has(nodeId);
        }).map((nodeId) => {
          return {
            nodeId,
            position: fnResolveCanvasProjectionNodePosition({
              index: args.previous.index,
              nodeId,
            })!,
          };
        }).sort((left, right) => right.position - left.position);
        const nodePositionChanges: {
          key: string;
          value: number | undefined;
        }[] = [];
        const nodeEpochChanges: {
          key: string;
          value: number | undefined;
        }[] = [];
        for (const removed of removedFromSequence) {
          const spliced = fnSplicePersistentSequence({
            previous: all,
            index: removed.position,
            deleteCount: 1,
            values: [],
          });
          all = spliced.value;
          copiedSlots += spliced.copiedSlots;
          edits = fnSplicePersistentSequence({
            previous: edits,
            index: edits.length,
            deleteCount: 0,
            values: [{ position: removed.position, delta: -1 }],
          }).value;
          nodePositionChanges.push({ key: removed.nodeId, value: undefined });
          nodeEpochChanges.push({ key: removed.nodeId, value: undefined });
        }
        const replacements = nextChangedNodes.flatMap((node) => {
          if (
            !previousNodeIds.has(node.id)
            || relocatedIds.has(node.id)
          ) {
            return [];
          }
          const position = fnResolveCanvasProjectionNodePosition({
            index: {
              ...args.previous.index,
              nodePositionEdits: edits,
            },
            nodeId: node.id,
          });
          return position === undefined ? [] : [{ index: position, value: node }];
        });
        if (replacements.length > 0) {
          const patched = fnPatchPersistentSequence({
            previous: all,
            replacements,
          });
          all = patched.value;
          copiedSlots += patched.copiedSlots;
        }
        const appended = nextChangedNodes.filter((node) => {
          return addedIds.has(node.id) || relocatedIds.has(node.id);
        });
        if (appended.length > 0) {
          const insertionPosition = all.length;
          const spliced = fnSplicePersistentSequence({
            previous: all,
            index: insertionPosition,
            deleteCount: 0,
            values: appended,
          });
          all = spliced.value;
          copiedSlots += spliced.copiedSlots;
          for (const [offset, node] of appended.entries()) {
            nodePositionChanges.push({
              key: node.id,
              value: insertionPosition + offset,
            });
            nodeEpochChanges.push({
              key: node.id,
              value: edits.length,
            });
          }
        }
        return {
          all,
          previousChanged,
          copiedSlots,
          nodePositions: fnPatchPersistentRecord({
            previous: args.previous.index.nodePositions ?? {},
            changes: nodePositionChanges,
          }),
          nodePositionEpochs: fnPatchPersistentRecord({
            previous: args.previous.index.nodePositionEpochs ?? {},
            changes: nodeEpochChanges,
          }),
          nodePositionEdits: edits,
        };
      })();
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
          return !(
            diagnostic.target?.kind === "element"
            && changedElementIdSet.has(diagnostic.target.id)
          ) && !(
            diagnostic.target?.kind === "group"
            && changedGroupIds.includes(diagnostic.target.id)
          );
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
  const groupNodeIds = fnPatchStringRecord({
    previous: args.previous.index.groupNodeIds,
    changedIds: changedGroupIds,
    next: (id) => projectionByGroupId.get(id)?.nodes[0]?.id,
  });
  const groupSignatures = fnPatchStringRecord({
    previous: args.previous.index.groupSignatures,
    changedIds: changedGroupIds,
    next: (id) => projectionByGroupId.get(id)?.signature,
  });
  const nodeMappingsChanged = elementNodeIds
    !== args.previous.index.elementNodeIds
    || groupNodeIds !== args.previous.index.groupNodeIds;
  const nodeTargets = nodeMappingsChanged
    ? (() => {
        const changes: {
          key: string;
          value: TCanvasProjectionIndex["nodeTargets"][string] | undefined;
        }[] = [];
        for (const id of changedElementIds) {
          for (const nodeId of args.previous.index.elementNodeIds[id] ?? []) {
            changes.push({ key: nodeId, value: undefined });
          }
          const elementProjection = projectionByElementId.get(id);
          if (elementProjection !== undefined) {
            for (const node of elementProjection.nodes) {
              changes.push({
                key: node.id,
                value: elementProjection.semanticTarget,
              });
            }
          }
        }
        for (const id of changedGroupIds) {
          const previousNodeId = args.previous.index.groupNodeIds[id];
          if (previousNodeId !== undefined) {
            changes.push({ key: previousNodeId, value: undefined });
          }
          const groupProjection = projectionByGroupId.get(id);
          if (groupProjection !== undefined) {
            for (const node of groupProjection.nodes) {
              changes.push({
                key: node.id,
                value: groupProjection.semanticTarget,
              });
            }
          }
        }
        return fnPatchPersistentRecord({
          previous: args.previous.index.nodeTargets,
          changes,
        });
      })()
    : args.previous.index.nodeTargets;

  const signature = fnUpdateCanvasDocumentProjectionSignature({
    previousSignature: args.previous.signature,
    previousElementSignatures: args.previous.index.elementSignatures,
    nextElementSignatures: elementSignatures,
    changedElementIds,
    previousGroupSignatures: args.previous.index.groupSignatures,
    nextGroupSignatures: groupSignatures,
    changedGroupIds,
  });
  const index: TCanvasProjectionIndex = {
    elementNodeIds,
    groupNodeIds,
    nodeTargets,
    elementResourceIds,
    elementPortalIds,
    elementSignatures,
    groupSignatures,
    nodePositions: nodePatch.nodePositions,
    nodePositionEpochs: nodePatch.nodePositionEpochs,
    nodePositionEdits: nodePatch.nodePositionEdits,
    activeProjectionSignature: signature,
    lastAppliedRevision: args.revision,
  };
  Object.defineProperty(index, "nodeSequence", {
    configurable: false,
    enumerable: false,
    value: nodes,
    writable: false,
  });
  Object.freeze(index);
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
  const groupAdded: string[] = [];
  const groupUpdated: string[] = [];
  const groupRemoved: string[] = [];
  for (const id of changedGroupIds) {
    const before = args.previous.index.groupSignatures[id];
    const after = groupSignatures[id];
    if (before === undefined && after !== undefined) {
      groupAdded.push(id);
    } else if (before !== undefined && after === undefined) {
      groupRemoved.push(id);
    } else if (before !== after) {
      groupUpdated.push(id);
    }
  }
  const changed = fnHasCollectionChanges(nodeDiff)
    || fnHasCollectionChanges(resourceDiff)
    || fnHasCollectionChanges(portalDiff)
    || elementAdded.length > 0
    || elementUpdated.length > 0
    || elementRemoved.length > 0
    || groupAdded.length > 0
    || groupUpdated.length > 0
    || groupRemoved.length > 0;
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
        added: groupAdded,
        updated: groupUpdated,
        removed: groupRemoved,
      },
      changed,
      previousSignature: args.previous.signature,
      nextSignature: projection.signature,
    },
    work: {
      collectionCopies: 0,
      collectionScans: 0,
      projectedRoots: changedElements.length + groupProjections.length,
      projectedNodes: nextChangedNodes.length,
      copiedNodeSlots: nodePatch.copiedSlots,
      recoveryPasses: 0,
      invariantFallbacks: 0,
    },
  };
}
