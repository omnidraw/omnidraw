import type { DocHandle } from "@automerge/automerge-repo";
import type { TCanvasDoc, TElement, TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCrdtEntityTarget, TCrdtPathKey, TCrdtRecordedOp } from "./fxBuilder";

export type TPortalTxApplyCrdtOps = {
  docHandle: DocHandle<TCanvasDoc>;
  clone: <T>(value: T) => T;
};

export type TArgsTxApplyCrdtOps = {
  ops: TCrdtRecordedOp[];
};

export function txApplyCrdtOps(
  portal: TPortalTxApplyCrdtOps,
  args: TArgsTxApplyCrdtOps,
): void {
  portal.docHandle.change((doc) => {
    for (const op of args.ops) {
      applyRecordedCrdtOp(portal, {
        doc,
        op,
      });
    }
  });
}

type TPortalApplyRecordedCrdtOp = TPortalTxApplyCrdtOps;

type TArgsApplyRecordedCrdtOp = {
  doc: TCanvasDoc;
  op: TCrdtRecordedOp;
};

function applyRecordedCrdtOp(
  portal: TPortalApplyRecordedCrdtOp,
  args: TArgsApplyRecordedCrdtOp,
): TCrdtRecordedOp | null {
  if (args.op.kind === "replace-entity") {
    const collection = getCollectionByTarget({}, { doc: args.doc, target: args.op.target });
    const before = collection[args.op.value.id];
    collection[args.op.value.id] = cloneEntityValue(portal, { value: args.op.value }) as never;

    if (before === undefined) {
      return {
        kind: "delete-entity",
        target: args.op.target,
        id: args.op.value.id,
      };
    }

    return {
      kind: "replace-entity",
      target: args.op.target,
      value: cloneEntityValue(portal, { value: before }),
    };
  }

  if (args.op.kind === "delete-entity") {
    const collection = getCollectionByTarget({}, { doc: args.doc, target: args.op.target });
    const before = collection[args.op.id];
    if (before === undefined) {
      return null;
    }

    delete collection[args.op.id];

    return {
      kind: "replace-entity",
      target: args.op.target,
      value: cloneEntityValue(portal, { value: before }),
    };
  }

  if (args.op.kind === "remove-entity-path") {
    const entity = getEntityByTargetAndId({}, { doc: args.doc, target: args.op.target, id: args.op.id });
    if (entity === null) {
      throw new Error(`Cannot remove path from missing ${args.op.target} '${args.op.id}'`);
    }

    const beforeHasValue = hasValueAtPath({}, { target: entity, path: args.op.path });
    if (!beforeHasValue) {
      return null;
    }

    const beforeValue = getValueAtPath({}, { target: entity, path: args.op.path });
    removeAtPath({}, { target: entity, path: args.op.path });

    return {
      kind: "set-entity-path",
      target: args.op.target,
      id: args.op.id,
      path: [...args.op.path],
      value: cloneUnknownValue(portal, { value: beforeValue }),
    };
  }

  const entity = getEntityByTargetAndId({}, { doc: args.doc, target: args.op.target, id: args.op.id });
  if (entity === null) {
    throw new Error(`Cannot patch missing ${args.op.target} '${args.op.id}'`);
  }

  const beforeHasValue = hasValueAtPath({}, { target: entity, path: args.op.path });
  const beforeValue = beforeHasValue
    ? getValueAtPath({}, { target: entity, path: args.op.path })
    : undefined;

  setAtPath({}, {
    target: entity,
    path: args.op.path,
    value: cloneUnknownValue(portal, { value: args.op.value }),
  });

  if (!beforeHasValue) {
    return {
      kind: "remove-entity-path",
      target: args.op.target,
      id: args.op.id,
      path: [...args.op.path],
    };
  }

  return {
    kind: "set-entity-path",
    target: args.op.target,
    id: args.op.id,
    path: [...args.op.path],
    value: cloneUnknownValue(portal, { value: beforeValue }),
  };
}

