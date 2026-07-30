# Cangine feature request: public pure serialized-command reducer

- **Status:** Accepted; targeted for Cangine 0.4.0, release date uncommitted
- **Consumer:** Vibecanvas
- **Current Cangine version:** 0.3.0
- **Vibecanvas follow-up:** Blocked migration task
  [`S127`](../../tasks/s/S127.md)

## Summary

Please expose a framework-neutral, renderer-free pure function that applies a
`readonly TSerializedSceneCommand[]` batch to immutable scene data and returns
the next scene data plus bounded before/after effects.

The function should be the public, authoritative implementation of the same
serialized-command semantics used by `ISceneStore.apply()`, without creating
an engine, renderer, mutable scene store, recorder, or browser surface.

## Why we need it

Cangine's controlled editor integration correctly requires the host
application to accept the exact mutation batch into its own document
synchronously before projecting that batch into `engine.scene.apply()`.

Vibecanvas is the durable document authority. Before writing to the Cangine
scene, it must:

1. apply the editor's serialized commands to its optimistic document;
2. identify the exact net-changed node IDs;
3. capture bounded before/after node images for persistence and product
   undo/redo;
4. derive its durable application operations; and
5. reject the whole batch atomically if the commands are invalid.

Cangine 0.3.0 exposes `TSerializedSceneCommand` and the stateful
`ISceneStore.apply()`, but it does not expose the underlying data reducer.
Vibecanvas therefore duplicates Cangine command semantics in:

- `packages/canvas/src/services/fn.local-document.ts`: 351 lines
- `packages/canvas/tests/services/fn.local-document.test.ts`: 289 lines

That local implementation has to understand:

- command order;
- upsert replacement;
- missing-node behavior;
- reparent and reorder behavior;
- subtree removal;
- `descendants: "reparent"` behavior;
- child indexing;
- net no-op detection;
- deterministic affected-ID ordering;
- immutable node cloning/freezing; and
- bounded before/after capture.

This duplication is risky. If Cangine adds a command or changes a command's
edge-case semantics, the host document and retained scene can disagree even
though both receive the same serialized batch.

## Requested capability

The public reducer should:

- accept immutable scene data and a readonly serialized-command batch;
- have no dependency on DOM, canvas, GPU, input, camera, resources, renderer,
  engine lifecycle, or global mutable state;
- apply commands in array order;
- be atomic: a rejected command leaves the input unchanged and returns no
  partial result;
- implement the same command semantics and validation as
  `ISceneStore.apply()`;
- support every member of `TSerializedSceneCommand`, including
  `replace-snapshot`, or explicitly provide a complete incremental reducer and
  a separate pure replacement operation;
- return the next immutable scene state;
- return bounded before and after images for every node with a net change;
- represent absence as `null`, so create/update/delete are unambiguous;
- return the exact net-affected node IDs in deterministic order;
- omit nodes that changed and then returned to their original value within the
  same batch;
- preserve immutable references for untouched nodes where possible;
- normalize/freeze changed data consistently with the retained scene store;
- validate hierarchy, root layers, node IDs, parent references, cycles,
  ordering, portal ownership, clip/connector references, limits, and other
  retained-scene invariants using the same rules as the scene store; and
- remain usable in a server process, worker, test, or application document
  without constructing a Cangine engine.

The reducer must not own persistence, collaboration, authorization, product
history grouping, transaction IDs, or network behavior.

## Suggested API shape

The exact names are not important. A state shape with an indexed node map
would let repeated small mutations avoid rebuilding an index or scanning the
whole snapshot:

```ts
import type {
  TLayerId,
  TNodeId,
  TScene3DSnapshot,
  TSceneNode,
  TSceneSnapshot,
  TSceneValidationLimits,
  TSerializedSceneCommand,
} from "@omnidraw/cangine";

export type TSceneReductionState = Readonly<{
  schemaVersion: TSceneSnapshot["schemaVersion"];
  rootLayerIds: readonly TLayerId[];
  nodes: ReadonlyMap<TNodeId, Readonly<TSceneNode>>;
  threeDScenes: readonly TScene3DSnapshot[];
}>;

export type TSceneNodeImage = Readonly<TSceneNode> | null;

export type TSerializedSceneCommandReduction = Readonly<{
  state: TSceneReductionState;
  before: ReadonlyMap<TNodeId, TSceneNodeImage>;
  after: ReadonlyMap<TNodeId, TSceneNodeImage>;
  affectedNodeIds: readonly TNodeId[];
  replacedSnapshot: boolean;
}>;

export function createSceneReductionState(
  snapshot: TSceneSnapshot,
  options?: Readonly<{
    validationLimits?: Partial<TSceneValidationLimits>;
  }>,
): TSceneReductionState;

export function reduceSerializedSceneCommands(
  current: TSceneReductionState,
  commands: readonly TSerializedSceneCommand[],
  options?: Readonly<{
    validationLimits?: Partial<TSceneValidationLimits>;
  }>,
): TSerializedSceneCommandReduction;

export function sceneReductionStateSnapshot(
  state: TSceneReductionState,
): TSceneSnapshot;
```

