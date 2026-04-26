import type { DocHandle } from "@automerge/automerge-repo";
import type { TCanvasDoc, TElement, TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { txApplyCrdtOps } from "./tx.apply-ops";

export type TPortalFxBuilder = {
  docHandle: DocHandle<TCanvasDoc>;
  clone: <T>(value: T) => T;
};

export type TArgsFxBuilder = Record<string, never>;

export type TCrdtEntityTarget = "element" | "group";
export type TCrdtPathKey = string | number;
export type TValueOrUpdater<T> = T | ((current: T) => T);

export type TCrdtDeleteEntityEffectArgs<TEntity extends { id: string }> = {
  id: string;
  target: TCrdtEntityTarget;
  entity: TEntity;
};

export type TCrdtDeleteEntityCallbacks<TEntity extends { id: string }> = {
  onCommit?: (args: TCrdtDeleteEntityEffectArgs<TEntity>) => void;
  onRollback?: (args: TCrdtDeleteEntityEffectArgs<TEntity>) => void;
};

export type TCrdtRecordedSetEntityPathOp = {
  kind: "set-entity-path";
  target: TCrdtEntityTarget;
  id: string;
  path: TCrdtPathKey[];
  value: unknown;
};

export type TCrdtRecordedRemoveEntityPathOp = {
  kind: "remove-entity-path";
  target: TCrdtEntityTarget;
  id: string;
  path: TCrdtPathKey[];
};

export type TCrdtRecordedReplaceEntityOp = {
  kind: "replace-entity";
  target: TCrdtEntityTarget;
  value: TElement | TGroup;
};

export type TCrdtRecordedDeleteEntityOp = {
  kind: "delete-entity";
  target: TCrdtEntityTarget;
  id: string;
};

export type TCrdtRecordedOp =
  | TCrdtRecordedSetEntityPathOp
  | TCrdtRecordedRemoveEntityPathOp
  | TCrdtRecordedReplaceEntityOp
  | TCrdtRecordedDeleteEntityOp;

export type TCrdtBuilderCommitResult = {
  undoOps: TCrdtRecordedOp[];
  redoOps: TCrdtRecordedOp[];
  rollback: () => void;
};

type TEntityKey<TEntity extends { id: string }> = Exclude<keyof TEntity, "id">;
type TNestedEntityKey<TEntity extends { id: string }, TKey extends TEntityKey<TEntity>> = keyof NonNullable<TEntity[TKey]>;

type TQueuedValue = unknown | ((current: unknown) => unknown);

type TQueuedSetEntityPathOp = {
  kind: "set-entity-path";
  target: TCrdtEntityTarget;
  id: string;
  path: TCrdtPathKey[];
  value: TQueuedValue;
};

type TQueuedRemoveEntityPathOp = {
  kind: "remove-entity-path";
  target: TCrdtEntityTarget;
  id: string;
  path: TCrdtPathKey[];
};

type TQueuedReplaceEntityOp = {
  kind: "replace-entity";
  target: TCrdtEntityTarget;
  value: TElement | TGroup;
};

type TQueuedDeleteEntityOp = {
  kind: "delete-entity";
  target: TCrdtEntityTarget;
  id: string;
  callbacks?: TCrdtDeleteEntityCallbacks<TElement | TGroup>;
};

type TCrdtDeleteEntityEffect = {
  callback: (args: TCrdtDeleteEntityEffectArgs<TElement | TGroup>) => void;
  args: TCrdtDeleteEntityEffectArgs<TElement | TGroup>;
};

export type TCrdtQueuedOp =
  | TQueuedSetEntityPathOp
  | TQueuedRemoveEntityPathOp
  | TQueuedReplaceEntityOp
  | TQueuedDeleteEntityOp;

export type TCrdtPatchEntity<TEntity extends { id: string }, TBuilder> = {
  (
    id: string,
    value: TEntity,
  ): TBuilder;
  <TKey extends TEntityKey<TEntity>>(
    id: string,
    key: TKey,
    value: TValueOrUpdater<TEntity[TKey]>,
  ): TBuilder;
  <TKey extends TEntityKey<TEntity>, TNestedKey extends TNestedEntityKey<TEntity, TKey>>(
    id: string,
    key: TKey,
    nestedKey: TNestedKey,
    value: TValueOrUpdater<NonNullable<TEntity[TKey]>[TNestedKey]>,
  ): TBuilder;
};

export type TCrdtDeleteEntity<TEntity extends { id: string }, TBuilder> = {
  (id: string): TBuilder;
  (
    id: string,
    callbacks: TCrdtDeleteEntityCallbacks<TEntity>,
  ): TBuilder;
  <TKey extends TEntityKey<TEntity>>(
    id: string,
    key: TKey,
  ): TBuilder;
  <TKey extends TEntityKey<TEntity>, TNestedKey extends TNestedEntityKey<TEntity, TKey>>(
    id: string,
    key: TKey,
    nestedKey: TNestedKey,
  ): TBuilder;
};

export type TCrdtBuilder = {
  patchElement: TCrdtPatchEntity<TElement, TCrdtBuilder>;
  patchGroup: TCrdtPatchEntity<TGroup, TCrdtBuilder>;
  deleteElement: TCrdtDeleteEntity<TElement, TCrdtBuilder>;
  deleteGroup: TCrdtDeleteEntity<TGroup, TCrdtBuilder>;
  commit: () => TCrdtBuilderCommitResult;
};

export function fxCreateCrdtBuilder(
  portal: TPortalFxBuilder,
  _args: TArgsFxBuilder,
): TCrdtBuilder {
  let queuedOps: TCrdtQueuedOp[] = [];

  const builder: TCrdtBuilder = {
    patchElement: ((id: string, keyOrValue: TEntityKey<TElement> | TElement, nestedOrValue?: unknown, maybeValue?: unknown) => {
      fxQueuePatchEntityOp<TElement>({
        queuedOps,
        target: "element",
        id,
        keyOrValue,
        nestedOrValue,
        maybeValue,
      });
      return builder;
    }) as TCrdtPatchEntity<TElement, TCrdtBuilder>,
    patchGroup: ((id: string, keyOrValue: TEntityKey<TGroup> | TGroup, nestedOrValue?: unknown, maybeValue?: unknown) => {
      fxQueuePatchEntityOp<TGroup>({
        queuedOps,
        target: "group",
        id,
        keyOrValue,
        nestedOrValue,
        maybeValue,
      });
      return builder;
    }) as TCrdtPatchEntity<TGroup, TCrdtBuilder>,
    deleteElement: ((id: string, keyOrCallbacks?: TEntityKey<TElement> | TCrdtDeleteEntityCallbacks<TElement>, nestedKey?: TCrdtPathKey) => {
      const callbacks = fxIsCrdtDeleteEntityCallbacks({}, { value: keyOrCallbacks })
        ? keyOrCallbacks as TCrdtDeleteEntityCallbacks<TElement>
        : undefined;
      fxQueueDeleteEntityOp<TElement>({
        queuedOps,
        target: "element",
        id,
        key: callbacks ? undefined : keyOrCallbacks as TEntityKey<TElement> | undefined,
        nestedKey,
        callbacks,
      });
      return builder;
    }) as TCrdtDeleteEntity<TElement, TCrdtBuilder>,
    deleteGroup: ((id: string, keyOrCallbacks?: TEntityKey<TGroup> | TCrdtDeleteEntityCallbacks<TGroup>, nestedKey?: TCrdtPathKey) => {
      const callbacks = fxIsCrdtDeleteEntityCallbacks({}, { value: keyOrCallbacks })
        ? keyOrCallbacks as TCrdtDeleteEntityCallbacks<TGroup>
        : undefined;
      fxQueueDeleteEntityOp<TGroup>({
        queuedOps,
        target: "group",
        id,
        key: callbacks ? undefined : keyOrCallbacks as TEntityKey<TGroup> | undefined,
        nestedKey,
        callbacks,
      });
      return builder;
    }) as TCrdtDeleteEntity<TGroup, TCrdtBuilder>,
    commit: () => {
      const undoOps: TCrdtRecordedOp[] = [];
      const redoOps: TCrdtRecordedOp[] = [];
      const commitEffects: TCrdtDeleteEntityEffect[] = [];
      const rollbackEffects: TCrdtDeleteEntityEffect[] = [];

      portal.docHandle.change((doc) => {
        for (const queuedOp of queuedOps) {
          const concreteOp = fxResolveQueuedCrdtOp(portal, { doc, op: queuedOp });
          const inverseOp = fxApplyRecordedCrdtOp(portal, { doc, op: concreteOp });
          fxQueueCrdtDeleteEntityEffects(portal, {
            queuedOp,
            inverseOp,
            commitEffects,
            rollbackEffects,
          });
          redoOps.push(fxCloneRecordedCrdtOp(portal, { op: concreteOp }));
          if (inverseOp !== null) {
            undoOps.push(inverseOp);
          }
        }
      });

      queuedOps = [];

      const committedUndoOps = undoOps.reverse();
      const committedRedoOps = redoOps;
      const committedRollbackEffects = rollbackEffects.reverse();

      fxRunCrdtDeleteEntityEffects({}, { effects: commitEffects });

      return {
        undoOps: committedUndoOps,
        redoOps: committedRedoOps,
        rollback: () => {
          txApplyCrdtOps(portal, {
            ops: committedUndoOps,
          });
          fxRunCrdtDeleteEntityEffects({}, { effects: committedRollbackEffects });
        },
      };
    },
  };

  return builder;
}

function fxQueuePatchEntityOp<TEntity extends { id: string }>(args: {
  queuedOps: TCrdtQueuedOp[];
  target: TCrdtEntityTarget;
  id: string;
  keyOrValue: TEntityKey<TEntity> | TEntity;
  nestedOrValue?: unknown;
  maybeValue?: unknown;
}): void {
  if (fxIsEntityReplacement<TEntity>({}, { id: args.id, value: args.keyOrValue })) {
    args.queuedOps.push({
      kind: "replace-entity",
      target: args.target,
      value: args.keyOrValue as TElement | TGroup,
    });
    return;
  }

  args.queuedOps.push({
    kind: "set-entity-path",
    target: args.target,
    id: args.id,
    path: args.maybeValue === undefined
      ? [args.keyOrValue as TCrdtPathKey]
      : [args.keyOrValue as TCrdtPathKey, args.nestedOrValue as TCrdtPathKey],
    value: args.maybeValue === undefined ? args.nestedOrValue : args.maybeValue,
  });
}

function fxQueueDeleteEntityOp<TEntity extends { id: string }>(args: {
  queuedOps: TCrdtQueuedOp[];
  target: TCrdtEntityTarget;
  id: string;
  key?: TEntityKey<TEntity>;
  nestedKey?: TCrdtPathKey;
  callbacks?: TCrdtDeleteEntityCallbacks<TEntity>;
}): void {
  if (args.key === undefined) {
    args.queuedOps.push({
      kind: "delete-entity",
      target: args.target,
      id: args.id,
      callbacks: args.callbacks === undefined
        ? undefined
        : fxToCrdtQueuedDeleteEntityCallbacks<TEntity>({}, { callbacks: args.callbacks }),
    });
    return;
  }

  args.queuedOps.push({
    kind: "remove-entity-path",
    target: args.target,
    id: args.id,
    path: args.nestedKey === undefined
      ? [args.key as TCrdtPathKey]
      : [args.key as TCrdtPathKey, args.nestedKey],
  });
}

function fxIsCrdtDeleteEntityCallbacks<TEntity extends { id: string }>(
  _portal: Record<string, never>,
  args: { value: TEntityKey<TEntity> | TCrdtDeleteEntityCallbacks<TEntity> | undefined },
): args is { value: TCrdtDeleteEntityCallbacks<TEntity> } {
  return typeof args.value === "object" && args.value !== null;
}

function fxToCrdtQueuedDeleteEntityCallbacks<TEntity extends { id: string }>(
  _portal: Record<string, never>,
  args: { callbacks: TCrdtDeleteEntityCallbacks<TEntity> },
): TCrdtDeleteEntityCallbacks<TElement | TGroup> {
  return {
    onCommit: args.callbacks.onCommit === undefined
      ? undefined
      : (effectArgs) => {
        args.callbacks.onCommit?.(effectArgs as unknown as TCrdtDeleteEntityEffectArgs<TEntity>);
      },
    onRollback: args.callbacks.onRollback === undefined
      ? undefined
      : (effectArgs) => {
        args.callbacks.onRollback?.(effectArgs as unknown as TCrdtDeleteEntityEffectArgs<TEntity>);
      },
  };
}

function fxQueueCrdtDeleteEntityEffects(
  portal: TPortalFxBuilder,
  args: {
    queuedOp: TCrdtQueuedOp;
    inverseOp: TCrdtRecordedOp | null;
    commitEffects: TCrdtDeleteEntityEffect[];
    rollbackEffects: TCrdtDeleteEntityEffect[];
  },
): void {
  if (args.queuedOp.kind !== "delete-entity" || args.queuedOp.callbacks === undefined) {
    return;
  }

  if (args.inverseOp?.kind !== "replace-entity") {
    return;
  }

  const effectArgs: TCrdtDeleteEntityEffectArgs<TElement | TGroup> = {
    id: args.queuedOp.id,
    target: args.queuedOp.target,
    entity: fxCloneEntityValue(portal, { value: args.inverseOp.value }),
  };

  if (args.queuedOp.callbacks.onCommit) {
    args.commitEffects.push({
      callback: args.queuedOp.callbacks.onCommit,
      args: fxCloneCrdtDeleteEntityEffectArgs(portal, { args: effectArgs }),
    });
  }

  if (args.queuedOp.callbacks.onRollback) {
    args.rollbackEffects.push({
      callback: args.queuedOp.callbacks.onRollback,
      args: fxCloneCrdtDeleteEntityEffectArgs(portal, { args: effectArgs }),
    });
  }
}

function fxCloneCrdtDeleteEntityEffectArgs(
  portal: TPortalFxBuilder,
  args: { args: TCrdtDeleteEntityEffectArgs<TElement | TGroup> },
): TCrdtDeleteEntityEffectArgs<TElement | TGroup> {
  return {
    id: args.args.id,
    target: args.args.target,
    entity: fxCloneEntityValue(portal, { value: args.args.entity }),
  };
}

function fxRunCrdtDeleteEntityEffects(
  _portal: Record<string, never>,
  args: { effects: TCrdtDeleteEntityEffect[] },
): void {
  for (const effect of args.effects) {
    effect.callback(effect.args);
  }
}

function fxResolveQueuedCrdtOp(
  portal: TPortalFxBuilder,
  args: {
    doc: TCanvasDoc;
    op: TCrdtQueuedOp;
  },
): TCrdtRecordedOp {
  if (args.op.kind === "replace-entity") {
    return {
      kind: "replace-entity",
      target: args.op.target,
      value: fxCloneEntityValue(portal, { value: args.op.value }),
    };
  }

  if (args.op.kind === "delete-entity") {
    return {
      kind: "delete-entity",
      target: args.op.target,
      id: args.op.id,
    };
  }

  if (args.op.kind === "remove-entity-path") {
    return args.op;
  }

  const entity = fxGetEntityByTargetAndId({ doc: args.doc, target: args.op.target, id: args.op.id });
  if (entity === null) {
    throw new Error(`Cannot patch missing ${args.op.target} '${args.op.id}'`);
  }

  const currentValue = fxGetValueAtPath({}, { target: entity, path: args.op.path });
  const nextValue = typeof args.op.value === "function"
    ? (args.op.value as (current: unknown) => unknown)(fxCloneUnknownValue(portal, { value: currentValue }))
    : args.op.value;

  return {
    kind: "set-entity-path",
    target: args.op.target,
    id: args.op.id,
    path: [...args.op.path],
    value: fxCloneUnknownValue(portal, { value: nextValue }),
  };
}

function fxApplyRecordedCrdtOp(
  portal: TPortalFxBuilder,
  args: {
    doc: TCanvasDoc;
    op: TCrdtRecordedOp;
  },
): TCrdtRecordedOp | null {
  if (args.op.kind === "replace-entity") {
    const collection = fxGetCollectionByTarget({ doc: args.doc, target: args.op.target });
    const before = collection[args.op.value.id];
    collection[args.op.value.id] = fxCloneEntityValue(portal, { value: args.op.value }) as never;

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
      value: fxCloneEntityValue(portal, { value: before }),
    };
  }

  if (args.op.kind === "delete-entity") {
    const collection = fxGetCollectionByTarget({ doc: args.doc, target: args.op.target });
    const before = collection[args.op.id];
    if (before === undefined) {
      return null;
    }

    delete collection[args.op.id];

    return {
      kind: "replace-entity",
      target: args.op.target,
      value: fxCloneEntityValue(portal, { value: before }),
    };
  }

  if (args.op.kind === "remove-entity-path") {
    const entity = fxGetEntityByTargetAndId({ doc: args.doc, target: args.op.target, id: args.op.id });
    if (entity === null) {
      throw new Error(`Cannot remove path from missing ${args.op.target} '${args.op.id}'`);
    }

    const beforeHasValue = fxHasValueAtPath({}, { target: entity, path: args.op.path });
    if (!beforeHasValue) {
      return null;
    }

    const beforeValue = fxGetValueAtPath({}, { target: entity, path: args.op.path });
    fxRemoveAtPath({}, { target: entity, path: args.op.path });

    return {
      kind: "set-entity-path",
      target: args.op.target,
      id: args.op.id,
      path: [...args.op.path],
      value: fxCloneUnknownValue(portal, { value: beforeValue }),
    };
  }

  const entity = fxGetEntityByTargetAndId({ doc: args.doc, target: args.op.target, id: args.op.id });
  if (entity === null) {
    throw new Error(`Cannot patch missing ${args.op.target} '${args.op.id}'`);
  }

  const beforeHasValue = fxHasValueAtPath({}, { target: entity, path: args.op.path });
  const beforeValue = beforeHasValue
    ? fxGetValueAtPath({}, { target: entity, path: args.op.path })
    : undefined;

  fxSetAtPath({}, {
    target: entity,
    path: args.op.path,
    value: fxCloneUnknownValue(portal, { value: args.op.value }),
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
    value: fxCloneUnknownValue(portal, { value: beforeValue }),
  };
}

function fxGetCollectionByTarget(args: {
  doc: TCanvasDoc;
  target: TCrdtEntityTarget;
}): TCanvasDoc["elements"] | TCanvasDoc["groups"] {
  return args.target === "element" ? args.doc.elements : args.doc.groups;
}

function fxGetEntityByTargetAndId(args: {
  doc: TCanvasDoc;
  target: TCrdtEntityTarget;
  id: string;
}): TElement | TGroup | null {
  const collection = fxGetCollectionByTarget(args);
  return (collection[args.id] ?? null) as TElement | TGroup | null;
}

function fxIsEntityReplacement<TEntity extends { id: string }>(
  _portal: Record<string, never>,
  args: { id: string; value: TEntityKey<TEntity> | TEntity },
): args is { id: string; value: TEntity } {
  return typeof args.value === "object" && args.value !== null && "id" in args.value && args.value.id === args.id;
}

function fxCloneEntityValue(
  portal: TPortalFxBuilder,
  args: { value: TElement | TGroup },
): TElement | TGroup {
  return portal.clone(args.value);
}

function fxCloneUnknownValue(
  portal: TPortalFxBuilder,
  args: { value: unknown },
): unknown {
  return args.value === undefined ? undefined : portal.clone(args.value);
}

function fxCloneRecordedCrdtOp(
  portal: TPortalFxBuilder,
  args: { op: TCrdtRecordedOp },
): TCrdtRecordedOp {
  if (args.op.kind === "replace-entity") {
    return {
      kind: "replace-entity",
      target: args.op.target,
      value: fxCloneEntityValue(portal, { value: args.op.value }),
    };
  }

  if (args.op.kind === "delete-entity") {
    return {
      kind: "delete-entity",
      target: args.op.target,
      id: args.op.id,
    };
  }

  if (args.op.kind === "remove-entity-path") {
    return {
      ...args.op,
      path: [...args.op.path],
    };
  }

  return {
    ...args.op,
    path: [...args.op.path],
    value: fxCloneUnknownValue(portal, { value: args.op.value }),
  };
}

function fxHasValueAtPath(
  _portal: Record<string, never>,
  args: { target: unknown; path: TCrdtPathKey[] },
): boolean {
  let current: unknown = args.target;

  for (const key of args.path) {
    if (!fxIsIndexableValue(current)) {
      return false;
    }

    if (!(key in current)) {
      return false;
    }

    current = fxGetIndexableValueAtKey(current, key);
  }

  return true;
}

function fxGetValueAtPath(
  _portal: Record<string, never>,
  args: { target: unknown; path: TCrdtPathKey[] },
): unknown {
  let current: unknown = args.target;

  for (const key of args.path) {
    if (!fxIsIndexableValue(current)) {
      return undefined;
    }

    current = fxGetIndexableValueAtKey(current, key);
  }

  return current;
}

function fxSetAtPath(
  _portal: Record<string, never>,
  args: { target: unknown; path: TCrdtPathKey[]; value: unknown },
): void {
  if (args.path.length === 0) {
    return;
  }

  const parent = fxGetOrCreateParent({}, { target: args.target, path: args.path });
  const key = args.path[args.path.length - 1];

  if (Array.isArray(parent) && typeof key === "number") {
    if (key === parent.length) {
      parent.push(args.value);
      return;
    }

    parent[key] = args.value;
    return;
  }

  fxSetIndexableValueAtKey(parent, key, args.value);
}

function fxRemoveAtPath(
  _portal: Record<string, never>,
  args: { target: unknown; path: TCrdtPathKey[] },
): void {
  if (args.path.length === 0) {
    return;
  }

  const parent = fxGetExistingParent({}, { target: args.target, path: args.path });
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

function fxGetOrCreateParent(
  _portal: Record<string, never>,
  args: { target: unknown; path: TCrdtPathKey[] },
): Record<string | number, unknown> | unknown[] {
  let current: unknown = args.target;

  for (let index = 0; index < args.path.length - 1; index += 1) {
    const key = args.path[index];
    const nextKey = args.path[index + 1];

    if (!fxIsIndexableValue(current)) {
      throw new Error(`Cannot create parent for path '${args.path.join(".")}'`);
    }

    if (fxGetIndexableValueAtKey(current, key) === undefined) {
      fxSetIndexableValueAtKey(current, key, typeof nextKey === "number" ? [] : {});
    }

    current = fxGetIndexableValueAtKey(current, key);
  }

  if (!fxIsIndexableValue(current)) {
    throw new Error(`Cannot resolve parent for path '${args.path.join(".")}'`);
  }

  return current;
}

function fxGetExistingParent(
  _portal: Record<string, never>,
  args: { target: unknown; path: TCrdtPathKey[] },
): Record<string | number, unknown> | unknown[] | null {
  let current: unknown = args.target;

  for (let index = 0; index < args.path.length - 1; index += 1) {
    const key = args.path[index];

    if (!fxIsIndexableValue(current)) {
      return null;
    }

    if (!(key in current)) {
      return null;
    }

    current = fxGetIndexableValueAtKey(current, key);
  }

  if (!fxIsIndexableValue(current)) {
    return null;
  }

  return current;
}

function fxIsIndexableValue(value: unknown): value is Record<string | number, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

function fxGetIndexableValueAtKey(
  value: Record<string | number, unknown> | unknown[],
  key: TCrdtPathKey,
): unknown {
  return (value as Record<string | number, unknown>)[key];
}

function fxSetIndexableValueAtKey(
  value: Record<string | number, unknown> | unknown[],
  key: TCrdtPathKey,
  nextValue: unknown,
): void {
  (value as Record<string | number, unknown>)[key] = nextValue;
}