type TPortalGetCollectionByTarget = Record<string, never>;

type TArgsGetCollectionByTarget = {
  doc: TCanvasDoc;
  target: TCrdtEntityTarget;
};

function getCollectionByTarget(
  _portal: TPortalGetCollectionByTarget,
  args: TArgsGetCollectionByTarget,
): TCanvasDoc["elements"] | TCanvasDoc["groups"] {
  return args.target === "element" ? args.doc.elements : args.doc.groups;
}

type TPortalGetEntityByTargetAndId = Record<string, never>;

type TArgsGetEntityByTargetAndId = {
  doc: TCanvasDoc;
  target: TCrdtEntityTarget;
  id: string;
};

function getEntityByTargetAndId(
  _portal: TPortalGetEntityByTargetAndId,
  args: TArgsGetEntityByTargetAndId,
): TElement | TGroup | null {
  const collection = getCollectionByTarget({}, args);
  return (collection[args.id] ?? null) as TElement | TGroup | null;
}

type TPortalCloneEntityValue = TPortalTxApplyCrdtOps;

type TArgsCloneEntityValue = {
  value: TElement | TGroup;
};

function cloneEntityValue(
  portal: TPortalCloneEntityValue,
  args: TArgsCloneEntityValue,
): TElement | TGroup {
  return portal.clone(args.value);
}

type TPortalCloneUnknownValue = TPortalTxApplyCrdtOps;

type TArgsCloneUnknownValue = {
  value: unknown;
};

function cloneUnknownValue(
  portal: TPortalCloneUnknownValue,
  args: TArgsCloneUnknownValue,
): unknown {
  return args.value === undefined ? undefined : portal.clone(args.value);
}

type TPortalHasValueAtPath = Record<string, never>;

type TArgsHasValueAtPath = {
  target: unknown;
  path: TCrdtPathKey[];
};

function hasValueAtPath(
  _portal: TPortalHasValueAtPath,
  args: TArgsHasValueAtPath,
): boolean {
  let current: unknown = args.target;

  for (const key of args.path) {
    if (!isIndexableValue({}, { value: current })) {
      return false;
    }

    const currentIndexable = current as Record<string | number, unknown> | unknown[];
    if (!(key in currentIndexable)) {
      return false;
    }

    current = getIndexableValueAtKey({}, { value: currentIndexable, key });
  }

  return true;
}

type TPortalGetValueAtPath = Record<string, never>;

type TArgsGetValueAtPath = {
  target: unknown;
  path: TCrdtPathKey[];
};

function getValueAtPath(
  _portal: TPortalGetValueAtPath,
  args: TArgsGetValueAtPath,
): unknown {
  let current: unknown = args.target;

  for (const key of args.path) {
    if (!isIndexableValue({}, { value: current })) {
      return undefined;
    }

    const currentIndexable = current as Record<string | number, unknown> | unknown[];
    current = getIndexableValueAtKey({}, { value: currentIndexable, key });
  }

  return current;
}

type TPortalSetAtPath = Record<string, never>;

type TArgsSetAtPath = {
  target: unknown;
  path: TCrdtPathKey[];
  value: unknown;
};

function setAtPath(
  _portal: TPortalSetAtPath,
  args: TArgsSetAtPath,
): void {
  if (args.path.length === 0) {
    return;
  }

  const parent = getOrCreateParent({}, { target: args.target, path: args.path });
  const key = args.path[args.path.length - 1];

  if (Array.isArray(parent) && typeof key === "number") {
    if (key === parent.length) {
      parent.push(args.value);
      return;
    }

    parent[key] = args.value;
    return;
  }

  setIndexableValueAtKey({}, { value: parent, key, nextValue: args.value });
}

type TPortalRemoveAtPath = Record<string, never>;

type TArgsRemoveAtPath = {
  target: unknown;
  path: TCrdtPathKey[];
};

