# Cangine feature request: application-owned retained runtime projections

- **Status:** Proposed for discussion
- **Consumer:** Omnidraw
- **Current Cangine version:** 0.3.0
- **Motivating migration:** [`S126`](../../tasks/s/S126.md)

## Summary

Please add a generic runtime service for application-owned retained scene
projections.

The service should let an application render an isolated tree of ordinary
Cangine nodes, including `layer` and `background`, alongside the durable scene
without inserting those nodes into `engine.scene`.

A retained runtime projection should:

- survive `engine.scene.replace()`;
- render through Cangine's normal scheduler and backends;
- support atomic replacement and incremental updates;
- have an owner-scoped lifecycle and revision;
- stay out of `engine.scene.snapshot()`, the scene recorder, and application
  persistence; and
- optionally participate in hit testing through explicit policy.

This is not a request for a Omnidraw grid API. Grid visibility, theme
selection, persistence policy, and product controls remain application
responsibilities.

## Why we need it

Cangine already owns the difficult parts of infinite-grid rendering:

- retained `background` nodes;
- world-space anchoring;
- minor-spacing quantization across zoom;
- major-line spacing;
- renderer ordering;
- scheduling; and
- backend-specific drawing.

Omnidraw only needs to supply two theme colors and a visibility preference.
However, Cangine 0.3.0 exposes background nodes only through the single
retained `engine.scene`.

That creates an ownership mismatch:

```text
CanvasService snapshot       runtime presentation
(authored nodes only)        (background layer + grid)
          \                         /
           \                       /
            merged Cangine scene snapshot
                       |
             engine.scene.replace()
```

`engine.scene.replace()` correctly replaces the entire retained scene.
Therefore an application that has runtime-only retained presentation must
merge it into every durable snapshot replacement and coordinate its updates
with the durable scene revision.

For S126, Omnidraw had to add:

- stable runtime layer/grid IDs;
- a runtime scene composer;
- a second desired presentation value;
- runtime-node preservation during initial load, reload, reconciliation, and
  recovery;
- revision coordination between presentation updates and document commands;
- guards preventing editor mutations from reaching presentation nodes;
- durable validation that reserves the runtime IDs;
- explicit filtering from persistence, history, pending transactions, and
  transport; and
- tests proving that the runtime nodes never cross the durable boundary.

The resulting implementation works, but the bridge is application code around
an engine-level rendering concern. The S126 production change is
`+255/-115`; the runtime scene helper alone is 98 lines, and the document
service carries most of the remaining integration.

## Current API gap

### Retained scene

`engine.scene.apply()` and `engine.scene.replace()` provide the right atomic,
validated retained-scene semantics. They intentionally expose one scene and
one revision.

They do not distinguish between:

- application-durable authored content; and
- application-owned presentation that must be retained by the renderer but
  must not be serialized with the document.

### Transient scene

`engine.transients` provides owner-scoped runtime projections, but it is
designed for temporary interaction visuals.

Transient projections currently reject `layer` and `background` nodes. They
also communicate a different lifecycle and purpose than a grid or other
long-lived application presentation.

Extending transient previews into a second durable-document mechanism would
blur that otherwise useful boundary.

### Runtime services

Cangine already separates other runtime values from serializable scene data:

- resource bytes through `engine.resources`;
- DOM registrations through `engine.portals`;
- named anchors through `engine.geometry`;
- interaction previews through `engine.transients`; and
- animation state through `engine.animations`.

Long-lived application-owned rendering is the missing category.

## Requested capability

The exact API names are not important. One possible shape is:

```ts
export type TRetainedProjectionBand =
  | "background"
  | "world-overlay"
  | "screen-overlay";

export type TRetainedProjectionHitTestMode = "none" | "enabled";

export interface IRetainedSceneProjectionOwner {
  readonly ownerId: string;
  readonly revision: number;

  get(nodeId: TNodeId): Readonly<TSceneNode> | null;
  snapshot(): TSceneSnapshot;

  apply(
    commands: readonly TSerializedSceneCommand[],
    options?: TSceneTransactionOptions,
  ): boolean;

  replace(
    snapshot: TSceneSnapshot,
    options?: TSceneTransactionOptions,
  ): boolean;

  clear(): boolean;
  dispose(): void;
}

export interface IRetainedSceneProjections {
  createOwner(
    ownerId: string,
    options: Readonly<{
      band: TRetainedProjectionBand;
      hitTest?: TRetainedProjectionHitTestMode;
    }>,
  ): IRetainedSceneProjectionOwner;
}

interface IInfiniteCanvasEngine {
  readonly projections: IRetainedSceneProjections;
}
```

