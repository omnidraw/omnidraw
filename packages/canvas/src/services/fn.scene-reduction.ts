import type { TSceneNode } from '@omnidraw/cangine';
import type { TSceneNodeChange } from '@omnidraw/cangine/scene';

export type TSceneNodeImage = TSceneNode | null;

export type TBoundedSceneChanges = Readonly<{
  before: ReadonlyMap<string, TSceneNodeImage>;
  after: ReadonlyMap<string, TSceneNodeImage>;
  nodeIds: readonly string[];
}>;

export function fnSceneChangeImages(
  changes: readonly TSceneNodeChange[],
): TBoundedSceneChanges {
  const before = new Map<string, TSceneNodeImage>();
  const after = new Map<string, TSceneNodeImage>();
  const nodeIds: string[] = [];
  for (const change of changes) {
    nodeIds.push(change.nodeId);
    before.set(change.nodeId, change.before);
    after.set(change.nodeId, change.after);
  }
  return Object.freeze({
    before,
    after,
    nodeIds: Object.freeze(nodeIds),
  });
}

export function fnBoundedSceneChanges(
  changes: readonly TSceneNodeChange[],
  declaredNodeIds: readonly string[],
): TBoundedSceneChanges {
  if (!Array.isArray(declaredNodeIds)) {
    throw new RangeError('Editor affected node IDs must be an array.');
  }
  const declared = new Set<string>();
  for (const nodeId of declaredNodeIds) {
    if (
      typeof nodeId !== 'string'
      || nodeId.length === 0
      || nodeId.length > 256
    ) {
      throw new RangeError(
        'Editor affected node IDs must contain 1–256 UTF-16 code units.',
      );
    }
    if (declared.has(nodeId)) {
      throw new RangeError(`Editor affected node ID '${nodeId}' is duplicated.`);
    }
    declared.add(nodeId);
  }

  const bounded = fnSceneChangeImages(changes);
  for (const change of changes) {
    if (!declared.has(change.nodeId)) {
      throw new RangeError(
        `Editor transaction changed undeclared node '${change.nodeId}'.`,
      );
    }
  }
  return bounded;
}
