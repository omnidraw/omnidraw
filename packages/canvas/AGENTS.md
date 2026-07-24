# Canvas Package Guide

## Purpose

`@vibecanvas/canvas` is the collaborative 2D editor core. Automerge
`TCanvasDoc` data is the sole durable authority. The canvas engine owns
rendering, geometry, hit testing, transforms, portals, resources, and frame
scheduling behind `src/engine/**`.

Read `ARCHITECTURE.md` before changing ownership boundaries and
`PERFORMANCE.md` before changing a hot path.

## Non-negotiable boundaries

- Do not change persisted canvas/group/element/widget schemas for renderer
  convenience.
- Persist rotation in degrees and convert only at the projection edge.
- Preserve string `zIndex` values exactly as engine `orderKey`.
- Projection is deterministic, JSON-only, deeply frozen, and never writes
  CRDT.
- A missing/throwing projector produces a visible derived placeholder. Never
  omit or delete collaborative data because rendering failed.
- Do not add a second production renderer, renderer selection flag, or
  renderer-shaped compatibility API.
- Runtime engine imports belong only below `src/engine/**`.
- Product services and plugins store stable product IDs/data, not engine
  objects.
- Local previews are owner-scoped transients and never enter history or CRDT.
- Durable local and remote changes use the same serialized projection path.

## Runtime ownership

`src/runtime.ts` is the composition root. Plugins apply first, services start
by `startOrder`, then initialization hooks run. Shutdown reverses service
ownership.

`SceneService` owns the engine adapter, camera/input bridges, product runtime,
projection coordinator, CRDT projection service, portal content, resize,
theme/definition reprojection, diagnostics, and teardown. Keep callers on its
canvas-owned interfaces.

`CanvasRuntimeLifecycle` serializes document-runtime replacement. Do not mount
two runtimes into one host.

## Projection

Projectors live in `src/engine/projection/projectors`. A projector maps one
existing element discriminator to semantic roots/children plus resource or
portal descriptions.

When adding or changing a projector:

1. keep the persisted element shape unchanged;
2. use deterministic namespaced IDs;
3. retain one semantic root target even when several render children exist;
4. keep coordinates parent-local;
5. use theme snapshots rather than reading CSS/runtime globals;
6. return JSON-only data;
7. add snapshot, bounds, ordering, hit-index, and failure-placeholder tests.

`ProjectionIndex` is the only product hit mapping. Do not infer product state
by scanning the scene.

## Product behavior

- Creation plugins create transient drafts, then commit the existing product
  payload.
- Selection/context/style menus use `TCanvasTarget`.
- Transforms consume product proposals and persist product patches.
- Groups and order commands derive from `TCanvasDoc`.
- Point editing and clone drag use owner-scoped transients.
- `CanvasActiveSessionService` declares dependencies and cancels conflicting
  local sessions before remote projection.
- Product history stores CRDT/product snapshots only.

For image clone/delete/upload, keep backend side effects at the product edge
and make failure visible without corrupting durable data.

## Widgets and extensions

Widget projection emits a retained frame and a portal description. Widget DOM
mounts through `CanvasPortalService` using `{ portalId, host }`; never expose
engine controllers to widget code.

Extensions may register canvas-owned definitions, projectors, plugins,
services, tools, and portal content. Definition invalidation triggers
reprojection. Keep the extension contract renderer-neutral.

## Functional file rules

Follow the repository functional-core directive:

- `fn.*.ts`: pure deterministic functions; exported functions start with
  `fn`; no runtime globals.
- `fx.*.ts`: impure reads; exported functions start with `fx`; exactly
  `(portal: TPortal*, args: TArgs*)`.
- `tx.*.ts`: impure writes; exported functions start with `tx`; exactly
  `(portal: TPortal*, args: TArgs*)`.
- Runtime imports in these files are restricted to the allowed `fn`/`fx`/`tx`
  leaves and local `CONSTANTS`.
- Prefer sibling `fn`/`fx`/`tx` files for feature-local logic and `/core` only
  for genuinely shared logic.

## Tests

Prefer observable product outcomes:

- CRDT document and history actions;
- semantic selection/focus;
- immutable projection data, index, bounds, order, and diagnostics;
- resource/portal/transient ownership;
- lifecycle and cleanup;
- hook/backend API arguments.

Do not assert private engine draw calls except in adapter/performance tests.
Adapter compatibility tests use public engine exports only. Production
integration tests inject the public engine test backend through the runtime
composition seam.

Required gates:

```sh
bun run --cwd packages/canvas test
bun run --cwd packages/canvas test:perf
bunx tsc -p packages/canvas/tsconfig.json --noEmit
bun run lint:functional-core:agent
```

The engine import boundary and exact artifact identity tests must remain
enabled.

## Package map

- `src/components`: thin Solid host and serialized runtime lifecycle.
- `src/semantic`: renderer-neutral targets, input modifiers, and transform
  contracts.
- `src/engine`: sole engine adapter, bridges, projection, product facade,
  resources, portals, and transients.
- `src/services/projection`: authoritative CRDT-to-projection subscription.
- `src/services/active-session`: local gesture/remote conflict policy.
- `src/services/portal`: application portal content ownership.
- other `src/services`: shared product policy/state.
- `src/plugins`: feature orchestration and UI hooks.
- `src/widget-host`: renderer-neutral widget contracts/helpers.

Keep `Canvas.tsx` thin: it owns the host DOM and runtime lifecycle, not product
or renderer policy.