function removeAtPath(
  _portal: TPortalRemoveAtPath,
  args: TArgsRemoveAtPath,
): void {
  if (args.path.length === 0) {
    return;
  }

  const parent = getExistingParent({}, { target: args.target, path: args.path });
  if (parent === null) {
    return;
  }

  const key = args.path[args.path.length - 1];
  if (Array.isArray(parent) && typeof key === "number") {
    parent.splice(key, 1);
    return;
  }

  delete (parent as Record<string | number, unknown>)[key];
}

type TPortalGetOrCreateParent = Record<string, never>;

type TArgsGetOrCreateParent = {
  target: unknown;
  path: TCrdtPathKey[];
};

function getOrCreateParent(
  _portal: TPortalGetOrCreateParent,
  args: TArgsGetOrCreateParent,
): Record<string | number, unknown> | unknown[] {
  let current: unknown = args.target;

  for (let index = 0; index < args.path.length - 1; index += 1) {
    const key = args.path[index];
    const nextKey = args.path[index + 1];

    if (!isIndexableValue({}, { value: current })) {
      throw new Error(`Cannot create parent for path '${args.path.join(".")}'`);
    }

    const currentIndexable = current as Record<string | number, unknown> | unknown[];
    if (getIndexableValueAtKey({}, { value: currentIndexable, key }) === undefined) {
      setIndexableValueAtKey({}, { value: currentIndexable, key, nextValue: typeof nextKey === "number" ? [] : {} });
    }

    current = getIndexableValueAtKey({}, { value: currentIndexable, key });
  }

  if (!isIndexableValue({}, { value: current })) {
    throw new Error(`Cannot resolve parent for path '${args.path.join(".")}'`);
  }

  return current as Record<string | number, unknown> | unknown[];
}

type TPortalGetExistingParent = Record<string, never>;

type TArgsGetExistingParent = {
  target: unknown;
  path: TCrdtPathKey[];
};

function getExistingParent(
  _portal: TPortalGetExistingParent,
  args: TArgsGetExistingParent,
): Record<string | number, unknown> | unknown[] | null {
  let current: unknown = args.target;

  for (let index = 0; index < args.path.length - 1; index += 1) {
    const key = args.path[index];

    if (!isIndexableValue({}, { value: current })) {
      return null;
    }

    const currentIndexable = current as Record<string | number, unknown> | unknown[];
    if (!(key in currentIndexable)) {
      return null;
    }

    current = getIndexableValueAtKey({}, { value: currentIndexable, key });
  }

  if (!isIndexableValue({}, { value: current })) {
    return null;
  }

  return current as Record<string | number, unknown> | unknown[];
}

type TPortalIsIndexableValue = Record<string, never>;

type TArgsIsIndexableValue = {
  value: unknown;
};

function isIndexableValue(
  _portal: TPortalIsIndexableValue,
  args: TArgsIsIndexableValue,
): args is { value: Record<string | number, unknown> | unknown[] } {
  return typeof args.value === "object" && args.value !== null;
}

type TPortalGetIndexableValueAtKey = Record<string, never>;

type TArgsGetIndexableValueAtKey = {
  value: Record<string | number, unknown> | unknown[];
  key: TCrdtPathKey;
};

function getIndexableValueAtKey(
  _portal: TPortalGetIndexableValueAtKey,
  args: TArgsGetIndexableValueAtKey,
): unknown {
  return (args.value as Record<string | number, unknown>)[args.key];
}

type TPortalSetIndexableValueAtKey = Record<string, never>;

type TArgsSetIndexableValueAtKey = {
  value: Record<string | number, unknown> | unknown[];
  key: TCrdtPathKey;
  nextValue: unknown;
};

function setIndexableValueAtKey(
  _portal: TPortalSetIndexableValueAtKey,
  args: TArgsSetIndexableValueAtKey,
): void {
  (args.value as Record<string | number, unknown>)[args.key] = args.nextValue;
}
