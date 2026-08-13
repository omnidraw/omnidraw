import type { TSceneNode, TSerializedSceneCommand } from '@omnidraw/cangine';
import {
  fnReadCanvasImageExtension,
  type TCanvasImageExtensionV1,
  type TCanvasOperation,
  type TCanvasPrecondition,
} from '@omnidraw/canvas-contract';
import {
  fnAuthoredCanvasNode,
  fnDiffSceneNodeStructure,
  fnDiffSceneNodes,
  fnSceneNodesEqual,
} from './fn.scene-node-diff';
import type { TSceneNodeImage } from './fn.scene-reduction';

export type TCanvasCommandPlan = Readonly<{
  operations: readonly TCanvasOperation[];
  preconditions: readonly TCanvasPrecondition[];
}>;

export type TIndexedImageDescriptor = {
  extension: TCanvasImageExtensionV1;
  count: number;
};

export type TImageDocumentIndex = Readonly<{
  nodeCounts: Map<string, number>;
  descriptorCounts: Map<string, Map<string, TIndexedImageDescriptor>>;
}>;

export type TImageIndexPatch = Readonly<{
  nodeCounts: Map<string, number>;
  descriptorCounts: Map<string, Map<string, TIndexedImageDescriptor>>;
  registrationsChanged: boolean;
}>;

export function fnPlanCanvasOperations(
  before: ReadonlyMap<string, TSceneNodeImage>,
  after: ReadonlyMap<string, TSceneNodeImage>,
): TCanvasCommandPlan {
  const operations: TCanvasOperation[] = [];
  const preconditions: TCanvasPrecondition[] = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const previousImage = before.get(id) ?? null;
    const nextImage = after.get(id) ?? null;
    const previous = previousImage === null
      ? null
      : fnAuthoredCanvasNode(previousImage);
    const next = nextImage === null ? null : fnAuthoredCanvasNode(nextImage);
    if (fnSceneNodesEqual(previous, next)) continue;
    if (previous === null && next !== null) {
      operations.push({ type: 'insert', item: next });
      preconditions.push({ type: 'item-absent', itemId: id });
      continue;
    }
    if (previous !== null && next === null) {
      operations.push({ type: 'delete', itemId: id });
      continue;
    }
    if (previous === null || next === null) continue;
    if (previous.id !== id || next.id !== id) {
      throw new TypeError(`Canvas transaction '${id}' contains a mismatched node ID.`);
    }
    const structure = fnDiffSceneNodeStructure(previous, next);
    if (structure.parentChanged) {
      operations.push({
        type: 'reparent',
        itemId: id,
        parentId: next.parentId,
        ...(structure.orderChanged ? { orderKey: next.orderKey } : {}),
      });
    } else if (structure.orderChanged) {
      operations.push({ type: 'reorder', itemId: id, orderKey: next.orderKey });
    }
    const diff = fnDiffSceneNodes(previous, next);
    if (diff.patches.length === 0) continue;
    operations.push({ type: 'patch', itemId: id, patches: diff.patches });
    preconditions.push(...diff.preconditions);
  }
  return Object.freeze({
    operations: Object.freeze(operations),
    preconditions: Object.freeze(preconditions),
  });
}

export function fnPlanSceneNodeImages(args: Readonly<{
  desired: ReadonlyMap<string, TSceneNodeImage>;
  current: ReadonlyMap<string, TSceneNode>;
  projectNode(node: TSceneNode): TSceneNode;
}>): Readonly<{
  commands: readonly TSerializedSceneCommand[];
  affectedNodeIds: readonly string[];
}> {
  const upserts: TSerializedSceneCommand[] = [];
  const removals: TSerializedSceneCommand[] = [];
  const affectedNodeIds: string[] = [];
  for (const nodeId of [...args.desired.keys()].sort(codePointCompare)) {
    const target = args.desired.get(nodeId) ?? null;
    const current = args.current.get(nodeId) ?? null;
    if (fnSceneNodesEqual(current, target)) continue;
    affectedNodeIds.push(nodeId);
    if (target === null) {
      removals.push({ type: 'remove', nodeId, descendants: 'remove' });
    } else {
      upserts.push({ type: 'upsert', node: args.projectNode(target) });
    }
  }
  const commands = Object.freeze([...upserts, ...removals]);
  if (commands.length === 0) {
    throw new RangeError('History step has no local document change.');
  }
  return Object.freeze({ commands, affectedNodeIds: Object.freeze(affectedNodeIds) });
}

export function fnBuildImageDocumentIndex(
  nodes: ReadonlyMap<string, TSceneNode>,
): TImageDocumentIndex {
  const index: TImageDocumentIndex = {
    nodeCounts: new Map(),
    descriptorCounts: new Map(),
  };
  for (const node of nodes.values()) {
    if (node.kind !== 'image') continue;
    adjustCount(index.nodeCounts, node.resourceId, 1);
    const extension = fnReadCanvasImageExtension(node);
    if (extension === null) continue;
    adjustDescriptorCount(index.descriptorCounts, node.resourceId, extension, 1);
  }
  fnAssertCompatibleImageDescriptors(index.descriptorCounts);
  return index;
}

