import type {
  TCanvasDoc,
  TElement,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import {
  CANVAS_ENGINE_LAYER_IDS,
  CANVAS_ENGINE_SCENE_SCHEMA_VERSION,
} from "../CONSTANTS";
import type {
  TCanvasDocumentProjection,
  TCanvasElementProjection,
  TCanvasGroupProjection,
  TCanvasProjectedPortal,
  TCanvasProjectedResource,
  TCanvasProjectionDependencies,
  TCanvasProjectionDiagnostic,
  TCanvasProjectionDiagnosticCode,
  TCanvasProjectionTheme,
} from "../typed";
import type { ProjectionRegistry } from "./ProjectionRegistry";
import { fnFreezeCanvasProjectionValue } from "./fn.freeze";
import { fnCanvasDocumentProjectionSignature } from "./fn.document-signature";
import { fnCanvasEngineGroupId } from "./fn.ids";
import { fnCreateProjectionIndex } from "./fn.index";
import { fnProjectCanvasPlaceholder } from "./fn.placeholder";
import { fnProjectCanvasGroup } from "./fn.project-group";
import { fnCanvasSceneBaseNodes } from "./fn.scene";
import { fnCanvasProjectionSignature } from "./fn.signature";
import { fnTopologicallyOrderCanvasGroups } from "./fn.topological-groups";
import { fnValidateCanvasElementProjection } from "./fn.validate-projection";
import type {
  TCanvasElementProjectionDraft,
  TCanvasProjectionDefinition,
} from "./typed";

type TArgsProjectCanvasDocument = {
  document: TCanvasDoc;
  registry: ProjectionRegistry;
  theme: TCanvasProjectionTheme;
  dependencies: TCanvasProjectionDependencies;
  revision?: number | null;
  gridVisible?: boolean;
  forcedPlaceholders?: Readonly<Record<string, {
    code: Extract<
      TCanvasProjectionDiagnosticCode,
      "PORTAL_REGISTRATION_FAILED" | "RESOURCE_PRELOAD_FAILED"
    >;
    message: string;
  }>>;
};

export function fnCompareCanvasElements(
  left: TElement,
  right: TElement,
): number {
  return (left.parentGroupId ?? "").localeCompare(right.parentGroupId ?? "")
    || left.zIndex.localeCompare(right.zIndex)
    || left.id.localeCompare(right.id);
}

function projectionFromDraft(args: {
  element: TElement;
  draft: TCanvasElementProjectionDraft;
  placeholder: boolean;
}): TCanvasElementProjection {
  const resources = args.draft.resources ?? [];
  const portals = args.draft.portals ?? [];
  const signatureValue = {
    nodes: args.draft.nodes,
    resources,
    portals,
    placeholder: args.placeholder,
  };
  return {
    nodes: args.draft.nodes,
    resources,
    portals,
    semanticTarget: {
      kind: "element",
      id: args.element.id,
    },
    signature: fnCanvasProjectionSignature({ value: signatureValue }),
    placeholder: args.placeholder,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function fnProjectCanvasElement(args: {
  element: TElement;
  parentNodeId: string;
  registry: ProjectionRegistry;
  theme: TCanvasProjectionTheme;
  dependencies: TCanvasProjectionDependencies;
  diagnostics: TCanvasProjectionDiagnostic[];
  forcedFailure?: {
    code: Extract<
      TCanvasProjectionDiagnosticCode,
      "PORTAL_REGISTRATION_FAILED" | "RESOURCE_PRELOAD_FAILED"
    >;
    message: string;
  };
}): TCanvasElementProjection {
  if (args.forcedFailure !== undefined) {
    args.diagnostics.push({
      code: args.forcedFailure.code,
      message: args.forcedFailure.message,
      target: {
        kind: "element",
        id: args.element.id,
      },
    });
    return projectionFromDraft({
      element: args.element,
      draft: fnProjectCanvasPlaceholder({
        element: args.element,
        parentNodeId: args.parentNodeId,
        theme: args.theme,
        code: args.forcedFailure.code,
      }),
      placeholder: true,
    });
  }
  let definition: TCanvasProjectionDefinition | null = null;
  let failureCode: TCanvasProjectionDiagnosticCode | null = null;
  try {
    definition = args.registry.definitions.find((candidate) => {
      return candidate.matchesElement(args.element);
    }) ?? null;
    if (!definition) {
      failureCode = "PROJECTOR_MISSING";
      throw new TypeError(`No projector matches '${args.element.data.type}'.`);
    }

    const draft = definition.project({
      element: args.element,
      parentNodeId: args.parentNodeId,
      theme: args.theme,
      dependencies: args.dependencies,
    });
    const unsupportedNodeKinds = new Set(
      args.dependencies.unsupportedNodeKinds ?? [],
    );
    const missingNodeKinds = [...new Set(draft.nodes.flatMap((node) => {
      return unsupportedNodeKinds.has(node.kind) ? [node.kind] : [];
    }))].sort();
    const portalsMissing = draft.portals !== undefined
      && draft.portals.length > 0
      && args.dependencies.portalsAvailable === false;
    if (missingNodeKinds.length > 0 || portalsMissing) {
      failureCode = "ENGINE_CAPABILITY_MISSING";
      const missing = [
        ...missingNodeKinds,
        ...(portalsMissing ? ["dom-portals"] : []),
      ];
      throw new TypeError(
        `Engine capability missing for: ${missing.join(", ")}.`,
      );
    }
    const invalidReason = fnValidateCanvasElementProjection({
      element: args.element,
      parentNodeId: args.parentNodeId,
      projection: draft,
    });
    if (invalidReason) {
      failureCode = "INVALID_PROJECTION";
      throw new TypeError(invalidReason);
    }
    return projectionFromDraft({
      element: args.element,
      draft,
      placeholder: false,
    });
  } catch (error) {
    const code = failureCode ?? "PROJECTOR_EXCEPTION";
    args.diagnostics.push({
      code,
      message: `Element '${args.element.id}' projection failed: ${errorMessage(error)}`,
      ...(definition === null ? {} : { projectorId: definition.id }),
      target: {
        kind: "element",
        id: args.element.id,
      },
    });
    const placeholder = fnProjectCanvasPlaceholder({
      element: args.element,
      parentNodeId: args.parentNodeId,
      theme: args.theme,
      code,
      ...(definition === null ? {} : { projectorId: definition.id }),
    });
    return projectionFromDraft({
      element: args.element,
      draft: placeholder,
      placeholder: true,
    });
  }
}

export function fnProjectCanvasDocument(
  args: TArgsProjectCanvasDocument,
): TCanvasDocumentProjection {
  const diagnostics: TCanvasProjectionDiagnostic[] = [];
  const groupOrder = fnTopologicallyOrderCanvasGroups({
    groups: Object.values(args.document.groups),
  });
  diagnostics.push(...groupOrder.diagnostics);

  const groupIds = new Set(groupOrder.groups.map((group) => group.id));
  const groupProjections: TCanvasGroupProjection[] = groupOrder.groups.map((group) => {
    const resolvedParentId = groupOrder.resolvedParentGroupIds[group.id] ?? null;
    return fnProjectCanvasGroup({
      group,
      parentNodeId: resolvedParentId === null
        ? CANVAS_ENGINE_LAYER_IDS.content
        : fnCanvasEngineGroupId({ id: resolvedParentId }),
    });
  });
  const elementProjections: TCanvasElementProjection[] = [];

  for (
    const element of Object.values(args.document.elements)
      .sort(fnCompareCanvasElements)
  ) {
    const parentGroupId = element.parentGroupId;
    if (parentGroupId !== null && !groupIds.has(parentGroupId)) {
      diagnostics.push({
        code: "ELEMENT_PARENT_MISSING",
        message: `Element '${element.id}' references missing parent '${parentGroupId}'.`,
        target: {
          kind: "element",
          id: element.id,
        },
      });
    }
    const fullscreenWidget = (
      element.data.type === "ui-widget"
      || element.data.type === "widget-instance"
    ) && element.data.window === "fullscreen";
    const parentNodeId = fullscreenWidget
      ? CANVAS_ENGINE_LAYER_IDS.overlay
      : parentGroupId !== null && groupIds.has(parentGroupId)
        ? fnCanvasEngineGroupId({ id: parentGroupId })
        : CANVAS_ENGINE_LAYER_IDS.content;
    elementProjections.push(fnProjectCanvasElement({
      element,
      parentNodeId,
      registry: args.registry,
      theme: args.theme,
      dependencies: args.dependencies,
      diagnostics,
      ...(args.forcedPlaceholders?.[element.id] === undefined
        ? {}
        : { forcedFailure: args.forcedPlaceholders[element.id] }),
    }));
  }

  const resources: TCanvasProjectedResource[] = elementProjections.flatMap((projection) => {
    return [...projection.resources];
  });
  const portals: TCanvasProjectedPortal[] = elementProjections.flatMap((projection) => {
    return [...projection.portals];
  });
  const snapshot = {
    schemaVersion: CANVAS_ENGINE_SCENE_SCHEMA_VERSION,
    rootLayerIds: [
      CANVAS_ENGINE_LAYER_IDS.background,
      CANVAS_ENGINE_LAYER_IDS.content,
      CANVAS_ENGINE_LAYER_IDS.overlay,
      CANVAS_ENGINE_LAYER_IDS.debug,
    ],
    nodes: [
      ...fnCanvasSceneBaseNodes({
        theme: args.theme,
        gridVisible: args.gridVisible,
      }),
      ...groupProjections.flatMap((projection) => projection.nodes),
      ...elementProjections.flatMap((projection) => projection.nodes),
    ],
  };
  const sceneSignature = fnCanvasProjectionSignature({
    value: {
      schemaVersion: snapshot.schemaVersion,
      rootLayerIds: snapshot.rootLayerIds,
      nodes: fnCanvasSceneBaseNodes({
        theme: args.theme,
        gridVisible: args.gridVisible,
      }),
    },
  });
  const elementSignatures = Object.fromEntries(elementProjections.map((value) => {
    return [value.semanticTarget.id, value.signature];
  }));
  const groupSignatures = Object.fromEntries(groupProjections.map((value) => {
    return [value.semanticTarget.id, value.signature];
  }));
  const signature = fnCanvasDocumentProjectionSignature({
    sceneSignature,
    elementSignatures,
    groupSignatures,
  });

  return fnFreezeCanvasProjectionValue({
    value: {
      snapshot,
      resources,
      portals,
      diagnostics,
      signature,
      index: {
        ...fnCreateProjectionIndex({
          elements: elementProjections,
          groups: groupProjections,
          activeProjectionSignature: signature,
          lastAppliedRevision: args.revision,
        }),
        nodePositions: Object.fromEntries(snapshot.nodes.map((node, index) => {
          return [node.id, index];
        })),
      },
    },
  });
}