A Omnidraw grid would then be ordinary Cangine data:

```ts
const gridProjection = engine.projections.createOwner(
  "omnidraw:grid",
  {
    band: "background",
    hitTest: "none",
  },
);

gridProjection.replace({
  schemaVersion: "1.0.0",
  rootLayerIds: ["background"],
  nodes: [
    {
      id: "background",
      parentId: null,
      orderKey: "0",
      kind: "layer",
      role: "background",
      coordinateSpace: "world",
      transform: IDENTITY_TRANSFORM_2D,
      pointerEvents: "none",
    },
    {
      id: "grid",
      parentId: "background",
      orderKey: "0",
      kind: "background",
      transform: IDENTITY_TRANSFORM_2D,
      pointerEvents: "none",
      background: {
        type: "grid",
        minorSize: 64,
        majorEvery: 4,
        minorColor,
        majorColor,
        lineWidth: 1,
      },
    },
  ],
});
```

Theme and visibility changes would update that owner. A CanvasService snapshot
replacement would continue to use only:

```ts
engine.scene.replace(authoredSnapshot);
```

No application-side snapshot merge or shared revision coordination would be
needed.

## Required semantics

### Isolation from the durable scene

- Projection nodes must not appear in `engine.scene.snapshot()`.
- Projection changes must not increment `engine.scene.revision`.
- `engine.scene.replace()` must not remove or replace projection owners.
- Projection changes must not enter the scene recorder.
- Projection owners need their own monotonic revision.
- Durable scene commands must not be able to mutate projection nodes.
- Projection commands must not be able to mutate durable nodes.

This separation lets the application persist `engine.scene.snapshot()` without
filtering runtime presentation.

### Node support

The minimum useful node set is:

- `layer`;
- `background`; and
- the references required by supported background definitions, such as an
  already registered image or shader resource.

Supporting more ordinary 2D nodes would make the capability reusable for
long-lived application chrome, guides, watermarks, and debug presentation.
HTML portals, embedded 3D, and cross-owner references can remain unsupported
until a concrete use case defines their lifecycle.

### Ordering

The application must be able to choose a stable render band:

- `background`: before durable root layers;
- `world-overlay`: after durable world content; or
- `screen-overlay`: screen-space presentation above world content.

Ordering inside one owner should continue to use normal Cangine hierarchy and
`orderKey` semantics.

Cross-owner ordering should be deterministic. It may use owner creation order,
an explicit owner order key, or a documented `(band, ownerId)` order. The
specific policy matters less than stability.

### IDs and references

Owner-local identity is preferable:

- IDs need only be unique inside one projection owner.
- Durable and projection trees may use the same local node ID without
  collision.
- References may target nodes inside the same owner and already registered
  runtime resources.
- References across projection owners or into the durable scene should fail
  unless Cangine deliberately specifies that contract.

If Cangine requires globally unique IDs internally, the service may namespace
them with the owner ID without exposing those rewritten IDs to application
code.

### Atomicity and no-ops

- `replace()` and `apply()` must validate before publishing.
- Failure must leave the previous projection and revision unchanged.
- One successful call must publish at most one projection revision.
- A semantically equal replacement or command batch should return `false` and
  avoid scheduling a redundant frame.
- Returned nodes and snapshots must be immutable.

These semantics prevent every consumer from implementing its own equality and
revision checks.

### Picking and input

- Hit testing should default to `"none"`.
- `"none"` owners must never appear in pointer, marquee, transform, or editor
  selection results.
- If `"enabled"` is supported, hits must carry the projection owner ID so an
  application cannot confuse them with durable document nodes.

The grid use case requires only `"none"`.

### Resources and rendering

