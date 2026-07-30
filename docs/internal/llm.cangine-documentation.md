# `@omnidraw/cangine` Library Guide — 0.4.0

This is the consumer guide for the implemented `@omnidraw/cangine`
library. It covers installation, ordinary application usage, every public
engine service and package entrypoint, lifecycle rules, and the ownership
boundary between the engine and its host application.

For normative edge-case behavior, consult [`spec.md`](spec.md). For
implementation status and evidence, see [`FINAL.md`](FINAL.md) and
[`tasks/PROGRESS.md`](tasks/PROGRESS.md). When this guide and the TypeScript
declarations differ, the declarations describe the current checkout and the
specification describes required behavior. The published artifact remains the
authority for what an installed release contains.

## 1. What the library provides

`@omnidraw/cangine` is a retained infinite-canvas engine with:

- validated serializable 2D/3D scene snapshots;
- atomic scene transactions;
- WebGL2 2D rendering;
- camera and coordinate conversion;
- geometry, culling, indexed picking, and marquee queries;
- normalized pointer/touch/wheel/keyboard input;
- selection overlays and transform proposals;
- connectors and widget frames;
- images, fonts, text, and HTML portals;
- deterministic SVG export;
- shared-clock animation;
- optional embedded 3D views;
- opt-in accessibility metadata projection;
- diagnostics, metrics, context-loss recovery, and bounded resource handling.

Its optional `@omnidraw/cangine/editor` subpath adds framework-neutral,
replaceable tool/command/selection/menu/widget/clipboard defaults and an
explicit local linear-history adapter. Renderer core still does **not** own
application persistence, collaboration, product history policy, widget
business logic, permissions, or UI.

## 2. Package status and imports

The checked-in package and qualified artifact version is
`@omnidraw/cangine@0.4.0`. It includes the renderer-free `/scene` entrypoint.
The exact qualified artifact was subsequently published through the
separately authorized local-registry release channel; installed `0.4.0`
consumers can import `/scene`.

The following is a previously verified immutable artifact example containing
compiled ESM and declarations:

```text
artifacts/omnidraw-cangine-0.4.0.tgz
SHA-256 800c517e3705fddefd4c72bc572ee824310134be8ee7ace4eae727679337f130
```

For a separate application, copy the tarball into a version-controlled vendor
directory and install that relative immutable file:

```bash
mkdir -p vendor/cangine
cp /trusted/download/omnidraw-cangine-0.4.0.tgz vendor/cangine/
shasum -a 256 vendor/cangine/omnidraw-cangine-0.4.0.tgz
bun add ./vendor/cangine/omnidraw-cangine-0.4.0.tgz
```

Do not commit an absolute `file:` dependency. Consumers configured for the
selected local registry can replace the relative tarball dependency with the
immutable `0.4.0` version or an appropriate semver range.

Inside this repository, use the workspace dependency so Vite follows the
TypeScript source and preserves engine hot reload:

```json
{
  "dependencies": {
    "@omnidraw/cangine": "workspace:*"
  }
}
```

The checked-in workspace manifest intentionally points exports at `src/`.
The packed manifest points the same public specifiers at compiled `dist/`.
Consumer code must therefore use package specifiers and behave identically in
both modes.

Public entrypoints:

```ts
// Main API and all renderer-neutral public types
import {
  createInfiniteCanvas,
  CanvasEngineError,
  IDENTITY_TRANSFORM_2D,
  IDENTITY_TRANSFORM_3D,
} from "@omnidraw/cangine";
import type {
  ISceneRecorder,
  TRecordConfig,
  TSceneJournalEntry,
} from "@omnidraw/cangine";

// Pure matrix, bounds, path, and order helpers
import {
  composeTransform2D,
  mat3Invert,
  aabbIntersects,
  flattenPath,
  createEvenOrderKeys,
} from "@omnidraw/cangine/geometry";

// Clocks, scene fixtures, validators, and statistics for tests
import {
  ManualClock,
  assertValidSceneSnapshot,
  replayScene,
  stableStringify,
} from "@omnidraw/cangine/testing";

// Advanced backend contracts and the built-in WebGL2 backend
import type { IRenderBackendFactory } from "@omnidraw/cangine/backend";

// Optional framework-neutral standard editing policy
import {
  createCanvasEditor,
  createCanvasMenuController,
} from "@omnidraw/cangine/editor";

// Pure serialized-command reduction for controlled hosts
import {
  createSceneReductionState,
  reduceSerializedSceneCommands,
  sceneReductionStateSnapshot,
} from "@omnidraw/cangine/scene";
```

The `0.4.0` package exposes these entrypoints:

| Entrypoint | Intended use |
|---|---|
| `@omnidraw/cangine` | Engine creation, constants, order helpers, stroke sampling, and all renderer-neutral types |
| `@omnidraw/cangine/types` | The same renderer-neutral type/runtime surface when an explicit type subpath is preferred |
| `@omnidraw/cangine/geometry` | Pure bounds, matrix, order, and path helpers |
| `@omnidraw/cangine/testing` | Deterministic clocks, fixtures, validation, replay, equality, and statistics |
| `@omnidraw/cangine/scene` | Renderer-free serialized-command reduction over opaque immutable scene state |
| `@omnidraw/cangine/editor` | Optional editor lifecycle, tools, commands, selection, menus, widget modes, clipboard import, and replaceable history |
| `@omnidraw/cangine/integrations/capsule` | Optional duck-typed Capsule portal adapter; does not depend on `@omnidraw/capsule` |
| `@omnidraw/cangine/backend` | Advanced renderer-backend contracts and the built-in WebGL2 factory |
| `@omnidraw/cangine/package.json` | Release metadata in the packed artifact |

