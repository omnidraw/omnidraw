import type { TCrdtEntityChangeSet, TCrdtChangeSummary } from "../crdt/CrdtService";
import type {
  TCanvasActiveSession,
  TCanvasActiveSessionCancelReason,
  TCanvasActiveSessionDecision,
} from "./typed";

type TEntityKind = "element" | "group";

function fnFieldsIntersect(
  dependencies: readonly string[],
  changedFields: readonly string[],
) {
  return dependencies.includes("*")
    || changedFields.some((field) => dependencies.includes(field));
}

function fnClassifyEntityChanges(args: {
  entityKind: TEntityKind;
  dependencies: Readonly<Record<string, readonly string[]>>;
  changes: TCrdtEntityChangeSet;
}): TCanvasActiveSessionCancelReason | null {
  for (const [id, dependencyFields] of Object.entries(args.dependencies)) {
    const change = args.changes.changes[id];
    if (!change) {
      continue;
    }

    if (change.kind === "added") {
      return args.entityKind === "element"
        ? "remote-element-added"
        : "remote-group-added";
    }

    if (change.kind === "deleted") {
      return args.entityKind === "element"
        ? "remote-element-deleted"
        : "remote-group-deleted";
    }

    if (!fnFieldsIntersect(dependencyFields, change.changedFields)) {
      continue;
    }

    if (change.changedFields.includes("parentGroupId")) {
      return args.entityKind === "element"
        ? "remote-element-reparented"
        : "remote-group-reparented";
    }

    return args.entityKind === "element"
      ? "remote-element-fields-changed"
      : "remote-group-fields-changed";
  }

  return null;
}

export function fnClassifyActiveSessionChange(
  session: TCanvasActiveSession,
  summary: TCrdtChangeSummary,
): TCanvasActiveSessionDecision {
  if (summary.origin === "local") {
    return {
      action: "continue",
      sessionId: session.id,
      summaryRevision: summary.revision,
    };
  }

  if (summary.fullReload) {
    return {
      action: "cancel",
      sessionId: session.id,
      summaryRevision: summary.revision,
      reason: "remote-full-reload",
    };
  }

  const elementReason = fnClassifyEntityChanges({
    entityKind: "element",
    dependencies: session.dependencies.elements,
    changes: summary.elements,
  });
  if (elementReason) {
    return {
      action: "cancel",
      sessionId: session.id,
      summaryRevision: summary.revision,
      reason: elementReason,
    };
  }

  const groupReason = fnClassifyEntityChanges({
    entityKind: "group",
    dependencies: session.dependencies.groups,
    changes: summary.groups,
  });
  if (groupReason) {
    return {
      action: "cancel",
      sessionId: session.id,
      summaryRevision: summary.revision,
      reason: groupReason,
    };
  }

  return {
    action: "continue",
    sessionId: session.id,
    summaryRevision: summary.revision,
  };
}