An equally suitable API could accept and return `TSceneSnapshot` directly if
Cangine can still avoid a mandatory full-scene scan for every small
incremental batch. The important contract is pure, shared command semantics
with bounded effects—not these exact type names.

## Required semantic cases

### Upsert

- Creating a missing ID yields `before: null` and `after: node`.
- Replacing an existing ID yields the original and final node.
- An equal upsert is a net no-op.
- Upsert follows the same parent, root-layer, reference, and uniqueness
  validation as `ISceneStore.apply()`.

### Reparent and reorder

- A reparent updates `parentId` and optionally `orderKey`.
- Omitting the reparent `orderKey` preserves the current key.
- Commands can target nodes created earlier in the same batch.
- Missing nodes, missing parents, cycles, or invalid root-layer relationships
  fail atomically.
- Later commands in the same batch see earlier commands.

### Remove

- The default descendant mode matches `ISceneStore.apply()`.
- Removing a subtree captures every removed descendant in bounded
  before/after effects.
- `descendants: "reparent"` reparents the same set of children to the same
  parent, with the same order-key behavior as the scene store.
- Reference validation and cleanup behavior exactly match the scene store.
- Removing a missing node has the same no-op/error behavior as the scene
  store.

### Replace snapshot

- Replacement uses the same snapshot validation and canonicalization as
  `ISceneStore.replace()` and the `replace-snapshot` dispatch path.
- The result clearly reports that whole-state replacement occurred.
- Before/after effects are either complete and exact or exposed through a
  documented replacement-specific result that lets a document authority
  derive equivalent changes without guessing.

### Net effects and immutability

- Multiple writes to one node return only its original before-image and final
  after-image.
- A create followed by remove is omitted when it has no net effect.
- A change followed by restoration is omitted when it has no net effect.
- Returned IDs have a documented deterministic order.
- The input state is never mutated.
- Untouched node references are structurally shared.
- Changed nodes and returned collections cannot be changed by the caller in a
  way that changes the reducer state.

## Performance expectations

The main use case is a large retained scene receiving small editor batches.
For a non-structural update to `k` nodes, the reducer should not require an
`O(n)` scan or clone of all `n` scene nodes.

A structural command may lazily build or update the hierarchy/reference
indexes it actually requires. This is the same reason Vibecanvas currently
uses an overlay map and delays its child index until a structural command
needs it.

This does not require a public mutable store. An opaque or persistent immutable
state value is acceptable as long as the public reduction operation remains
deterministic and side-effect free.

## Export and stability

Preferred export:

```ts
import {
  reduceSerializedSceneCommands,
} from "@omnidraw/cangine";
```

A documented framework-neutral subpath such as
`@omnidraw/cangine/scene` is also fine. This should be a supported production
API, not a testing-only helper or an import from Cangine internals.

The reducer should evolve in the same release as
`TSerializedSceneCommand`. Adding a new serialized command without reducer
support should be a type or test failure inside Cangine.

## Acceptance tests requested upstream

1. Property/differential tests show that, for the same valid base scene and
   command batch:

   ```text
   pure reducer result snapshot
   =
   fresh SceneStore + scene.apply(commands) snapshot
   ```

2. Invalid-batch tests show that the pure reducer and scene store reject the
   same hierarchy/reference/limit failures atomically.
3. Fixtures cover every `TSerializedSceneCommand` variant and meaningful
   multi-command ordering combinations.
4. Fixtures cover descendant removal and reparenting with multiple hierarchy
   depths and sibling orders.
5. Tests verify net no-op behavior, bounded before/after images, deterministic
   affected IDs, immutable input/output, and structural sharing.
6. A regression test makes an added serialized-command union member require
   explicit reducer handling.
7. A performance test proves a single non-structural node update does not scan
   or clone an unrelated large scene.

## Vibecanvas migration if accepted

Once this is available, Vibecanvas will:

- replace `fnReduceLocalDocument()` with the Cangine reducer;
- delete its duplicate command interpreter and most of its semantic tests;
- retain only product checks, such as comparing the editor-provided
  `affectedNodeIds` with the reducer result;
- derive persistence operations and product history from the upstream bounded
  before/after result; and
- continue projecting the exact accepted batch once through
  `engine.scene.apply()`.

This gives the application document and retained renderer one authoritative
meaning for every serialized scene command.

## Questions for the Cangine maintainer

Please reply with:

1. Do you agree this belongs in Cangine's public framework-neutral API?
2. Is there already a public or planned pure reducer that we have missed?
3. Would you prefer snapshot input/output, an immutable indexed state, or a
   different contract?
4. Can the result include exact bounded before/after node images and
   deterministic affected IDs?
5. Should `replace-snapshot` be supported by the same function or a companion
   pure operation?
6. If accepted, what release should Vibecanvas wait for?
7. If declined, which supported Cangine primitive should a controlled
   document authority use to avoid reimplementing `ISceneStore.apply()`
   semantics?