See [§11.2.1](#1121-public-pure-command-reduction) for the `/scene` consumer
shape and ownership boundary.

The root does not re-export `/scene`, `/editor`, or
`/integrations/capsule`. A core-only/headless consumer never evaluates the
public `/scene` handle layer, editor, or Capsule-integration entrypoint. The
package-private immutable transition kernel is shared with the root engine's
`SceneStore`; the optional entrypoints otherwise depend only on
renderer-neutral core contracts. React, another UI framework,
CRDT/persistence, product services, and Capsule itself are not Cangine package
dependencies.

Deep imports are unsupported. Normal consumers should use the root and
geometry entrypoints. Testing utilities should stay in tests, and backend
imports should be reserved for authors implementing or explicitly constructing
a render backend.

### 2.1 Current implementation support

The shipped production path is:

- standards-compliant ESM with TypeScript declarations, verified with Bun
  `1.3.14+` and native Node `20.19.0+`;
- browser execution on Chromium, Firefox, and WebKit;
- WebGL2 retained 2D rendering;
- optional Three.js-backed WebGL2 embedded 3D;
- DOM portals;
- deterministic SVG export;
- main-thread execution.

WebGPU rendering, active render-worker execution, and live SVG rendering remain
capability-reported but unavailable production paths. Always inspect
`engine.capabilities`; requesting a feature is not proof that it initialized.
The immutable package is verified through Bun and native Node imports of every
public entrypoint, Vitest 4 default dependency externalization, strict
TypeScript 7, Vite 8 production build, and Chromium render/destroy smoke tests.

## 3. Host setup

The engine mounts its browser surfaces under one host element. Give the host an explicit size:

```html
<div id="canvas-host" aria-label="Diagram canvas"></div>
```

```css
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
}

#canvas-host {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: none;
}
```

The engine owns only surfaces it creates under the host. Always call `destroy()` when the host is removed.

## 4. Minimal working example

```ts
import {
  createInfiniteCanvas,
  IDENTITY_TRANSFORM_2D,
  type TSceneSnapshot,
} from "@omnidraw/cangine";

const host = document.querySelector<HTMLElement>("#canvas-host");
if (host === null) throw new Error("Canvas host is missing");

const engine = await createInfiniteCanvas({
  host,
  renderProfile: {
    vector2D: "webgl2",
    threeD: "disabled",
    portals: "disabled",
    antialias: true,
  },
  initialCamera: {
    center: { x: 320, y: 180 },
    zoom: 1,
    rotation: 0,
  },
  diagnostics: {
    enabled: true,
    collectFrameMetrics: true,
    warnOnFullRebuild: true,
  },
});

const scene: TSceneSnapshot = {
  schemaVersion: "1.0.0",
  rootLayerIds: ["content"],
  nodes: [
    {
      id: "content",
      kind: "layer",
      parentId: null,
      orderKey: "A",
      transform: IDENTITY_TRANSFORM_2D,
      role: "content",
      coordinateSpace: "world",
    },
    {
      id: "welcome-card",
      kind: "rect",
      parentId: "content",
      orderKey: "A",
      transform: {
        ...IDENTITY_TRANSFORM_2D,
        position: { x: 120, y: 90 },
      },
      size: { width: 240, height: 140 },
      radius: 16,
      fill: {
        type: "solid",
        color: { space: "srgb", r: 0.12, g: 0.42, b: 0.92, a: 1 },
      },
      stroke: {
        width: 2,
        paint: {
          type: "solid",
          color: { space: "srgb", r: 0.04, g: 0.12, b: 0.3, a: 1 },
        },
      },
      accessibility: {
        role: "img",
        label: "Blue welcome card",
      },
    },
  ],
};

engine.scene.replace(scene);
const result = await engine.renderNow();
console.log(result.frameId, result.missingResources);

// Later, when unmounting the application view:
await engine.destroy();
```

`createInfiniteCanvas()` resolves only after initialization succeeds. The engine is normally in the `ready` state when returned.

## 5. Core mental model

### 5.1 Durable scene versus runtime services

The durable scene contains plain data only:

- IDs, transforms, geometry, styles, references, metadata, and extensions;
- no DOM elements;
- no callbacks;
- no WebGL, Three.js, FontFace, ImageBitmap, or other renderer objects;
- no Automerge or application service objects.

Runtime values are registered through services:

- image/font/mesh bytes through `engine.resources`;
- portal mount callbacks through `engine.portals`;
- runtime named anchors through `engine.geometry`;
- transient animation through `engine.animations`;
- selection and transform previews through `engine.transforms`.

### 5.2 IDs are the boundary

Application code should store IDs and plain scene data. Do not retain internal backend objects or attempt to mutate returned nodes.

### 5.3 The scene is retained and incremental

A transaction validates and publishes a new immutable generation. The engine then updates only affected geometry, indexes, resources, and GPU ranges. A static scene does not render continuously.

### 5.4 One scheduler

Scene changes, camera changes, portals, animation, overlays, resources, and 3D use one coalescing scheduler. Do not create a second rendering loop around `renderNow()`.

## 6. Configuration

The required configuration is:

```ts
const engine = await createInfiniteCanvas({
  host,
  renderProfile: {
    vector2D: "webgl2",
    threeD: "disabled",
    portals: "disabled",
  },
});
```

Important options:

| Option | Purpose |
|---|---|
| `host` | Engine-owned browser surface parent |
| `renderProfile` | Requested 2D, 3D, and portal backends |
| `executionMode` | Requested main-thread or render-worker execution; inspect capabilities for the actual result |
| `initialCamera` | Initial center, zoom, and rotation |
| `minZoom` / `maxZoom` | Camera zoom policy |
| `devicePixelRatio` | Fixed value or sampling callback |
| `maxDevicePixelRatio` | Upper bound for sampled DPR |
| `resourceLoader` | Application-provided async resource source loader |
| `clock` | Deterministic/custom monotonic clock |
| `logger` | Structured application logger |
| `diagnostics` | Metrics, transaction tracing, and warning policy |
| `record` | Opt-in durable scene-journal recorder; exposes `engine.recorder` |
| `accessibility` | Opt-in canvas-node metadata projection |
| `validationLimits` | Scene and serialized-data ceilings |
| `transientLimits` | Owner, node, hierarchy, replacement, and indexed-transient ceilings |
| `renderWorkLimits` | Geometry/compiler/query ceilings |
| `resourceLimits` | Registry, byte, stream, and decoded-pixel ceilings |
| `threeDLimits` | Mesh, draw, light, raster, and raycast ceilings |
| `backendFactories` | Advanced custom backend injection |

### Recommended production profile

```ts
const engine = await createInfiniteCanvas({
  host,
  renderProfile: {
    vector2D: "webgl2",
    threeD: "webgl2", // use "disabled" if the product does not need 3D
    portals: "dom",   // use "disabled" if the product does not need portals
    antialias: true,
    powerPreference: "high-performance",
    fallbackOrder: ["webgl2"],
  },
  maxDevicePixelRatio: 2,
});
```

The implemented production renderer is WebGL2-first. Render-worker activation, a production WebGPU renderer, and live SVG are deferred. Use capability reporting instead of assuming a requested optional backend was enabled.

## 7. Capabilities and fallback

Read actual capabilities after creation:

```ts
console.table(engine.capabilities);

if (engine.capabilities.threeD === "disabled") {
  // Hide or replace product controls that require 3D.
}

if (!engine.capabilities.supportsSvgExport) {
  // Do not expose SVG export.
}
```

Useful fields include:

- `vector2D`, `threeD`, and `portals`;
- `webGpuAvailable` and `webGl2Available`;
- `renderWorkerActive`;
- `supportsGpuPicking`;
- `supportsLiveSvg`;
- `supportsSvgExport`;
- `supportsCustomShaders`;
- texture/sample limits and unsupported node kinds.

The current 3D implementation uses CPU raycasting, so `supportsGpuPicking` does not become true merely because 3D picking works.

## 8. Coordinate systems and transforms

### 8.1 2D conventions

- World units are logical CSS pixels at zoom `1`.
- Positive X points right.
- Positive Y points down.
- Positive 2D rotation is clockwise, in radians.
- Public calculations use JavaScript double precision.

### 8.2 Transform shape

Every 2D node has a complete transform:

```ts
const transform = {
  position: { x: 100, y: 50 },
  rotation: Math.PI / 8,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 40, y: 30 },
};
```

Use the identity constant when possible:

```ts
const moved = {
  ...IDENTITY_TRANSFORM_2D,
  position: { x: 100, y: 50 },
};
```

The constants and returned values should be treated as immutable.

### 8.3 Camera conversions

```ts
const viewportPoint = engine.camera.clientToViewport({
  x: pointerEvent.clientX,
  y: pointerEvent.clientY,
});
const worldPoint = engine.camera.viewportToWorld(viewportPoint);
const clientPoint = engine.camera.worldToClient(worldPoint);
```

Other useful operations:

```ts
engine.camera.panByScreen({ x: 20, y: 0 });
engine.camera.panByWorld({ x: 100, y: 0 });
engine.camera.zoomAtViewportPoint(2, { x: 400, y: 300 });
engine.camera.rotateAtViewportPoint(Math.PI / 12, { x: 400, y: 300 });

await engine.camera.fitBounds(
  { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
  { padding: 32, durationMs: 250, easing: "ease-out" },
);
```

Camera animation promises reject with `AbortError` when cancelled or replaced.

## 9. Scene nodes

All nodes share:

```ts
{
  id: string;
  parentId: string | null;
  orderKey: string;
  transform: TTransform2D;
  visibility?: "visible" | "hidden" | "inherited";
  opacity?: number;
  blendMode?: TBlendMode;
  pointerEvents?: "auto" | "none" | "bounds-only" | "painted";
  clip?: TClipDefinition;
  effects?: TEffect[];
  accessibility?: TAccessibilityNode;
  metadata?: TJsonObject;
  extensions?: Record<string, TJsonValue>;
}
```

Implemented node kinds:

| Kind | Purpose |
|---|---|
| `layer` | Root world/screen rendering layer |
| `group` | Nested transform/opacity/clip container |
| `background` | Solid, grid, dots, image, or trusted shader reference |
| `rect` | Rectangle with optional normalized corner radii |
| `ellipse` | Ellipse in a local size rectangle |
| `polygon` | Open/closed polygon with fill rule |
| `path` | Move/line/quadratic/cubic/arc/close path |
| `image` | Resource-backed image with fit/crop/tint |
| `text` | Shared-layout styled text runs |
| `connector` | Routed line/arrow with anchors and markers |
| `widget-frame` | Fixed engine-owned window chrome and portal slot |
| `html-portal` | Application DOM placement |
| `view-3d` | Embedded 3D viewport |

### Fixed widget frames

Widget chrome is intentionally fixed. Supply only geometry, an optional
single-line title, an optional title-bar color, declarative header actions, and
an optional portal:

```ts
const widget = {
  id: "widget-1",
  kind: "widget-frame" as const,
  parentId: "content",
  orderKey: "M",
  transform: {
    ...IDENTITY_TRANSFORM_2D,
    position: { x: 240, y: 160 },
  },
  size: { width: 520, height: 360 },
  title: "Widget AI Wizzard",
  titleBarColor: {
    space: "srgb" as const,
    r: 1,
    g: 0.953,
    b: 0.72,
    a: 1,
  },
  headerItems: [
    {
      type: "button" as const,
      id: "refresh",
      label: "Refresh widget",
      content: { type: "text" as const, text: "Refresh" },
    },
    {
      type: "dropdown" as const,
      id: "more",
      label: "More actions",
      content: { type: "text" as const, text: "•••" },
      items: [
        { id: "duplicate", text: "Duplicate" },
        { id: "archive", text: "Archive" },
      ],
    },
  ],
  portal: {
    portalId: "widget-1-content",
    scaleMode: "world" as const,
    interactive: true,
  },
  resizable: true,
};
```

The engine always draws red close, yellow minimize, and green
canvas-maximize lights at the leading edge. Title-bar height is 36 local units
and does not change when the frame resizes. Radius, body, border, shadow,
traffic lights, spacing, and typography are fixed; `titleBarColor` is the only
chrome styling input.

Header content is text or a registered image resource. To use an SVG icon,
register it through the same bounded image-resource pipeline used by image
nodes and reference its resource ID. Never put raw SVG/XML in scene data.
Dropdowns are flat and text-only. On a narrow frame the engine keeps trailing
actions and hides leading actions before they can overlap the traffic/title
lane.

The minimum size is 80×36 without a title or 116×36 with one. `minSize` may
raise but not lower that bound. Resize commits intrinsic `size` and the
proposal's anchor position; it never persists transform scale. Standard
widgets do not rotate.

Stable hit parts are `traffic-light:close|minimize|maximize`,
`header-item:<id>`, `title-bar`, `content`, `body`, and `resize:<edge>`.
Renderer core does not execute business actions. The optional editor converts
them into typed intents, owns the shared canvas dropdown, and leaves
close/minimize/custom effects to your product.

The old pre-1.0 `style`, `subtitle`, `iconResourceId`, `controls`, and `active`
fields are rejected. Migrate fixtures explicitly; the snapshot envelope still
uses schema `1.0.0` because no 1.0 scene schema has been published.

Grid backgrounds treat `minorSize` as a base world interval. At render time the
engine quantizes it by powers of two to keep minor lines between 24 and 96 CSS
pixels apart where possible, with a lower world-size bound of
`minorSize / 4`. Major spacing remains `effectiveMinor × majorEvery`, and the
grid stays anchored to its world-space origin while panning.

### Root layers

Root layers:

- have `parentId: null`;
- are listed in `rootLayerIds`;
- use an identity transform for schema `1.0.0`.

Every non-layer 2D node must resolve through its parent chain to a root layer.

### Ordering

Siblings render by `(orderKey, id)`. Treat `orderKey` as opaque. For initial bulk creation, assign deterministic keys. For later movement, prefer transaction helpers:

```ts
engine.scene.transaction((tx) => {
  tx.moveBefore("node-b", "node-a");
  tx.moveToFront("selected-node");
});
```

The root entrypoint exports `createEvenOrderKeys()`, `orderKeyBetween()`, and `isCanonicalOrderKey()`. Allocation is capped at one million keys; rebalance and insertion in one transaction.

For hierarchy policy, use `scene.ancestorsOf(id)` or `scene.closestAncestor(id, predicate)` instead of duplicating parent-chain walks. These use retained parent links and never scan the full scene.

## 10. Paint, stroke, clips, and effects

### Solid and gradient paints

```ts
const solid = {
  type: "solid" as const,
  color: { space: "srgb" as const, r: 0.2, g: 0.5, b: 0.9, a: 1 },
};

const gradient = {
  type: "linear-gradient" as const,
  from: { x: 0, y: 0 },
  to: { x: 200, y: 0 },
  stops: [
    { offset: 0, color: { space: "srgb" as const, r: 1, g: 0.2, b: 0.2, a: 1 } },
    { offset: 1, color: { space: "srgb" as const, r: 0.2, g: 0.2, b: 1, a: 1 } },
  ],
  space: "local" as const,
};
```

Colors are straight encoded values in `[0, 1]` and must be tagged `srgb` or `display-p3`.

### Stroke

```ts
const stroke = {
  width: 3,
  paint: solid,
  alignment: "center" as const,
  cap: "round" as const,
  join: "round" as const,
  dash: [8, 4],
};
```

### Clip

```ts
const clip = {
  type: "rect" as const,
  rect: { x: 0, y: 0, width: 240, height: 160 },
  radius: {
    topLeft: 16,
    topRight: 16,
    bottomRight: 16,
    bottomLeft: 16,
  },
};
```

Node-reference clips use the target node’s transformed intrinsic fill geometry, not its paint/effects.

## 11. Atomic scene mutation

### 11.1 Transactions

```ts
engine.scene.transaction(
  (tx) => {
    tx.update("welcome-card", (current) => {
      if (current.kind !== "rect") {
        throw new Error("welcome-card changed kind");
      }
      return {
        ...current,
        transform: {
          ...current.transform,
          position: { x: 180, y: 120 },
        },
      };
    });

    tx.upsert({
      id: "badge",
      kind: "ellipse",
      parentId: "content",
      orderKey: "B",
      transform: {
        ...IDENTITY_TRANSFORM_2D,
        position: { x: 390, y: 100 },
      },
      size: { width: 36, height: 36 },
      fill: {
        type: "solid",
        color: { space: "srgb", r: 1, g: 0.25, b: 0.18, a: 1 },
      },
    });
  },
  { source: "move-and-badge", render: "schedule" },
);
```

If any operation or validation fails, the entire transaction rolls back and the scene revision remains unchanged. Nested transactions join the outer transaction; a failed nested unit poisons the whole outer unit.

### 11.2 Serialized commands

For application projections or worker-safe data paths:

```ts
engine.scene.apply([
  { type: "reorder", nodeId: "badge", orderKey: "Z" },
  { type: "remove", nodeId: "obsolete", descendants: "remove" },
]);
```

### 11.2.1 Public pure command reduction

Version `0.4.0` provides an optional renderer-free
`@omnidraw/cangine/scene` entrypoint for controlled hosts that need to apply
Cangine's exact serialized-command semantics to immutable application
projection state before sending the same batch to `engine.scene.apply()`.

The API is:

```ts
import type { TSerializedSceneCommand } from "@omnidraw/cangine";
import {
  createSceneReductionState,
  reduceSerializedSceneCommands,
  sceneReductionStateSnapshot,
  type TSceneReductionState,
  type TSerializedSceneCommandReduction,
} from "@omnidraw/cangine/scene";

let reductionState = createSceneReductionState(authoritativeSnapshot);

function reduceForDocument(
  commands: readonly TSerializedSceneCommand[],
): TSerializedSceneCommandReduction {
  const reduction = reduceSerializedSceneCommands(reductionState, commands);

  // The host applies reduction.changes to its document, then projects the
  // unchanged command batch through engine.scene.apply().
  reductionState = reduction.state;
  return reduction;
}

const portableSnapshot = sceneReductionStateSnapshot(reductionState);
```

The public state is nominal, package-authenticated, observationally immutable,
and indexed for small-update work avoidance. The handle is not structured
cloneable or transferable. Send
`sceneReductionStateSnapshot(state)` through the worker/message boundary and
call `createSceneReductionState()` in the destination worker/runtime; the
`/scene` module itself is renderer- and DOM-free.

Each successful result contains deterministic net `changes` with exact
`before` and `after` node images. Derive IDs with
`reduction.changes.map(change => change.nodeId)`. A controlled host may assert
that those IDs are a subset of the editor request's conservative
`affectedNodeIds`; equality is not required because commands can cancel or be
semantic no-ops.

The host must pair the reduction state with the same document/projection basis
as `request.basisSceneRevision`, reject stale requests before mutation, and
advance the pair only after document acceptance and exact engine projection.
The reducer does not own application revisions, history, persistence,
collaboration, authorization, retries, resources, or rollback policy.

No-op batches return the exact input state. Replacement mode is reported
whenever a `replace-snapshot` command executes, even if later commands restore
the original value. Full replacement and snapshot materialization may be
`O(n)`; ordinary leaf changes remain proportional to their affected
validation/index closure.

The normative contract is [`spec.md` §45](spec.md#45-public-pure-serialized-command-reduction);
the architecture and execution gate are
[ADR-0019](tasks/decisions/0019-pure-serialized-command-reducer.md) and
[A46](tasks/a/A46.md). The entrypoint is part of the `0.4.0` package artifact;
the separately authorized local-registry workflow published that exact
qualified artifact.

### 11.3 Snapshots

```ts
const snapshot = engine.scene.snapshot();
const json = JSON.stringify(snapshot);

// Later:
engine.scene.replace(JSON.parse(json));
```

Snapshots contain no runtime resource handles or portal callbacks. Unknown namespaced extensions round-trip.

### 11.4 Change subscriptions

```ts
const unsubscribe = engine.scene.subscribe((change) => {
  console.log(change.revision, change.added, change.updated, change.removed);
});

// Later
unsubscribe();
```

Listener failures are isolated, but application listeners should still avoid unbounded synchronous work.

### 11.5 Optional scene journal recorder

Enable `record` when the application needs an ordered, replayable record of
committed durable scene transactions. The recorder is absent by default, so
`engine.recorder` is `null` and commits do not pay recorder capture cost unless
the option is enabled.

```ts
import {
  createInfiniteCanvas,
  type ISceneRecorder,
  type TSceneJournalEntry,
} from "@omnidraw/cangine";

const engine = await createInfiniteCanvas({
  host,
  renderProfile: {
    vector2D: "webgl2",
    threeD: "disabled",
    portals: "disabled",
  },
  record: {
    actor: "editor-42", // optional; adds an HLC stamp to entry metadata
    capacity: 1_024, // optional; this is also the default
    maxRetainedWeight: 5_000_000, // optional deterministic logical-weight bound
  },
});

const recorder: ISceneRecorder | null = engine.recorder;
if (recorder === null) throw new Error("Recorder was not enabled");

const unsubscribe = recorder.subscribe((entry: TSceneJournalEntry) => {
  // Persist, group, or project this entry according to application policy.
  console.log(
    entry.seq,
    entry.logicalWeight,
    entry.commands,
    entry.before,
    entry.meta,
  );
});

engine.scene.transaction(
  (tx) => tx.update("welcome-card", (node) => ({
    ...node,
    transform: {
      ...node.transform,
      position: { x: 180, y: 120 },
    },
  })),
  { source: "drag", coalesceKey: "pointer-17" },
);

const entries = recorder.read({ sinceSeq: 0, limit: 100 });
unsubscribe();
```

Each entry is frozen, serializable, and contains canonical replay commands,
the affected nodes' before-images, the scene change-set, and optional metadata.
`logicalWeight` is the deterministic retained-data policy charge for the entry;
it is not a claim about VM heap bytes. Unchanged store-proven immutable
subtrees are shared across committed node versions, so a transform-only path
edit retains a small node/transform branch rather than cloning the path.
The journal sequence is independent of the scene revision. `source` and
`coalesceKey` flow from the transaction options into `entry.meta`; an `actor`
adds a hybrid-logical-clock (`hlc`) stamp using the configured engine clock.

The recorder begins in the `"recording"` state. `start()` and `stop()` are
idempotent; stopping retains existing entries. `clear()` drops retained entries
without resetting the journal sequence. `checkpoint()` appends a
`replace-snapshot` entry for the current immutable scene snapshot. Retention is
checkpoint plus tail: when either `capacity` or `maxRetainedWeight` is exceeded,
the recorder keeps a fresh checkpoint and discards older entries whose effects
that checkpoint represents. `recorder.retainedWeight` exposes the current
logical charge. A scene checkpoint larger than the weight limit is retained as
the one exact replay base rather than silently losing the scene.
The engine destroys its recorder during `engine.destroy()`; application code
normally owns only its `subscribe()` unsubscriber.

The engine owns this capture mechanism only. Applications own undo/redo step
grouping, persistence, collaboration, actor identity policy, and filtering of
entries such as initialization, undo, or redo. To replay a base snapshot and a
journal tail in tests or adapters, use `replayScene` from the testing entrypoint:

```ts
import {
  assertSnapshotsEqual,
  replayScene,
} from "@omnidraw/cangine/testing";

// `targetScene` is a fresh ISceneStore from a second engine or test harness.
replayScene(baseSnapshot, entries, targetScene);
assertSnapshotsEqual(expectedSnapshot, targetScene.snapshot());
```

### Application-owned transient scenes

Use `engine.transients` for bounded temporary 2D nodes that need normal engine
geometry, rendering, and optional indexed picking without entering the durable
scene, recorder, SVG export, accessibility projection, portal manager, or 3D
store.

```ts
const ghost = engine.transients.createOwner("sidebar-widget-drop");

ghost.replace({
  band: "world-overlay",
  hitTest: "none",
  nodes: [{
    id: "widget-drop-ghost",
    kind: "widget-frame",
    parentId: null,
    orderKey: "A",
    transform: {
      ...IDENTITY_TRANSFORM_2D,
      position: { x: 320, y: 180 },
    },
    size: { width: 280, height: 180 },
    title: "Draft Preview",
  }],
});

// Replace the complete owner projection as the pointer moves.
// A semantically identical replacement is a no-op.
ghost.clear();
ghost.destroy();
```

`world-overlay` uses canonical world coordinates. `screen-overlay` uses
viewport CSS pixels, which is useful for constant-size handles. Set `hitTest:
"enabled"` only when the application needs transient hits; those results carry
`transientOwnerId`. Owners are isolated, node IDs are globally unique, and a
replacement is copied, validated, frozen, and published atomically. A durable
commit of the same IDs clears the complete colliding owner during the handoff.

Transient owners may contain groups, shapes, images, text, connectors, and
portal-free widget frames. They may reference already registered resources but
cannot register or own them. Layers, backgrounds, HTML portals, embedded 3D,
accessibility, metadata, extensions, custom callbacks, and durable parents are
not accepted. The application remains responsible for gesture/session state,
commit policy, history, collaboration, and clearing every exit path.

For clone previews, prepare a durable subtree without reconstructing it by
hand:

```ts
const cloneOwner = engine.transients.createOwner("alt-drag-clone");
const clone = engine.transients.cloneFromScene({
  sourceNodeIds: selectedNodeIds,
  mapId(sourceId) {
    return cloneIds.get(sourceId) ?? `preview:${sourceId}`;
  },
  // Optional world-space transform applied after each source root's world matrix.
  transform: dragPreviewMatrix,
  portals: "omit",
  // On later move updates, pass the live owner so stable mapIds may reuse the
  // current preview occupancy without clearing first.
  replaceOwnerId: cloneOwner.id,
});
cloneOwner.replace(clone.projection);

// Every terminal path—drop, cancel, blur, route change, teardown:
cloneOwner.destroy();
```

The helper is pure: it does not publish, retain resources, record, mount
portals, or schedule a frame. It normalizes nested roots, preserves world
appearance, remaps internal references, omits application metadata, and returns
the durable-to-transient ID map. The application still owns ID allocation,
gesture state, product cloning, commit/history policy, and the final
`owner.replace()` lifecycle. Pass `replaceOwnerId` when re-preparing a ghost
that the same owner will publish next.

## 12. Rendering and lifecycle

Most changes schedule a coalesced frame automatically. Use `renderNow()` when the caller needs completion:

```ts
const rendered = await engine.renderNow({
  includePortals: true,
  awaitResources: true,
});

console.log(rendered.missingResources, rendered.skippedNodeIds);
```

Other lifecycle methods:

```ts
engine.invalidate("application-overlay-changed");
engine.suspend();
engine.resume();
engine.resize(); // return to automatic host sizing
engine.resize({ width: 1024, height: 768 }); // explicit/manual size
await engine.destroy();
```

After `destroy()`, do not call services. Destruction is idempotent from the engine’s ownership perspective and should be awaited during application teardown.

## 13. Geometry service

The geometry service is authoritative and renderer-independent:

```ts
const worldBounds = engine.geometry.worldBounds("welcome-card");
const localBounds = engine.geometry.localBounds("welcome-card");
const matrix = engine.geometry.worldTransform("welcome-card");
const local = engine.geometry.worldToLocal("welcome-card", { x: 200, y: 140 });
const nearest = engine.geometry.nearestPoint("welcome-card", { x: 500, y: 300 });
```

Queries include:

- local/world/inverse transforms;
- local/world/oriented/union bounds;
- rectangle and polygon intersections;
- nearest point;
- built-in or runtime named anchors;
- connector routes and label placement;
- path length, sample, flattening, and intersections.

Runtime anchors:

```ts
const unregisterAnchors = engine.geometry.registerNamedAnchors("welcome-card", {
  "input-a": { x: 0, y: 40 },
  "output-a": { x: 240, y: 40 },
});

// Remove when the application definition changes:
unregisterAnchors();
```

## 14. Input, hit testing, and spatial queries

### Event subscription

```ts
const unsubscribeInput = engine.input.subscribe((event) => {
  if (event.type === "pointer-down" && event.hit !== null) {
    console.log("Clicked", event.hit.nodeId, event.hit.part);
    return {
      handled: true,
      capturePointer: true,
      preventDefault: true,
    };
  }

  if (event.type === "wheel") {
    engine.camera.zoomAtViewportPoint(
      engine.camera.state.zoom * Math.exp(-event.delta.y * 0.001),
      event.viewport,
    );
    return { handled: true, preventDefault: true };
  }
});
```

Events carry named client, viewport, and world coordinates where applicable. Pointer events also include deltas and the current topmost hit.

Every normalized `pointer-cancel` includes a `cancelReason`. A captured,
still-active pointer whose browser `lostpointercapture` reports `buttons: 0`
gets a bounded 50 ms reconciliation window: a matching `pointer-up` remains an
ordinary release/transform commit, while native cancellation, blur, context
loss, surface removal, destruction, pointer-ID replacement, or timeout still
cancels exactly once. Consumers should continue reacting only to normalized
events; they do not need their own lost-capture timer.

### Click and double-click recognition

Use the opt-in recognizer instead of pairing raw pointer events:

```ts
const clicks = engine.input.createClickRecognizer({
  movementTolerancePx: 5,
  clickTimeoutMs: 500,
  doubleClickTimeoutMs: 500,
  touchDoubleTap: "disabled",
});

const unsubscribeClicks = clicks.subscribe((event) => {
  if (event.type === "click") activateFromPointer(event.hit);
  if (event.type === "double-click") openFromPointer(event.hit);
});

const unsubscribeDrag = engine.input.subscribe((event) => {
  if (event.type === "pointer-move" && dragHasActivated(event)) {
    return { suppressClick: true };
  }
});

// Route/tool teardown:
unsubscribeDrag();
unsubscribeClicks();
clicks.destroy();
```

Recognition runs after dispositions and engine default actions. Suppression is
sequence-scoped and irreversible once any listener or activated engine drag
returns it. Valid clicks require matching primary down/up, same normalized hit
identity, bounded time/movement, and no cancellation, blur, lost capture,
surface removal, context loss, or destruction. Single clicks emit immediately;
the second independently valid compatible click is followed by one
double-click. Keyboard and accessibility activation remain separate
application policy.

### Programmatic picking

```ts
const top = engine.input.hitTestWorld(
  { x: 220, y: 140 },
  { mode: "topmost", tolerance: 2 },
)[0] ?? null;

const all = engine.input.hitTestViewport(
  { x: 400, y: 300 },
  { mode: "all", kinds: ["rect", "ellipse", "connector"] },
);
```

### Marquee

```ts
const rectangleHits = engine.input.queryWorldRect(
  { minX: 0, minY: 0, maxX: 800, maxY: 600 },
  { mode: "all" },
);

const lassoHits = engine.input.queryWorldPolygon(
  [
    { x: 20, y: 20 },
    { x: 500, y: 40 },
    { x: 420, y: 420 },
    { x: 40, y: 360 },
  ],
  { mode: "all" },
);
```

Do not implement your own full-scene scan for pointer movement. Use these indexed services.

## 15. Selection and transform proposals

The application or optional editor owns selected IDs. Renderer core owns the
visual affordance and emits proposals.

```ts
engine.transforms.setSelection({
  nodeIds: ["welcome-card"],
  focusedNodeId: "welcome-card",
  appearance: {
    outline: {
      width: 2,
      paint: {
        type: "solid",
        color: { space: "srgb", r: 0.1, g: 0.45, b: 1, a: 1 },
      },
    },
    handleFill: {
      type: "solid",
      color: { space: "srgb", r: 1, g: 1, b: 1, a: 1 },
    },
    handleStroke: {
      width: 1,
      paint: {
        type: "solid",
        color: { space: "srgb", r: 0.1, g: 0.45, b: 1, a: 1 },
      },
    },
    handleSize: 8,
    rotateHandleOffset: 24,
  },
  policy: {
    handles: [
      "move",
      "rotate",
      "resize-nw",
      "resize-ne",
      "resize-se",
      "resize-sw",
    ],
    aspectRatioMode: "shift-lock",
    allowRotate: true,
    allowFlip: false,
    previewMode: "ephemeral-engine-preview",
  },
});
```

`aspectRatioMode` is dynamic: `"free"` never couples axes, `"locked"` always
preserves the gesture-start ratio, `"shift-lock"` locks while Shift is down,
and `"shift-invert"` locks while Shift is up. The image default in the
optional editor is `shift-invert`; ordinary shapes/groups use `shift-lock`.
For otherwise-compatible multi-selections, the standard resolver chooses the
strongest conservative mode in the order `locked`, `shift-invert`,
`shift-lock`, `free`, so any image-containing selection remains
ratio-preserving until Shift is held. A mixed selection containing any member
with intrinsic min/max bounds exposes only its common move/rotate handles:
one aggregate frame bound cannot preserve every rotated member under
non-uniform scaling. This prevents an invalid constrained-node preview from
later snapping back on scene validation. Do not also use Shift for an
application grid adjuster. Proposal adjusters remain the separate snapping
extension point.

The drawn `handleSize` is not the acquisition target. Core uses at least
24×24 viewport CSS pixels for mouse/pen and 44×44 for touch, resolves overlap
by nearest center and a fixed tie order, and exposes mouse/pen cursor state:

```ts
const unsubscribeTransformHover = engine.transforms.subscribeHover((hover) => {
  host.style.cursor = hover?.cursor ?? activeToolCursor;
});
```

Rotate reports `grab`; move reports `move`; resize reports a directional
cursor aligned to the actual viewport-space axis. Touch has no hover. This
state is immutable, frame-free, and clears with selection/gesture/lifecycle
changes.

`engine.transforms.applyPreview(proposals, { stacking: "front" })` may
temporarily present selected preview roots above their durable siblings without
changing order keys. Use the default `"preserve"` for ordinary transforms;
the standard widget controller uses `"front"` for canvas-maximized mode.

Persist a committed transform in application history and the scene:

```ts
const unsubscribeTransforms = engine.transforms.subscribe((event) => {
  if (event.type !== "transform-commit") return;

  // Create the application-owned history entry here.
  engine.scene.transaction((tx) => {
    for (const proposal of event.proposals) {
      tx.update(proposal.nodeId, (node) => ({
        ...node,
        transform: proposal.nextTransform,
      }));
    }
  }, { source: `transform:${event.gestureId}` });
});
```

If `proposal.nextSize` is present, apply it to that kind's intrinsic size or
layout width. Never silently drop it behind an incomplete kind allowlist.
Widget/image/shape resize preserves authored transform scale. The optional
standard editor normalizes committed text to fixed layout and maps its locked
corner resize to uniform font-size, explicit line-height, and box-size changes.
The engine never creates the application history entry for you.

A snapping system can register a proposal adjuster:

```ts
const unregisterSnap = engine.transforms.registerProposalAdjuster((context) => {
  return context.proposals.map((proposal) => ({
    ...proposal,
    nextTransform: {
      ...proposal.nextTransform,
      position: {
        x: Math.round(proposal.nextTransform.position.x / 10) * 10,
        y: Math.round(proposal.nextTransform.position.y / 10) * 10,
      },
    },
  }));
});
```

Generic creation mechanics are available through `engine.interactions`. Start a session from your input subscriber and commit once:

```ts
engine.interactions.beginCreation(pointerDownEvent, {
  thresholdViewport: 4,
  onCommit(draft) {
    if (draft.belowThreshold) return;
    // Map draft.worldBounds to one application-owned scene transaction.
  },
});
```

Interrupted-drawing recovery is automatic; there is no recovery option to configure. An ordinary `pointer-up` commits normally. Native browser pointer cancellation or unexpected pointer-capture loss commits the last accepted creation, stroke, or connector draft instead of discarding already captured work. The recovered commit contains only samples accepted before interruption; the cancellation event's coordinates are never appended.

Every commit identifies its outcome through `termination`:

```ts
onCommit(stroke) {
  if (stroke.termination?.type === "recovered-interruption") {
    console.info("Recovered drawing", stroke.termination.cancelReason);
  }
}
```

Only `"native"` and `"lost-capture"` cancellation are recoverable. Blur, context loss, surface removal, engine destruction, dispatch failure, explicit cancellation, replacement, sample exhaustion, and query failure still cancel. Marquee and transform gestures are always cancel-only. Applications retain final policy: for example, they may discard a recovered creation whose `belowThreshold` flag is true.

`beginMarquee`, `beginStroke`, and `beginConnector` otherwise share capture, cancellation, immutable samples, and engine-owned transient preview. Stroke begin/update callbacks receive only the newly accepted batch and total count, while commit receives the complete stroke once; its SVG preview is incrementally chunked and bounded. Connector previews draw the shared geometry service's resolved route. `constrainDraft` supplies app-owned aspect/center/snap bounds, while the root `filterStrokeSamplesByDistance()` helper filters imported samples in an explicit world or viewport space. Move transforms activate after three viewport CSS pixels and unchanged releases cancel, preventing selection clicks from producing mutations or history. The engine does not choose selection meaning, brush style, node kind, connector eligibility, or history.

For pressure-sensitive freehand output, convert the committed samples with the engine-owned outline pipeline:

```ts
const zoom = engine.camera.state.zoom;
engine.interactions.beginStroke(pointerDownEvent, {
  minDistanceViewport: 1.5,
  onCommit(stroke) {
    const outline = getStrokeOutline(
      stroke.samples,
      // Keep outline size in the same scale as viewport-spaced samples.
      penOutlineOptionsAtZoom(zoom),
    );
    const path = strokeOutlineToPath(outline);
    if (path) {
      // Commit a filled TPathNode using `path`.
    }
  },
});
```

Each `TInteractionSample` retains `pointerType`, world/viewport/client coordinates, pressure, tilt, timestamp, and modifiers. The outline wrapper chooses pressure behavior from the shared pointer type:

- `"pen"` preserves real hardware pressure from every sample.
- `"mouse"` and `"touch"` omit their commonly constant or unavailable pressure channel and use velocity-based simulation.

`DEFAULT_PEN_OUTLINE_OPTIONS` is a five-unit pen (with thinning, smoothing, streamlining, and capped ends) at zoom `1`, where one world unit equals one viewport CSS pixel. Stroke capture filters samples in viewport space, so commit with `penOutlineOptionsAtZoom(zoom)` — otherwise low zoom stretches world sample spacing far past a fixed world `size` and velocity simulation collapses into a uniformly thin ribbon. Empty input returns no outline, and mixed-pointer batches are rejected. `strokeOutlineToPath()` produces a closed fill contour; render it with `fill`, not as a stroked centerline. `strokeOutlineToPolygonPoints()` provides alternating x/y coordinates for renderers that consume flat polygon buffers. The interaction overlay remains a generic fixed-width preview; the committed outline is pressure-aware. These helpers keep the underlying outline library private to the engine package.

Ordering contract: the marquee yields to the selection transform overlay. When `beginMarquee` is called for a press that starts on an enabled handle or the move region of the current selection (the regions `engine.transforms` would activate as a default action), the marquee is a silent no-op — no pointer capture, no session, and no begin/update/commit/cancel callbacks — so the transform gesture solely owns that press and resize/rotate handles drawn over empty canvas space (pen strokes, arrow connectors, rounded-rect corners, the rotate handle) stay operable for apps that begin a marquee on every empty press. A marquee begun outside the overlay, or with no selection set, captures and commits exactly as before; creation, stroke, and connector sessions never consult the overlay.

## 16. Connectors

```ts
engine.scene.transaction((tx) => {
  tx.upsert({
    id: "edge-a-b",
    kind: "connector",
    parentId: "content",
    orderKey: "C",
    transform: IDENTITY_TRANSFORM_2D,
    from: {
      type: "node",
      nodeId: "node-a",
      anchor: "right",
      gap: 8,
    },
    to: {
      type: "node",
      nodeId: "node-b",
      anchor: "left",
      gap: 8,
    },
    routing: {
      type: "orthogonal",
      cornerRadius: 8,
      obstaclePadding: 12,
    },
    avoidNodeIds: ["obstacle"],
    stroke: {
      width: 2,
      paint: {
        type: "solid",
        color: { space: "srgb", r: 0.15, g: 0.18, b: 0.24, a: 1 },
      },
    },
    endMarker: { shape: "arrow", size: 10, filled: true },
  });
});

const route = engine.geometry.routeConnector(
  engine.scene.get("edge-a-b") as import("@omnidraw/cangine").TConnectorNode,
);
console.log(route.path, route.bounds);
```

For production code, narrow `scene.get()` by `kind` rather than using the example cast. Unresolved connector references produce deterministic fallback geometry and diagnostics instead of historical nondeterminism.

## 17. Resources

### 17.1 Register and preload an image

```ts
engine.resources.register(
  {
    id: "photo",
    type: "image",
    url: "https://cdn.example.com/photo.png",
    mimeType: "image/png",
    colorSpace: "srgb",
  },
  {
    type: "url",
    url: "https://cdn.example.com/photo.png",
    headers: { Accept: "image/png" },
  },
);

await engine.resources.preload(["photo"]);

engine.scene.transaction((tx) => {
  tx.upsert({
    id: "photo-node",
    kind: "image",
    parentId: "content",
    orderKey: "D",
    transform: {
      ...IDENTITY_TRANSFORM_2D,
      position: { x: 500, y: 100 },
    },
    resourceId: "photo",
    size: { width: 320, height: 180 },
    fit: "cover",
    position: { x: 0.5, y: 0.5 },
    smoothing: "auto",
  });
});
```

Browser CORS and CSP rules still apply.

### 17.2 Register a font

```ts
engine.resources.register(
  {
    id: "inter-regular",
    type: "font",
    family: "Inter",
    weight: 400,
    style: "normal",
    mimeType: "font/woff2",
  },
  {
    type: "url",
    url: "/fonts/inter-regular.woff2",
  },
);

await engine.resources.preload(["inter-regular"]);
```

Use the authored family in text styles; private generation aliases never enter scene data.

### 17.3 Custom loader

```ts
const engine = await createInfiniteCanvas({
  host,
  renderProfile: {
    vector2D: "webgl2",
    threeD: "disabled",
    portals: "disabled",
  },
  resourceLoader: {
    async load(descriptor, signal) {
      if (descriptor.url === undefined) {
        throw new Error(`No URL for ${descriptor.id}`);
      }
      const response = await fetch(descriptor.url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { type: "blob", blob: await response.blob() };
    },
  },
});
```

The manager applies its own limits and compatibility validation to loader results.

### 17.4 Observe resource state

```ts
const unsubscribeResources = engine.resources.subscribe((state) => {
  console.log(state.descriptor.id, state.status, state.refCount, state.error);
});

const photoState = engine.resources.state("photo");
```

Scene rendering retains dependencies automatically. Use manual `retain(id, owner)` / `release(id, owner)` only for an application runtime owner that needs to keep a resource prepared independently of scene use.

### 17.5 Ownership warning

A successfully registered `ImageBitmap` source transfers cleanup ownership to the engine. Do not close or reuse it afterward. Blob and ArrayBuffer inputs are captured under the documented immutable-source rules.

### 17.6 Declarative registration ownership

Replace application-maintained registration tables with a descriptor owner:

```ts
const documentResources =
  engine.resources.createRegistrationOwner("document-resources");

documentResources.replace([
  {
    descriptor: {
      id: "photo",
      type: "image",
      url: "/assets/photo.png",
      mimeType: "image/png",
      colorSpace: "srgb",
    },
  },
  {
    descriptor: {
      id: "inter-regular",
      type: "font",
      family: "Inter",
      weight: 400,
      style: "normal",
      url: "/fonts/inter.woff2",
    },
  },
]);

await documentResources.preload();

// Document replacement:
documentResources.replace(nextDescriptorClaims);

// Document/runtime teardown:
documentResources.destroy();
```

Claims are descriptor-only so complete-set replacement can be validated and
published atomically. Use explicit `resources.register(descriptor, source)`
when supplying bytes, a Blob, or a transferred `ImageBitmap`. Registration
leases keep definitions available; `retain(id, owner)`/`release(id, owner)`
express separate live usage. A definition survives while either axis remains,
so clearing one owner cannot invalidate another owner or a live scene retain.
Loading errors remain asynchronous and recoverable; application persistence,
URL/authentication policy, and retry UI remain application-owned.

## 18. Text

A text node uses runs, a base style, and a layout mode:

```ts
engine.scene.transaction((tx) => {
  tx.upsert({
    id: "title",
    kind: "text",
    parentId: "content",
    orderKey: "E",
    transform: {
      ...IDENTITY_TRANSFORM_2D,
      position: { x: 100, y: 300 },
    },
    runs: [
      { text: "Hello " },
      {
        text: "مرحبا 👋",
        style: { fontWeight: 600 },
      },
    ],
    style: {
      fontFamilies: ["Inter", "sans-serif"],
      fontSize: 24,
      lineHeight: 32,
      fill: {
        type: "solid",
        color: { space: "srgb", r: 0.06, g: 0.08, b: 0.12, a: 1 },
      },
    },
    layout: { type: "auto-height", width: 320 },
    align: "left",
    direction: "auto",
    wrap: "word",
    selectable: true,
  });
});
```

Use the shared text service for editor projection:

```ts
const node = engine.scene.get("title");
if (node?.kind === "text") {
  const layout = engine.text.layout(node);
  const hit = engine.text.hitTest("title", { x: 180, y: 320 });
  const caret = hit === null
    ? null
    : engine.text.caretRect("title", hit.offset, hit.affinity);
  const selection = engine.text.selectionRects("title", 0, 5);

  console.log(layout.lines, caret, selection);
}
```

Offsets are UTF-16 offsets snapped to valid grapheme boundaries by the service. Registered fonts use exact retained bytes for shaping and outlines. Unregistered system fallback is supported without fabricating a registered resource ID.

To project an application-owned textarea over an existing text node, call
`engine.interactions.createTextEditingSession({ nodeId, element, escapeKey,
onCommit, onCancel })`. The session synchronizes camera/scene transforms,
focus, IME-safe Escape handling, blur commit, and cleanup. `escapeKey` defaults
to `"cancel"`; pass `"commit"` when Escape should finish the edit. Text
mutation and editor styling remain application-owned.

## 19. HTML portals

Enable portals at creation:

```ts
const engine = await createInfiniteCanvas({
  host,
  renderProfile: {
    vector2D: "webgl2",
    threeD: "disabled",
    portals: "dom",
  },
});
```

Register application DOM at runtime:

```ts
const unregisterPortal = engine.portals.register({
  portalId: "editor-panel",
  mount({ host: portalHost }) {
    const button = document.createElement("button");
    button.textContent = "Application-owned action";
    portalHost.append(button);

    return () => {
      button.remove();
    };
  },
  onVisibilityChange(visible) {
    console.log("Portal visible:", visible);
  },
});
```

Place it in scene data:

```ts
engine.scene.transaction((tx) => {
  tx.upsert({
    id: "editor-panel-placement",
    kind: "html-portal",
    parentId: "content",
    orderKey: "F",
    transform: {
      ...IDENTITY_TRANSFORM_2D,
      position: { x: 700, y: 120 },
    },
    portalId: "editor-panel",
    size: { width: 280, height: 180 },
    scaleMode: "world",
    clipContent: true,
    interactive: true,
    pixelSnap: false,
    suspendWhenOffscreen: true,
  });
});
```

Portal defaults are world scaling, clipping enabled, non-interactive, no pixel snapping, and offscreen suspension enabled. Portal IDs have at most one active scene placement. The engine owns projection and input gating; your application owns mounted content and its accessibility.

The lifecycle boundary is explicit. The engine owns unique registration
identity, mount generation, host creation, placement/transform/visibility/
clipping/interactivity, secondary input-surface cancellation, stale mount
cleanup, exactly-once unmount, state subscriptions, and last-good placement.
With the DOM portal profile, a portal-backed widget is projected as one atomic
DOM shell: its real title bar and the application portal host share the same
transform, clip, opacity, visibility, and scene-derived z-index. This prevents
one widget's HTML from covering the title bar of a widget ordered above it.
The browser WebGL2 pass does not also paint that widget's retained chrome;
portal-disabled, headless, SVG, and non-portal widgets keep native rendering.
The application interprets widget descriptors, renders content inside the
host, serializes its own asynchronous content updates, rejects stale
application work, and owns internal HTML focus targets, browser fullscreen,
backend services, and product menu effects. The optional editor may supply
standard widget frame/content focus, canvas-maximized presentation, and the
shared top-layer DOM menu without taking ownership of widget business logic.

A simple application-owned generation lane is enough:

```ts
const contentGenerations = new WeakMap<HTMLElement, number>();

async function updateMountedContent(host: HTMLElement, descriptor: Widget) {
  const generation = (contentGenerations.get(host) ?? 0) + 1;
  contentGenerations.set(host, generation);
  const model = await loadWidgetModel(descriptor);
  if (generation !== contentGenerations.get(host) || !host.isConnected) return;
  renderWidget(host, model);
}
```

This lane is not an engine API and does not replace portal mount generations.

Call the registration disposer when removing the runtime definition:

```ts
unregisterPortal();
```

Portal cleanup may return `void` or `Promise<void>` (ADR-0014). The manager
detaches the engine-owned host and input surface synchronously, then starts
cleanup without awaiting guest work on scene transactions. Pending
asynchronous cleanups are bounded and isolated.

## 19.1 Capsule widget content

`@omnidraw/capsule` applications mount through the optional
`@omnidraw/cangine/integrations/capsule` adapter. Capsule stays out of Cangine
core dependencies and out of durable scene data: the scene stores only a
`portalId`, and the application resolves that ID to artifacts, grants, budgets,
and admission policy.

```ts
import { createCapsulePortalRegistration } from "@omnidraw/cangine/integrations/capsule";

engine.portals.register(createCapsulePortalRegistration({
  portalId: "sandbox-app",
  capsuleHost, // shared host; do not destroy it when one widget unmounts
  resolveMount: () => ({
    artifact: signedBytes,
    capabilityBindings: [],
    grants: [],
  }),
}));
```

The adapter mounts only into the engine-owned content host inside the S5
widget shell. Title bar, traffic lights, stacking, and clipping remain
engine-owned. Viewport width/height are intrinsic content CSS pixels; `scale`
is the portal device-pixel ratio, not camera zoom. Returning `null` from
`resolveMount` soft-defers live Capsule creation without failing the portal;
a later visibility/geometry update can admit a runtime. Admission decisions
are serialized, and `destroy` releases the Capsule handle while keeping the
engine host for remount. See
[`examples/capsule-widget/README.md`](examples/capsule-widget/README.md).

## 20. Animation

Animations are ephemeral and do not rewrite the durable scene every frame.

```ts
engine.animations.register({
  id: "fade-card",
  target: {
    type: "node",
    nodeId: "welcome-card",
    property: "opacity",
  },
  keyframes: [
    { offset: 0, value: 0.25 },
    { offset: 1, value: 1, easing: "ease-out" },
  ],
  durationMs: 500,
  iterations: 1,
  fill: "forwards",
});

engine.animations.play("fade-card");
```

Control it:

```ts
engine.animations.pause("fade-card");
engine.animations.seek("fade-card", 250);
engine.animations.play("fade-card");
engine.animations.cancel("fade-card");
engine.animations.unregister("fade-card");
```

Allowed targets are explicitly typed node, camera, and background properties. Arbitrary property paths are rejected.

If an animation’s final value should become durable, the application must commit it in a scene transaction and record its own history entry.

## 21. SVG export

```ts
const exported = await engine.svg.export({
  bounds: { type: "content", padding: 24 },
  includeBackground: true,
  includeHidden: false,
  embedImages: true,
  embedFonts: true,
  includeMetadata: false,
  portals: "placeholder",
  threeD: "placeholder",
  unsupportedEffects: "error",
  decimalPrecision: 3,
});

console.log(exported.warnings);
console.log(exported.omittedNodeIds, exported.rasterizedNodeIds);

document.querySelector("#preview")!.innerHTML = exported.svg;
```

For download:

```ts
const blob = await engine.svg.toBlob({
  bounds: { type: "viewport" },
  portals: "omit",
  threeD: "placeholder",
});

const url = URL.createObjectURL(blob);
const anchor = document.createElement("a");
anchor.href = url;
anchor.download = "canvas.svg";
anchor.click();
URL.revokeObjectURL(url);
```

Unsupported policy meanings:

| Policy | Behavior |
|---|---|
| `omit` | Paint nothing and report the node ID as omitted |
| `placeholder` | Emit deterministic neutral placeholder geometry |
| `rasterize` | Use an available safe engine raster and report the ID |
| `error` | Reject the entire export without partial output |

Portal DOM is application-owned and has no built-in raster source. Live SVG rendering is not implemented; `supportsLiveSvg` is false.

## 22. Embedded 3D

### 22.1 Enable and check 3D

```ts
const engine = await createInfiniteCanvas({
  host,
  renderProfile: {
    vector2D: "webgl2",
    threeD: "webgl2",
    portals: "disabled",
  },
});

if (engine.capabilities.threeD === "disabled") {
  console.warn("3D is unavailable; continue with the 2D experience");
}
```

### 22.2 Register a mesh

The initial mesh formats are engine mesh, geometry-only OBJ, GLB, and self-contained glTF. This OBJ example performs no secondary fetch:

```ts
const triangleObj = new Blob([
  [
    "v -1 -1 0",
    "v 1 -1 0",
    "v 0 1 0",
    "f 1 2 3",
  ].join("\n"),
], { type: "text/plain" });

engine.resources.register(
  { id: "triangle-mesh", type: "mesh", format: "obj" },
  { type: "blob", blob: triangleObj },
);
await engine.resources.preload(["triangle-mesh"]);
```

Textures are separate image resources referenced by material IDs. External glTF buffers/images, compression, skins, morph targets, and animation tracks are outside the initial mesh parser scope.

### 22.3 Create a 3D scene

```ts
engine.threeD.replace({
  id: "demo-3d",
  nodes: [
    {
      id: "triangle",
      sceneId: "demo-3d",
      parentId: null,
      kind: "mesh-3d",
      transform: IDENTITY_TRANSFORM_3D,
      meshResourceId: "triangle-mesh",
      material: {
        type: "unlit",
        color: { space: "srgb", r: 0.2, g: 0.65, b: 1, a: 1 },
      },
    },
  ],
  cameras: [
    {
      id: "demo-camera",
      sceneId: "demo-3d",
      transform: {
        ...IDENTITY_TRANSFORM_3D,
        position: { x: 0, y: 0, z: 4 },
      },
      projection: {
        type: "perspective",
        fieldOfViewRadians: Math.PI / 3,
        near: 0.1,
        far: 100,
      },
      target: { x: 0, y: 0, z: 0 },
    },
  ],
});
```

3D uses a right-handed coordinate system: X right, Y up, and the default camera direction is negative Z.

### 22.4 Add the 2D viewport

```ts
engine.scene.transaction((tx) => {
  tx.upsert({
    id: "demo-3d-viewport",
    kind: "view-3d",
    parentId: "content",
    orderKey: "G",
    transform: {
      ...IDENTITY_TRANSFORM_2D,
      position: { x: 100, y: 450 },
    },
    size: { width: 480, height: 300 },
    sceneId: "demo-3d",
    cameraId: "demo-camera",
    clearColor: { space: "srgb", r: 0.03, g: 0.05, b: 0.1, a: 1 },
    transparent: false,
    clipContent: true,
    interactive: true,
    renderScale: 1,
  });
});
```

The viewport is normal retained 2D content for bounds, transforms, order, clipping, opacity, and hit eligibility.

### 22.5 Update and pick 3D

```ts
engine.threeD.apply([
  {
    type: "upsert-camera",
    camera: {
      id: "demo-camera",
      sceneId: "demo-3d",
      transform: {
        ...IDENTITY_TRANSFORM_3D,
        position: { x: 1, y: 0.5, z: 4 },
      },
      projection: {
        type: "perspective",
        fieldOfViewRadians: Math.PI / 3,
        near: 0.1,
        far: 100,
      },
      target: { x: 0, y: 0, z: 0 },
    },
  },
]);

// Point is in viewport-local CSS pixels.
const hits = engine.threeD.hitTest("demo-3d-viewport", { x: 240, y: 150 });
console.log(hits[0]?.nodeId, hits[0]?.worldPosition);
```

3D failures preserve the last valid viewport raster when one exists and do not stop unrelated 2D rendering.

## 23. Accessibility

Accessibility projection is disabled by default. Enable it during creation:

```ts
const liveRegion = document.querySelector<HTMLElement>("#canvas-live-region")!;

const engine = await createInfiniteCanvas({
  host,
  renderProfile: {
    vector2D: "webgl2",
    threeD: "disabled",
    portals: "dom",
  },
  accessibility: {
    enabled: true,
    exposeCanvasNodes: true,
    maxExposedNodes: 256,
    liveRegion,
  },
});
```

Add explicit metadata to eligible nodes:

```ts
{
  // ...ordinary rect fields
  accessibility: {
    role: "button",
    label: "Open project settings",
    description: "Opens the project settings panel",
    tabIndex: 0,
  },
}
```

The engine projects a bounded inert hidden DOM representation in semantic order. It does not own keyboard traversal, focus policy, selection, or history. Portal content remains responsible for its own accessible DOM.

## 24. Events, warnings, and errors

### Engine events

```ts
const unsubscribeEngine = engine.subscribe((event) => {
  switch (event.type) {
    case "ready":
      console.log(event.capabilities);
      break;
    case "warning":
      console.warn(event.warning.code, event.warning.message);
      break;
    case "error":
      console.error(event.error.code, event.error.message, event.error.recoverable);
      break;
    case "context-lost":
    case "context-restored":
      console.info(event.type, event.backendId);
      break;
    case "frame":
      console.debug(event.metrics.totalMs);
      break;
  }
});
```

Subscribers receive initialization state replay where required, so subscribing after creation still gives the relevant ready state.

### Catching typed failures

```ts
import { CanvasEngineError } from "@omnidraw/cangine";

try {
  engine.scene.transaction((tx) => {
    tx.update("welcome-card", (current) => ({
      ...current,
      id: "changing-an-id-is-invalid",
    }));
  });
} catch (error) {
  if (error instanceof CanvasEngineError) {
    console.error(error.code, error.recoverable, error.details);
    console.log(error.serialize());
  } else {
    throw error;
  }
}
```

Typical codes include invalid scene/transaction, resource load/decode failure, unsupported node/export, portal failure, text failure, 3D failure, context loss, destroyed state, and initialization failure.

Recoverable errors isolate the affected operation or owner. A non-recoverable error means the engine can no longer continue safely.

Invalid `scene.transaction`, `apply`, and `replace` inputs leave snapshot bytes
and revision unchanged. After a commit is delivered, that scene is
authoritative. Recoverable resource, portal, and per-node/pass presentation
failures keep their documented last-good result or omit only initially failed
content; do not roll back the durable scene for asynchronous readiness.

If a non-recoverable post-commit publication invariant fails, the engine sets
`status` to `"failed"`, pauses scheduled work, and rejects later scene
transactions and operational calls with the stable terminal error. Destroy and
recreate it from the application’s authoritative document:

```ts
if (engine.status === "failed") {
  await engine.destroy();
  engine = await createEngineFromApplicationDocument(documentState);
}
```

Do not apply a last-good snapshot to the same failed engine as a repair.
Private derived generations cannot be restored that way. Persistence, history,
collaboration, and recovery checkpoints remain application-owned.

## 25. Metrics and diagnostics

Enable frame metrics at creation:

```ts
const engine = await createInfiniteCanvas({
  host,
  renderProfile: {
    vector2D: "webgl2",
    threeD: "disabled",
    portals: "disabled",
  },
  diagnostics: {
    enabled: true,
    collectFrameMetrics: true,
    collectGpuMetrics: true,
    traceTransactions: false,
    warnOnFullRebuild: true,
  },
});
```

Read metrics:

```ts
const snapshot = engine.metrics.snapshot();
const recent = engine.metrics.recentFrames(60);

console.log({
  frames: snapshot.frameCount,
  dropped: snapshot.droppedFrameEstimate,
  revision: snapshot.sceneRevision,
  resources: snapshot.resourceCount,
  portals: snapshot.portalCount,
  transientOwners: snapshot.transientOwnerCount,
  transientNodes: snapshot.transientNodeCount,
  contextLosses: snapshot.contextLossCount,
});
```

A frame includes update, geometry, cull, prepare, render, portal, and picking timings plus draw/node counts and dirty/full-rebuild information.

## 26. Limits and untrusted data

Do not remove limits when ingesting untrusted documents. The engine validates:

- scene node count and commands per transaction;
- hierarchy and arbitrary JSON depth/entries;
- path and text size;
- image dimensions;
- renderer vertices, gradients, clips, queries, connectors, and widgets;
- resource records, bytes, stream work, and decoded pixels;
- mesh vertices/triangles, 3D draws/lights/raster pixels, and raycast work;
- SVG output size and element count;
- accessibility node/string work.

Example of lowering policy limits for a constrained embedding:

```ts
const engine = await createInfiniteCanvas({
  host,
  renderProfile: {
    vector2D: "webgl2",
    threeD: "disabled",
    portals: "disabled",
  },
  validationLimits: {
    maxSceneNodes: 10_000,
    maxCommandsPerTransaction: 1_000,
  },
  resourceLimits: {
    maxResourceRecords: 2_000,
    maxTotalDecodedImagePixels: 16_777_216,
  },
  threeDLimits: {
    maxRetainedViewports: 0,
  },
});
```

Resource and 3D hard ceilings can be lowered but not raised above production maxima. A limit failure is atomic and normally recoverable.

Security rules for consumers:

- Never serialize executable callbacks into scene data.
- Register trusted shader identifiers at runtime; never place source code in snapshots.
- Do not spread `metadata` or `extensions` into DOM attributes.
- Treat resource URLs as subject to CORS and CSP.
- Use SVG exporter output rather than constructing XML from scene fields yourself.
- Keep application data under a namespaced `extensions` key if it must round-trip.

## 27. Testing applications that use the engine

The testing entrypoint provides deterministic utilities:

```ts
import {
  ManualClock,
  assertValidSceneSnapshot,
  createRepresentativeSceneFixture,
  stableStringify,
  summarizeSamples,
} from "@omnidraw/cangine/testing";

const fixture = createRepresentativeSceneFixture();
assertValidSceneSnapshot(fixture);
expect(stableStringify(fixture)).toMatchSnapshot();

const clock = new ManualClock(1_000);
// Pass `clock` to createInfiniteCanvas(...), start an animation, then:
clock.advance(16.667);
```

Recommended application test layers:

1. Validate projected snapshots without a renderer.
2. Test application command/history behavior against scene IDs and transactions.
3. Run browser contract tests for the selected render profile.
4. Use fixed DPR, fonts, resources, and clocks for visual tests.
5. Measure public camera/transaction/render paths, not private implementation helpers.
6. Exercise context loss, resource failure, portal cleanup, and application teardown.

## 28. Pure geometry helpers

`@omnidraw/cangine/geometry` exposes renderer-free helpers for application projection and tests:

- matrix composition, multiplication, inversion, and point transforms;
- camera matrix composition;
- AABB creation, union, intersection, expansion, transform, area, and containment;
- path flattening, length, sampling, and intersections;
- scene-order comparison and canonical order-key creation.

These functions reject invalid or non-finite results rather than silently returning corrupt geometry.

## 29. Advanced custom backends

The `@omnidraw/cangine/backend` entrypoint exports backend contracts and the built-in WebGL2 backend. A custom backend must implement the full lifecycle, capability, resize, scene-change, render, warning/error, cleanup, and context-loss contracts and must keep backend-native values private.

Use a custom factory only when you can run the repository’s backend contract and visual parity suites. Ordinary applications should select the built-in WebGL2 profile.

## 30. Deliberately unsupported or application-owned behavior

Do not expect these from the completed package:

- Konva compatibility;
- application document migration;
- Automerge, collaboration, or persistence;
- product undo/redo grouping, persistence, collaboration, or authorization
  policy (the optional editor supplies only a replaceable bounded local
  adapter);
- product-specific drawing/tool/command definitions (the optional editor
  supplies replaceable standard defaults);
- product semantic selection meaning (the optional editor may own standard
  selected/focused IDs);
- application widget definitions/business logic;
- application portal content;
- product keyboard traversal and accessibility policy;
- production WebGPU execution;
- active render-worker execution;
- live SVG rendering;
- arbitrary scene-supplied shaders;
- bitmap/color registered-font glyph rendering;
- GPU 3D picking;
- physics, skeletal animation, game logic, or arbitrary 3D material graphs.

The engine exposes explicit capability or failure behavior for optional unsupported features rather than pretending they are active.

## 31. Recommended application integration pattern

A product using the optional editor should use this flow:

```text
Application document / collaboration authority
  -> pure projection to TSceneSnapshot or TSerializedSceneCommand[]
  -> Cangine atomic transaction
  -> engine scene + geometry + resources + rendering
  -> normalized input / transform proposals / hit IDs
  -> optional standard editor or replaceable application policy
  -> durable application command
  -> next projected engine transaction
```

Create the editor explicitly; the root engine never creates it:

```ts
import {
  createCanvasContextMenuController,
  createStandardCanvasEditor,
  createCanvasMenuController,
  createClipboardImagePasteController,
  createPathInteractionController,
  createStandardTextEditorController,
  createWidgetInteractionController,
  standardCanvasContextMenuItems,
} from "@omnidraw/cangine/editor";

const editor = createStandardCanvasEditor({
  engine,
  contentParentId: "content",
  initialToolId: "select",
  history: { kind: "linear", capacity: 100 },
});

const menu = createCanvasMenuController({ engine, overlayHost: host });
const contextMenu = createCanvasContextMenuController({
  engine,
  editor,
  menu,
  eventTarget: host,
  items: standardCanvasContextMenuItems,
});

const widgets = createWidgetInteractionController({
  engine,
  editor,
  menu,
  focusRoot: host,
  resolveNavigationIntent: (event) => editor.isCanvasNavigationIntent(event),
  onActivation(activation) {
    // Handle close/minimize/header product effects here.
    console.log(activation);
  },
});

const textEditor = createStandardTextEditorController({
  editor,
  root: document.body,
  ariaLabel: "Edit canvas text",
});

const clipboard = createClipboardImagePasteController({
  editor,
  eventTarget: host,
  parentId: "content",
});

const paths = createPathInteractionController({ engine, editor });

// Let the browser focus the canvas surface after it leaves an HTML widget.
host.tabIndex = 0;
// Policy controllers attach before the generic tool router so widget/menu
// hits can stop propagation before select/create gestures see them.
widgets.attach();
contextMenu.attach();
textEditor.attach();
paths.attach();
editor.attach();
```

Linear history requires an engine created with `record`; it is disabled by
default. You can register/replace tools and commands or supply a custom history
adapter. `createCanvasEditor()` provides only the lower-level lifecycle,
registry, selected/focused-ID, input-routing, and history kernel when the
standard preset is not appropriate.

When the application document must be the first writer, install a synchronous
mutation port. Every durable standard action is delivered as one immutable
incremental command batch. The host accepts the exact batch into its local
document, projects it once, and returns the immediate scene revision:

```ts
const projectAcceptedMutation = (request) => {
  localDocument.apply(request.commands, {
    transactionId: request.transactionId,
    basisSceneRevision: request.basisSceneRevision,
    source: request.source,
    coalesceKey: request.coalesceKey,
  });
  engine.scene.apply([...request.commands], {
    source: request.source,
    coalesceKey: request.coalesceKey,
  });
  return { projectedSceneRevision: engine.scene.revision };
};

const editor = createStandardCanvasEditor({
  engine,
  contentParentId: "content",
  sceneMutationPort: { commit: projectAcceptedMutation },
  history: {
    kind: "custom",
    adapter: applicationHistory,
  },
});
```

The port must finish synchronously, project exactly one successor revision, and
throw atomically when it rejects the basis or commands. It must not rewrite,
retry, or wait for a server. Controlled mode rejects the built-in linear
history because product undo/redo must share the same application authority;
disable editor history or provide a custom adapter.

Clipboard and drop/file image controllers additionally accept an
`imageImportPort`. Its `commitPrepared()` receives the same mutation request
plus final image nodes, decoded-resource IDs, intrinsic sizes, MIME types, and
the original Blobs. The host adopts the Blobs and any independent resource
retain synchronously, projects `request.mutation.commands` once, then starts
upload in the background. In this mode the controller does not select the new
nodes or keep editor-session resource leases. The resources are already
registered during handoff; calling `resources.register()` again is not a
second ownership claim.

`CanvasMenuController` is the shared browser DOM menu for right-click commands
and widget dropdowns. Pass `overlayHost: host` to enable its visual presenter;
headless construction still retains state and keyboard policy without DOM.
Menu descriptors are bounded text/ID data.
Activation is an intent; product permissions, destructive confirmation, and
side effects remain yours. The controller owns pointer/keyboard highlight,
host-edge collision, dismissal, focus restoration, and DOM cleanup. One real
`role="menu"` is shown in the document top layer through a manually managed
popover, so it can cover opaque widget HTML while remaining clamped to the
canvas host.

`CanvasContextMenuController` opens that same menu from secondary pointer
activation, the Context Menu key, or Shift+F10. The standard item provider
maps selection-aware group/order/delete commands; replace or filter it when
product authorization differs. Interactive widget content keeps its native
browser context menu. The visible DOM menu is also the sole keyboard and
assistive-technology projection; there is no hidden duplicate.

`StandardTextEditorController` is the opt-in browser adapter for standard text
requests. It owns one temporary textarea, delegates durable edits to the
engine text-editing session, and removes the textarea on commit, cancel,
detach, or destroy. Widget portal content is never routed through this
controller. Its default textarea is transparent, borderless, padding-free, and
has no placeholder; it matches the durable node's base family, size, weight,
style, stretch, spacing, alignment, direction, decoration, resolved renderer
line height, and solid fill where available. Its initial box uses the same text
layout projection as retained rendering, so entering edit mode does not
replace the glyphs with a differently sized textarea. Enter inserts a newline,
Escape and Ctrl/Cmd+Enter commit, and the selected transform overlay is
suppressed until the edit finishes.

The clipboard controller accepts trusted native clipboard image items only,
ignores editable and portal targets, decodes all candidates before one atomic
transaction, scales without upscaling to a bounded viewport fraction, and
offsets multiple images. Successful resources remain leased for the bounded
editor session so undo/redo can restore deleted nodes; `destroy()` releases
them.

Standard transform policy is per-kind:

| Kind | Default |
|---|---|
| rect/ellipse/group | move/rotate/eight resize; Shift locks ratio |
| image | move/rotate/eight intrinsic resize; locked unless Shift |
| unconstrained compatible multi | common move/rotate/resize; strongest member aspect mode |
| multi containing a min/max-constrained member | common move/rotate only; no resize |
| non-fixed text | move/rotate until standard-editor commit normalization |
| fixed text | move/rotate/four corners; always locked uniform glyph/box scale |
| single authored path/connector | path-specific anchors, point-only resize, rotate; no generic box handles |
| single freehand path | move/rotate/four corner resize; ratio always locked; positive uniform transform scale only |
| multi containing path/connector | move/rotate only; no resize |
| widget frame | move/eight intrinsic resize, no rotation |
| content-focused/canvas-maximized widget | no handles |

Widget frame/content mode is ephemeral. A title-bar click selects the frame;
content activation preserves native portal focus/IME/keyboard and
suppresses editor shortcuts while drawing an ambient CSS-pixel outline.
Hand-tool primary drag, Space-held primary drag over inactive content, and
middle-button drag take precedence over content activation: they pan the
camera, do not enter content mode, and must not click guest controls. While
content is focused, Space stays with the HTML app; Hand and middle-button pan
still win. Trackpad/wheel input pans the canvas over inactive content, widget
chrome, and the rest of the canvas; only wheel over the currently focused
widget content remains native for embedded scrolling. Pass
`resolveNavigationIntent` into
`createWidgetInteractionController` (the standard session wires
`editor.isCanvasNavigationIntent` automatically) so custom tools can share the
same predicate without the widget controller importing tool policy.
If a standard session also receives a custom `resolveWidgetMode`, its owned
content/maximized state takes precedence and the custom resolver remains the
fallback for other application policy.
Configure `navigationKeyTarget` on `createStandardCanvasEditor` as the wrapper
containing the engine host and sibling canvas UI when Space navigation must
survive toolbar/menu focus. `createStandardEditorSession` accepts the same
top-level option and defaults it to `host`. This is passive Space-state
observation in capture phase: focused widget HTML keeps native Space, while
keyup remains observable before widget routing stops ancestor bubbling; focus
leaving the cluster, blur, or teardown also clears the state. A full-page
canvas may explicitly pass its `Document` so a transient menu that unmounts
its focused item and returns focus to body remains inside the application
cluster.
For widget focus containment, keep `focusRoot` set to the engine host and pass
that wrapper separately as `focusClusterRoot`; this preserves content mode
while focus moves to sibling canvas chrome without moving overlays or resize
observation off the engine surface.
Cross-document iframe content is unsupported for this guarantee without a
host bridge. Canvas-maximized is a separate local flag: at most one widget
fills the engine host CSS box through a camera-cancelling preview, keeps its
title bar/content active, exposes no transform handles, and restores exact
durable window geometry. It is not browser fullscreen, is not serialized or
shared, and does not end merely because editor selection changes.

`PathInteractionController` is the framework-neutral authored-path selection
and point editor. It activates only for one selected authored `path` or
`connector`,
suppresses the standard box overlay through a composable lease, and publishes
constant-CSS-size semantic anchor, midpoint, resize, and rotation handles.
Standard Pen-tool nodes carry the
`org.omnidraw.cangine.editor/freehand` version-2 provenance extension and never
activate this point editor. They remain atomic selections with move, rotate,
and four corner handles; corner resizing is always positive and uniform, even
while Shift is held. Preview and commit change only the path transform, so
large immutable command arrays are not rewritten per pointer sample.
Version-1 marker-only strokes remain compatible and atomic. Version 2 retains
bounded local input/profile data so the selection-style controller can
truthfully regenerate brush width; the rendered path remains authoritative and
standard freehand never exposes dash patterns.
Applications importing older unmarked pen paths can supply the same
`resolvePathInteractionMode` callback to the standard editor and path
controller; `createStandardEditorSession` shares either configured callback
between both automatically.
The standard Select tool gives otherwise-missed path/connector strokes a
six-CSS-pixel screen-space acquisition band. Existing anchors drag in normal
selection, and the selected frame interior is a move surface below every
handle. Its `state.cursor` publishes `"move"` while hovered so a host can
compose the four-way cursor with its other cursor owners. Plain primary
double-click on the path or selected frame toggles edit mode; the frame move
starts only after three CSS pixels, so a stationary double-click remains a
click. In edit mode a segment midpoint splits and continues as an authored
anchor in the same captured gesture. Curve controls stay hidden. Resize moves
only authored anchors tied to the selected min/max side; it never emits path
scale. Connector endpoints retain node attachments through local offsets,
inserted anchors persist as `waypoints`, and `setSegmentMode()` selects
straight, smooth, or orthogonal elbow routing. One core effective-node preview
feeds rendering, bounds, picking, and dependencies before one durable commit.

`SelectionStyleController` is separate from the command menu. Construct it
from the editor and render its immutable state in the host framework:

```ts
import {
  createSelectionStyleController,
  type TSelectionStyleState,
} from "@omnidraw/cangine/editor";

const styles = createSelectionStyleController({
  editor,
  continuousClock: {
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
  },
});
styles.attach();
const unsubscribe = styles.subscribe((state: TSelectionStyleState) => {
  renderToolbar(state);
});

styles.apply({ propertyId: "foreground", value: paletteBlue });
styles.beginContinuous("opacity");
styles.updateContinuous({ propertyId: "opacity", value: 0.65 });
styles.endContinuous();
styles.activate("bring-to-front");

unsubscribe();
styles.destroy();
```

`state.controls` is already ordered and contains per-property
shared/mixed/complex values plus selected/candidate/eligible coverage. It
recurses selected groups for paint, stroke, and text properties, changes only
compatible leaves in one atomic mutation, and keeps opacity on semantic roots.
Widget frames and widget-containing groups never expose opacity. The supplied
snapshot contains semantic state and typed intents only. It has no camera,
viewport, position, visibility, focus, DOM, or layout contract. The host
decides whether and how to render it—for example, the repository whiteboard
uses a fixed top window panel that does not move with canvas panning. That
React application also owns its per-element eligibility predicate and does not
mount the panel when any directly selected node is a `widget-frame`; another
application can choose a different presentation policy without changing the
headless controller.

Foreground is the visible ink slot: connector stroke, ordinary shape border,
text glyph fill, or standard freehand fill. Background is ordinary shape fill.
Text changes normalize the same run override and font-size changes preserve
proportional fixed-layout behavior. Line routing is semantic
(`straight | curved | elbow`); manual/waypoint routes remain untouched.
Selected roots move as one stable sibling block for all four layer actions.
Call `refresh()` only when a host-supplied semantic resolver changes without
an editor/scene update; presentation suppression does not belong to this
controller.
Supplying `continuousClock` keeps geometry-heavy continuous changes to the
latest accepted value per host frame; `endContinuous()` cancels any pending
frame and commits the final exact value synchronously.

Tear down in reverse ownership order:

```ts
clipboard.destroy();
paths.destroy();
textEditor.destroy();
contextMenu.destroy();
widgets.destroy();
menu.destroy();
editor.destroy();
await engine.destroy();
```

`createStandardEditorSession({ engine, host })` bundles the construction,
attach order, and reverse-order teardown above (editor, menu, context menu,
widgets, text editor, clipboard-image paste) behind one object, using `host`
as the shared overlay/context-menu/focus/clipboard surface. It is optional
sugar over the same factories; pass `editor`/`menu`/`contextMenu`/`widgets`/
`textEditor`/`clipboardImage` sub-config to override any default, or
`clipboardImage: false` to omit that controller. Path editing is opt-in in the
composer: pass `paths: {}` (or its controller options) to include it.

Practical rules:

1. Give every application element a stable engine node ID.
2. Keep application document fields separate from engine scene fields.
3. Project one coherent application transaction into one engine transaction.
4. Use engine geometry and picking instead of duplicating renderer math.
5. Treat core transform events as proposals; use the standard editor commit
   mapping or an explicit product mapping.
6. Register resources and portals outside serialized snapshots.
7. Inspect capabilities before exposing optional UI.
8. Await explicit render/export operations when the application needs completion.
9. Dispose every subscription/registration and finally await `engine.destroy()`.

## 32. Complete service map

```ts
engine.status        // lifecycle state
engine.capabilities  // actual enabled capabilities
engine.scene         // durable 2D scene/viewports and transactions
engine.transients    // owner-scoped non-durable 2D forests
engine.recorder      // opt-in durable transaction journal, otherwise null
engine.camera        // camera state and coordinate conversion
engine.geometry      // transforms, bounds, paths, connectors, anchors
engine.input         // normalized input, picking, marquee, capture
engine.transforms    // selection overlay and transform proposals/previews
engine.interactions  // marquee/create/stroke/connector and text-edit sessions
engine.text          // layout, hit, caret, selection geometry
engine.portals       // runtime DOM registration and projection state
engine.resources     // runtime image/font/mesh/shader resources
engine.animations    // ephemeral shared-clock property animation
engine.threeD        // durable 3D command facade and picking
engine.svg           // deterministic SVG string/Blob export
engine.metrics       // frame and lifecycle metrics
```

Root methods:

```ts
engine.resize();
engine.invalidate();
await engine.renderNow();
engine.suspend();
engine.resume();
const unsubscribe = engine.subscribe(listener);
await engine.destroy();
```

This service map is the stable renderer-neutral boundary library users should build against.

The optional editor is a separately constructed owner, not an `engine`
property:

```ts
editor.state
editor.history
editor.attach();
editor.setActiveTool("select");
await editor.executeCommand("editor.zoom.fit");
editor.setSelection(["node-1"]);
editor.destroy();
```

## 33. Public API reference index

This index names every callable public surface. The preceding sections explain
the data models, behavior, ownership, limits, and examples. Types beginning
with `T` describe serializable values, configuration, events, results, or
options; interfaces beginning with `I` describe runtime services. Import those
types from the root entrypoint or `/types`.

### 33.1 Root runtime exports

| Export | Purpose |
|---|---|
| `createInfiniteCanvas(config)` | Asynchronously initialize an engine and its selected/fallback backends |
| `CanvasEngineError` | Typed failure with `code`, `recoverable`, optional node/resource/details fields, and `serialize()` |
| `IDENTITY_TRANSFORM_2D` / `IDENTITY_TRANSFORM_3D` | Frozen identity transform values |
| `createEvenOrderKeys(count)` | Allocate deterministic canonical keys for a sibling set |
| `orderKeyBetween(before, after)` | Allocate a canonical key between optional neighboring keys |
| `isCanonicalOrderKey(key)` | Check canonical key syntax |
| `filterStrokeSamplesByDistance(samples, distance, space)` | Purely thin stroke samples in world or viewport coordinates |

### 33.2 Engine and durable scene

| Surface | Members |
|---|---|
| `IInfiniteCanvasEngine` | `status`, `capabilities`, all services below, `resize`, `invalidate`, `renderNow`, `suspend`, `resume`, `subscribe`, `destroy` |
| `ISceneStore` | `revision`, `get`, `has`, `childrenOf`, `ancestorsOf`, `closestAncestor`, `query`, `transaction`, `apply`, `replace`, `snapshot`, `subscribe` |
| `ISceneTransaction` | `get`, `upsert`, `update`, `remove`, `reparent`, `reorder`, `moveBefore`, `moveAfter`, `moveToFront`, `moveToBack`, `apply` |

`transaction()` is the ordinary mutation boundary. `apply()` accepts
`TSerializedSceneCommand[]`; `replace()` atomically loads a complete
`TSceneSnapshot`. Returned nodes and snapshots are immutable views.

The durable node union is `TSceneNode`: `layer`, `group`, `background`, `rect`,
`ellipse`, `polygon`, `path`, `image`, `text`, `connector`, `widget-frame`,
`html-portal`, and `view-3d`. Sections 9–10 and 16–22 explain their associated
data types.

Widget-frame scene declarations use `TWidgetTrafficLight`,
`TWidgetHeaderContent`, `TWidgetDropdownItem`, and `TWidgetHeaderItem`.
`TWidgetHeaderContent` is the text-or-registered-icon union shown in section 9;
these types contain declarative data only, never callbacks.

### 33.3 Transients and recorder

| Surface | Members |
|---|---|
| `ITransientScene` | `createOwner`, `cloneFromScene` |
| `ITransientSceneOwner` | `id`, `replace`, `clear`, `destroy` |
| `ISceneRecorder` | `status`, `retainedWeight`, `start`, `stop`, `read`, `subscribe`, `clear`, `checkpoint`, `destroy` |

Transient `replace()` publishes a complete owner forest, never a partial
command list. `engine.recorder` is `null` unless `TCanvasEngineConfig.record`
was supplied. Recorder entries are a mechanism for replay; applications still
own history, persistence, grouping, and collaboration policy.

### 33.4 Camera, geometry, and input

| Surface | Members |
|---|---|
| `ICamera2DController` | `state`, `constraints`, `viewportSize`, `set`, `setConstraints`, `panByScreen`, `panByWorld`, `zoomAtViewportPoint`, `rotateAtViewportPoint`, `fitBounds`, `animateTo`, `cancelAnimation`, `clientToViewport`, `viewportToClient`, `viewportToWorld`, `worldToViewport`, `worldToClient`, `worldRectToViewport`, `visibleWorldBounds`, `worldToViewportMatrix`, `viewportToWorldMatrix`, `subscribe` |
| `IGeometryService` | `localTransform`, `worldTransform`, `inverseWorldTransform`, `localToWorld`, `worldToLocal`, `localBounds`, `worldBounds`, `orientedWorldBounds`, `unionBounds`, `intersectsRect`, `intersectsPolygon`, `nearestPoint`, `resolveAnchor`, `registerNamedAnchors`, `routeConnector`, `resolveConnectorLabelPlacement`, `pathLength`, `samplePath`, `flattenPath`, `intersectPaths` |
| `IInputController` | `subscribe`, `hitTestViewport`, `hitTestWorld`, `queryWorldRect`, `queryWorldPolygon`, `capturePointer`, `releasePointer`, `createClickRecognizer`, `focus`, `blur` |
| `IClickRecognizer` | `subscribe`, `reset`, `destroy` |

Input subscribers may return `TInputDisposition` to mark an event handled,
prevent the native default, stop later normalized routing, stop native
propagation, or request/release engine pointer capture. `stopRouting` leaves
the source browser event propagating; `stopPropagation` stops both routes.
Captures are owner-scoped; release with the same owner string.

### 33.5 Selection, transforms, and interaction sessions

| Surface | Members |
|---|---|
| `ITransformController` | `selection`, `hover`, `setSelection`, `setPolicy`, `subscribe`, `subscribeHover`, `registerProposalAdjuster`, `applyPreview`, `clearPreview`, `applyPresentationPreview`, `clearPresentationPreview`, `cancelActiveGesture` |
| `IInteractionController` | `activeKind`, `beginMarquee`, `beginCreation`, `beginStroke`, `beginConnector`, `createTextEditingSession`, `cancelActive` |
| `ITextEditingSession` | `projection`, `sync`, `commit`, `cancel`, `destroy` |

These APIs produce drafts, proposals, hits, or text values. They do not write
application documents or choose tools. The application validates a commit and
then performs its own durable scene/application transaction.

`TTransformCursor` and `TTransformHoverState` describe the engine-resolved
hover affordance. `TTransformPreviewOptions` currently controls ephemeral
preview stacking for `applyPreview()` and `applyPresentationPreview()`; it is
not serialized and does not alter durable sibling order.

### 33.6 Text, portals, resources, and animation

| Surface | Members |
|---|---|
| `ITextService` | `layout`, `hitTest`, `caretRect`, `selectionRects` |
| `IHtmlPortalManager` | `register`, `has`, `state`, `setInteractive`, `syncNow`, `subscribe` |
| `IResourceManager` | `register`, `unregister`, `preload`, `state`, `retain`, `release`, `createRegistrationOwner`, `subscribe` |
| `IResourceRegistrationOwner` | `id`, `replace`, `clear`, `preload`, `destroy` |
| `IResourceLoader` | `load` |
| `IAnimationController` | `register`, `unregister`, `play`, `pause`, `seek`, `cancel`, `state`, `subscribe` |
| `IEngineClock` | `now`, `requestFrame`, `cancelFrame` |

Portal registration returns the unregister function. Cleanup may return
`void | Promise<void>`; the manager detaches DOM synchronously and isolates
async reclaim. Capsule mounts use
`@omnidraw/cangine/integrations/capsule` rather than root exports. Resource
`retain` and `release` use a matching application owner string. Scene
references also retain resources automatically; manual ownership is only for
application runtime use outside scene references.

### 33.7 3D, SVG, metrics, logging, and events

| Surface | Members |
|---|---|
| `IScene3DStore` | `get`, `apply`, `replace`, `remove`, `hitTest`, `subscribe` |
| `ISvgService` | `export`, `toBlob`, `supports` |
| `IEngineMetrics` | `snapshot`, `recentFrames`, `reset`, `subscribe` |
| `IEngineLogger` | `debug`, `info`, `warn`, `error` |

`engine.subscribe()` emits the `TEngineEvent` union: ready, resize, frame,
context-lost, context-restored, suspended, resumed, warning, error, and
destroyed. `IScene3DStore` stores renderer-neutral `TScene3DSnapshot` data;
Three.js objects never cross this boundary.

### 33.8 `/geometry` exports

The geometry entrypoint is pure and browser-independent:

| Group | Exports |
|---|---|
| Bounds | `isEmptyAabb`, `aabbFromRect`, `aabbFromPoints`, `unionAabb`, `intersectAabb`, `aabbIntersects`, `aabbContainsPoint`, `expandAabb`, `transformAabb`, `aabbArea` |
| Matrices | `IDENTITY_MAT3`, `mat3Multiply`, `mat3Translation`, `mat3Scale`, `mat3Rotation`, `mat3Skew`, `composeTransform2D`, `composeCameraMatrix`, `mat3TransformPoint`, `mat3Invert`, `mat3ApproximatelyEquals` |
| Ordering | `MAX_ORDER_KEYS_PER_ALLOCATION`, `compareOrderKey`, `compareSceneOrder`, `orderKeyBetween`, `createEvenOrderKeys`, `isCanonicalOrderKey` |
| Paths | `DEFAULT_PATH_FLATTEN_TOLERANCE`, `flattenPath`, `pathLength`, `samplePath`, `intersectLineSegments`, `intersectPaths` |
| Affine decomposition | `decomposeAffineTransform2D`, `normalizeAffineRotation`, `recomposeAffineTransform2D` |
| Widget layout | `resolveWidgetFrameLayout`, `widgetFrameMinimumSize`, `createWidgetFrameChromeTextNodes`, `hitTestWidgetFramePart`, `hitTestWidgetResizePart` |
| Widget constants | `DEFAULT_MAX_WIDGET_CONTROLS_PER_NODE`, `WIDGET_TITLE_BAR_HEIGHT`, `WIDGET_CORNER_RADIUS`, `WIDGET_FRAME_BORDER_WIDTH`, `WIDGET_TRAFFIC_LIGHT_DIAMETER`, `WIDGET_TRAFFIC_LIGHT_GAP`, `WIDGET_HORIZONTAL_PADDING`, `WIDGET_TITLE_FONT_SIZE`, `WIDGET_TITLE_LINE_HEIGHT`, `WIDGET_HEADER_FONT_SIZE`, `WIDGET_HEADER_LINE_HEIGHT`, `WIDGET_HEADER_ITEM_HEIGHT`, `WIDGET_HEADER_ICON_SIZE` |
| Widget layout types | `TWidgetFrameLayout`, `TWidgetFrameLayoutOptions`, `TWidgetTrafficLightLayout`, `TWidgetHeaderItemLayout`, `TWidgetResourceIconLayout`, `TWidgetChromeTextLayout` |

All geometry helpers validate finite inputs and throw rather than return
non-finite public geometry. A singular matrix inversion returns `null`.

### 33.9 `/testing` exports

| Export | Purpose |
|---|---|
| `ManualClock` | Deterministic `IEngineClock`; exposes `pendingFrameCount` and `advance()` |
| `createRepresentativeSceneFixture()` | Complete valid representative snapshot |
| `stableStringify(value)` | Canonical key-ordered JSON serialization |
| `replayScene(base, entries, scene)` | Apply a base snapshot and journal tail |
| `assertSnapshotsEqual(a, b)` | Canonical snapshot equivalence assertion without a test-framework dependency |
| `percentile(samples, probability)` | R-7 percentile over finite samples |
| `summarizeSamples(samples)` | Count/min/max/mean/p50/p95/p99 summary |
| `validateScene` / `validateSceneSnapshot` | Return bounded validation results |
| `assertValidScene` / `assertValidSceneSnapshot` | Throw on invalid scene data |
| `DEFAULT_SCENE_VALIDATION_LIMITS` | Production validation defaults |

### 33.10 `/backend` exports

The backend entrypoint exports `IRenderBackendFactory`,
`IRenderPassBackend`, their lifecycle/init/resize/frame/result context types,
`TFrameScheduleState`, `TInvalidationReason`, `WebGl2BackendFactory`, and
`WebGl2VectorBackend`.

`IRenderBackendFactory.supports()` probes a complete engine configuration and
`create()` returns one or more ordered render-pass backends. Each pass must
implement initialize, capability reporting, resize, effective scene changes,
frame preparation, rendering, and destruction; context-loss hooks are
optional. Backend-native objects must remain private. This is an advanced
extension contract, and custom backends should be accepted only after running
the repository backend contract, browser, and visual parity suites.

### 33.11 `/scene` exports

The renderer-free `/scene` entrypoint exports
`createSceneReductionState(snapshot, options)`,
`reduceSerializedSceneCommands(state, commands)`, and
`sceneReductionStateSnapshot(state)`. Its reducer-specific exported types are
`TSceneReductionOptions`, nominal `TSceneReductionState`,
`TSceneNodeChange`, and `TSerializedSceneCommandReduction`; foundational node,
snapshot, command, and limit types remain owned by the root and `/types`
surfaces.

The root does not re-export these values. A reduction-state handle contains
package-private indexes and methods, so it is not structured cloneable or
transferable. Transfer its frozen snapshot across a worker boundary and
recreate the handle with `createSceneReductionState()` inside the destination
runtime. This inventory describes the `0.4.0` package artifact.

### 33.12 `/editor` exports

This is the complete `/editor` export inventory. Factory functions create
detached controllers unless their specific documentation says otherwise; call
`attach()` explicitly and finish with `destroy()`.

| Group | Runtime exports and constants |
|---|---|
| Kernel | `CanvasEditor`, `createCanvasEditor`, `EDITOR_COMMAND_UNDO`, `EDITOR_COMMAND_REDO` |
| Standard preset | `StandardCanvasEditor`, `createStandardCanvasEditor`, `createStandardEditorTools`, `createStandardEditorCommands`, `resolveStandardSelectableNodeId`, `STANDARD_EDITOR_FREEHAND_EXTENSION`, `resolveStandardPathInteractionMode`, `isStandardFreehandPath`, `standardFreehandPathExtensions` |
| Selection styling | `SelectionStyleController`, `createSelectionStyleController`, `planSelectionOrderMove`, `STANDARD_EDITOR_MAX_FREEHAND_SAMPLES`, `createStandardFreehandProvenance`, `resolveStandardFreehandProvenance` |
| Standard tool IDs | `EDITOR_TOOL_SELECT`, `EDITOR_TOOL_HAND`, `EDITOR_TOOL_RECT`, `EDITOR_TOOL_ELLIPSE`, `EDITOR_TOOL_PEN`, `EDITOR_TOOL_TEXT`, `EDITOR_TOOL_CONNECTOR`, `EDITOR_TOOL_ARROW`, `EDITOR_TOOL_WIDGET`, `EDITOR_TOOL_ERASER`, `STANDARD_EDITOR_TOOL_IDS` |
| Standard command IDs | `EDITOR_COMMAND_SELECT_ALL`, `EDITOR_COMMAND_DELETE_SELECTION`, `EDITOR_COMMAND_CLEAR`, `EDITOR_COMMAND_GROUP`, `EDITOR_COMMAND_UNGROUP`, `EDITOR_COMMAND_BRING_FORWARD`, `EDITOR_COMMAND_SEND_BACKWARD`, `EDITOR_COMMAND_BRING_TO_FRONT`, `EDITOR_COMMAND_SEND_TO_BACK`, `EDITOR_COMMAND_ZOOM_IN`, `EDITOR_COMMAND_ZOOM_OUT`, `EDITOR_COMMAND_ZOOM_RESET`, `EDITOR_COMMAND_ZOOM_FIT`, `EDITOR_COMMAND_EXPORT_SVG_BLOB`, `EDITOR_COMMAND_DUPLICATE`, `EDITOR_COMMAND_COPY`, `EDITOR_COMMAND_PASTE`, `EDITOR_COMMAND_CAMERA_ROTATE_CW`, `EDITOR_COMMAND_CAMERA_ROTATE_CCW` |
| Transform policy | `resolveStandardTransformPolicy`, `commitStandardTransformProposals` |
| Cloning | `collectClonePlan`, `remapClonePlan`, `cloneSceneSubtrees`, `insertClonedNodes`, `worldOffsetToLocalDelta` |
| Snap-to-grid | `createSnapToGridAdjuster` |
| History | `LinearEditorHistory`, `createLinearEditorHistory` |
| Canvas menus | `CanvasMenuController`, `createCanvasMenuController`, `resolveCanvasMenuLayout` |
| Context menus | `CanvasContextMenuController`, `createCanvasContextMenuController`, `standardCanvasContextMenuItems` |
| Widget interaction | `WidgetInteractionController`, `createWidgetInteractionController` |
| Path interaction | `PathInteractionController`, `createPathInteractionController` |
| Text editing | `StandardTextEditorController`, `createStandardTextEditorController` |
| Clipboard images | `ClipboardImagePasteController`, `createClipboardImagePasteController`, `fitIntrinsicImageSize`, `EDITOR_CLIPBOARD_IMAGE_PASTE_SOURCE` |
| Image drop | `ImageDropController`, `createImageDropController`, `EDITOR_IMAGE_DROP_SOURCE` |
| Session composer | `createStandardEditorSession` |

| Group | Exported types |
|---|---|
| Kernel | `ICanvasEditor`, `TCanvasEditorConfig`, `TEditorState`, `TEditorStatus`, `TEditorSelectionOverlayConfig`, `TEditorTool`, `TEditorToolId`, `TEditorToolInfo`, `TEditorToolContext`, `TEditorCommand`, `TEditorCommandId`, `TEditorCommandInfo`, `TEditorCommandContext` |
| Standard preset | `IStandardCanvasEditor`, `TStandardCanvasEditorConfig`, `TStandardEditorToolId`, `TStandardEditorToolOptions`, `TStandardEditorCommandId`, `TStandardEditorCommandOptions`, `TStandardCreatableKind`, `TStandardEditorCreationOptions`, `TStandardNodeCreationContext`, `TStandardNodeFactory`, `TStandardTextEditRequest`, `TStandardTextEditingSessionOptions` |
| Selection styling | `ISelectionStyleController`, `TSelectionStyleControllerOptions`, `TSelectionStyleState`, `TSelectionStylePropertyId`, `TSelectionStyleActionId`, `TSelectionStyleChange`, `TSelectionStyleControl`, `TSelectionStyleAction`, `TSelectionStyleCoverage`, `TSelectionStyleUnavailable`, `TSelectionStyleSemanticValue`, `TSelectionLineRouting`, `TSelectionStrokePattern`, `TSharedStyleValue`, `TSharedPaintStyleValue`, `TSelectionOrderActionId`, `TSelectionOrderPlan`, `TStandardFreehandProvenanceInput`, `TStandardFreehandSample`, `TStandardFreehandEndProfile`, `TStandardFreehandBrushProfile`, `TStandardFreehandProvenanceV2` |
| Transform policy | `TStandardTransformPolicyOptions`, `TStandardTransformCommitOptions`, `TStandardWidgetMode`, `TStandardPathInteractionMode`, `TStandardPathInteractionResolver` |
| Cloning | `TClonePlan`, `TClonedNodes`, `TRemapClonePlanOptions` |
| Snap-to-grid | `TSnapToGridAdjusterOptions` |
| History | `IEditorHistory`, `TEditorHistoryConfig`, `TLinearEditorHistoryOptions` |
| Canvas menus | `ICanvasMenuController`, `TCanvasMenuControllerOptions`, `TCanvasMenuId`, `TCanvasMenuItem`, `TCanvasMenuItemId`, `TCanvasMenuOpenRequest`, `TCanvasMenuState`, `TCanvasMenuActivation` |
| Context menus | `ICanvasContextMenuController`, `TCanvasContextMenuControllerOptions`, `TCanvasContextMenuCommandItem`, `TCanvasContextMenuContext`, `TCanvasContextMenuInvocation`, `TCanvasContextMenuItems` |
| Widget interaction | `IWidgetInteractionController`, `TWidgetInteractionControllerOptions`, `TWidgetInteractionState`, `TWidgetInteractionMode`, `TWidgetActivation` |
| Path interaction | `IPathInteractionController`, `TPathInteractionControllerOptions`, `TPathInteractionAppearance`, `TPathInteractionState`, `TPathInteractionMode`, `TPathSegmentMode` |
| Text editing | `IStandardTextEditorController`, `TStandardTextEditorControllerOptions`, `TStandardTextEditorState` |
| Clipboard images | `IClipboardImagePasteController`, `TClipboardImagePasteControllerConfig`, `TClipboardImagePasteIgnoredReason`, `TClipboardImagePasteResult` |
| Image drop | `IImageDropController`, `TImageDropControllerConfig`, `TImageDropIgnoredReason`, `TImageDropResult` |
| Session composer | `IStandardEditorSession`, `TStandardEditorSessionConfig` |

The kernel and standard preset are framework-neutral. Menu, clipboard, and
image-drop controllers use browser events only when explicitly
constructed/attached; a Node import of `/editor` must not access `document` or
`window`. The entrypoint is absent from the root export by design.

Duplicate (`Cmd/Ctrl+D`), copy/paste (`Cmd/Ctrl+C`/`V`), and Alt-drag all
clone through the same `collectClonePlan`/`remapClonePlan` pair: widget-frame
portal registration is stripped, `html-portal` nodes get a fresh `portalId`,
and in-clone connector endpoints/labels/avoid lists plus node clips are
remapped (external connector endpoints stay attached to their original
neighbors). Node-clipboard copy/paste serializes a JSON envelope that is a
Cangine-internal format, not for cross-application interop. Keyboard nudge
(arrow keys, `Shift` = 10x distance) coalesces repeated key-repeat presses
into one undo step via `editor.history.beginCoalescing`/`endCoalescing`,
ending on `keyup`. `createSnapToGridAdjuster(gridSize)` returns a
`registerProposalAdjuster` callback; it is opt-in, not an always-on policy.
`createStandardEditorSession()` is optional sugar that bundles the §31 recipe
(editor, menu, context menu, widgets, text editor, clipboard-image paste)
behind one `attach()`/`destroy()` pair; the individual factories remain the
primary API.