- Projection nodes should retain and release referenced Cangine resources
  through the normal resource manager.
- Projection changes should use the engine's existing coalescing scheduler.
- All renderer backends that support the corresponding durable node kind
  should render it the same way in a projection.
- Destroying the engine must dispose all projection owners.
- Disposing one owner must release its nodes, hits, and resource retention
  atomically.

## Ownership boundary

The proposed service should remain policy-free.

### Cangine owns

- projection storage and validation;
- renderer composition and band ordering;
- scheduling;
- resource retention;
- optional picking;
- owner lifecycle;
- projection revisions; and
- isolation from durable scene snapshots and revisions.

### The application owns

- which projections exist;
- theme values;
- visibility preferences;
- product controls and shortcuts;
- authored document persistence;
- collaboration;
- undo/redo;
- authorization; and
- deciding whether a presentation value should persist elsewhere as a product
  preference.

## What we are not requesting

- A `setGridVisible()` or `setGridTheme()` Cangine API.
- Omnidraw-specific IDs, themes, commands, or persistence rules.
- Automatic CanvasService integration.
- A second application document model.
- Background nodes hidden inside engine configuration.
- Runtime callbacks or renderer objects in serializable scene snapshots.
- Transient interaction previews that accidentally persist.

The desired abstraction is a generic renderer-owned projection surface with an
application-owned lifecycle.

## Alternatives considered

### Continue merging runtime nodes into every durable snapshot

This is the current S126 implementation. It works but requires the document
authority to understand renderer presentation, preserve it during recovery,
reserve IDs, and coordinate unrelated revisions.

It also makes every future runtime-retained feature repeat the same boundary
work.

### Persist the background with authored canvas items

This would incorrectly turn a local visibility preference and active theme
into collaborative document content. It would expose the grid to history,
selection, ordering, export, and storage.

### Use `engine.transients`

Transients reject the required node kinds and are intentionally optimized for
temporary interaction state. A canvas background is long-lived renderer
presentation, not a gesture preview.

### Add a dedicated engine grid setting

That would reduce this one migration but create a special rendering path
outside Cangine's retained node model. It would not solve the same problem for
dots, image backgrounds, watermarks, guides, or application overlays.

### Let UI code call `engine.scene.apply()` directly

That creates a second retained-scene writer and breaks document revision
coordination. It also still leaves runtime nodes vulnerable to the next
`scene.replace()`.

## Expected Omnidraw migration

Once this capability exists, Omnidraw can:

1. create one background projection owner during runtime boot;
2. replace it with the background layer and grid node;
3. update it from theme and visibility policy;
4. dispose it during runtime shutdown;
5. return `CanvasDocumentService` to authored-scene coordination only; and
6. delete runtime grid IDs, snapshot merging, recovery preservation, document
   revision coupling, mutation guards, and related boundary tests.

The CSS grid renderer and camera projection deleted by S126 would stay
deleted. This follow-up would remove the temporary retained-scene bridge as
well.

## Qualification expectations

A Cangine implementation should prove:

- a background projection renders before durable world content;
- projection nodes survive repeated durable `scene.replace()` calls;
- projection changes do not alter the durable scene snapshot or revision;
- equal updates are no-ops;
- invalid updates are atomic;
- owner disposal removes the projection and releases resources;
- non-interactive projections cannot be picked;
- optional interactive hits identify their owner;
- durable and projection-local IDs cannot collide accidentally;
- WebGL2 and SVG render supported projection nodes consistently; and
- engine destruction disposes all owners without requiring application
  cleanup ordering.

## Questions for the Cangine maintainers

1. Does a retained runtime projection fit Cangine's durable-scene/runtime-
   service model, or is there a preferred existing composition mechanism?
2. Should this be a new service, or a deliberately expanded mode of
   `engine.transients` with stronger retained semantics?
3. Should projection IDs be owner-local or remain globally unique?
4. Which render bands can Cangine support without weakening root-layer
   ordering guarantees?
5. Should semantic no-op detection be guaranteed by the projection service or
   left to consumers?
6. Is background/layer support a sufficient first increment, or would a
   general isolated 2D projection be simpler internally?