export function fnStageImageIndexChanges(args: Readonly<{
  before: ReadonlyMap<string, TSceneNodeImage>;
  after: ReadonlyMap<string, TSceneNodeImage>;
  current: TImageDocumentIndex;
  localResourceIds: ReadonlySet<string>;
}>): TImageIndexPatch {
  const touchedResourceIds = new Set<string>();
  for (const node of args.before.values()) {
    if (node?.kind === 'image') touchedResourceIds.add(node.resourceId);
  }
  for (const node of args.after.values()) {
    if (node?.kind === 'image') touchedResourceIds.add(node.resourceId);
  }
  const nodeCounts = new Map<string, number>();
  const descriptorCounts = new Map<string, Map<string, TIndexedImageDescriptor>>();
  const registeredBefore = new Map<string, string | null>();
  for (const resourceId of touchedResourceIds) {
    nodeCounts.set(resourceId, args.current.nodeCounts.get(resourceId) ?? 0);
    descriptorCounts.set(
      resourceId,
      cloneDescriptorBucket(args.current.descriptorCounts.get(resourceId)),
    );
    registeredBefore.set(resourceId, fnRegisteredDescriptorKey(
      resourceId,
      args.current.descriptorCounts.get(resourceId),
      args.localResourceIds,
    ));
  }
  const removeNode = (node: TSceneNodeImage): void => {
    if (node?.kind !== 'image') return;
    adjustCount(nodeCounts, node.resourceId, -1);
    const extension = fnReadCanvasImageExtension(node);
    if (extension !== null) {
      adjustDescriptorCount(descriptorCounts, node.resourceId, extension, -1);
    }
  };
  const addNode = (node: TSceneNodeImage): void => {
    if (node?.kind !== 'image') return;
    adjustCount(nodeCounts, node.resourceId, 1);
    const extension = fnReadCanvasImageExtension(node);
    if (extension !== null) {
      adjustDescriptorCount(descriptorCounts, node.resourceId, extension, 1);
    }
  };
  for (const node of args.before.values()) removeNode(node);
  for (const node of args.after.values()) addNode(node);
  for (const resourceId of touchedResourceIds) {
    if (!nodeCounts.has(resourceId)) nodeCounts.set(resourceId, 0);
    if (!descriptorCounts.has(resourceId)) descriptorCounts.set(resourceId, new Map());
  }
  fnAssertCompatibleImageDescriptors(descriptorCounts);
  const registrationsChanged = [...touchedResourceIds].some((resourceId) => (
    registeredBefore.get(resourceId) !== fnRegisteredDescriptorKey(
      resourceId,
      descriptorCounts.get(resourceId),
      args.localResourceIds,
    )
  ));
  return { nodeCounts, descriptorCounts, registrationsChanged };
}

export function fnRegisteredDescriptorKey(
  resourceId: string,
  bucket: ReadonlyMap<string, TIndexedImageDescriptor> | undefined,
  localResourceIds: ReadonlySet<string>,
): string | null {
  if (localResourceIds.has(resourceId) || bucket?.size !== 1) return null;
  return bucket.keys().next().value ?? null;
}

export function fnAssertCompatibleImageDescriptors(
  descriptors: ReadonlyMap<string, ReadonlyMap<string, TIndexedImageDescriptor>>,
): void {
  for (const [resourceId, bucket] of descriptors) {
    if (bucket.size <= 1) continue;
    throw new Error(`Image resource '${resourceId}' has conflicting durable descriptors.`);
  }
}

function imageDescriptorKey(extension: TCanvasImageExtensionV1): string {
  return JSON.stringify([extension.url, extension.mimeType]);
}

function cloneDescriptorBucket(
  bucket: ReadonlyMap<string, TIndexedImageDescriptor> | undefined,
): Map<string, TIndexedImageDescriptor> {
  return new Map([...(bucket ?? [])].map(([key, indexed]) => [
    key,
    { extension: indexed.extension, count: indexed.count },
  ]));
}

function adjustCount(counts: Map<string, number>, resourceId: string, delta: 1 | -1): void {
  const next = (counts.get(resourceId) ?? 0) + delta;
  if (next < 0) {
    throw new RangeError(`Image resource '${resourceId}' has an invalid document reference count.`);
  }
  if (next === 0) counts.delete(resourceId);
  else counts.set(resourceId, next);
}

function adjustDescriptorCount(
  descriptors: Map<string, Map<string, TIndexedImageDescriptor>>,
  resourceId: string,
  extension: TCanvasImageExtensionV1,
  delta: 1 | -1,
): void {
  const bucket = descriptors.get(resourceId) ?? new Map();
  const key = imageDescriptorKey(extension);
  const existing = bucket.get(key);
  const next = (existing?.count ?? 0) + delta;
  if (next < 0) {
    throw new RangeError(`Image resource '${resourceId}' has an invalid descriptor reference count.`);
  }
  if (next === 0) bucket.delete(key);
  else bucket.set(key, { extension, count: next });
  if (bucket.size === 0) descriptors.delete(resourceId);
  else descriptors.set(resourceId, bucket);
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
