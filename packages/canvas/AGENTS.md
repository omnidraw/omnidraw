# Canvas Package Guide

## Purpose

`@omnidraw/canvas` is the public, protocol-neutral browser canvas kernel.
`CanvasDocumentService` owns the current-session optimistic document;
the host's durable canvas service remains the only durable authority. Cangine
plans immutable editor command batches and renders the accepted browser
document, but is not a document or persistence authority.

## Ownership

- `src/components/Canvas.tsx` owns the Solid host and compact editor controls.
- `src/components/CanvasRuntimeLifecycle.ts` serializes host replacement.
- `src/runtime.ts` owns Cangine/editor construction and teardown.
- `src/services/CanvasDocumentService.ts` owns server-accepted rows, the
  optimistic runtime-node map, pending commands, custom history, reconciliation,
  and prepared-image media state.
- Cangine's `@omnidraw/cangine/scene` reducer owns serialized scene-command
  semantics; `src/services/fn.scene-reduction.ts` maps its bounded changes to
  product before/after images and validates conservative editor effect IDs.
- `src/services/fn.scene-node-diff.ts` owns pure authored-node diff and patch
  helpers at the application-to-server edge.
- `src/extension.ts` is the only optional runtime extension seam.
- `TCanvasProps` and `TCanvasDependencies` are the only Solid composition
  boundary. Hosts supply descriptor, opaque scope, transport, theme, media,
  notifications, IDs, cancelable waits, diagnostics, extensions, and the
  optional lifecycle-only host-retirement registration port. Hosts await
  registered runtime disposal before retiring their injected services.

Keep server concurrency rules in `apps/backend` and shared wire
types in `@omnidraw/canvas-contract`.

## Boundaries

- Do not add another durable browser authority.
- Do not persist the synthetic content layer.
- Keep server-accepted item snapshots separate from optimistic runtime nodes.
- Accept an editor request synchronously: reduce it through Cangine, prepare
  product effects, call `scene.apply()` exactly once, then atomically adopt the
  reduction/revision pair, read model, and pending record before returning.
- Never await transport or media work from `commit()` or `commitPrepared()`.
- Route product mutations, undo, and redo through the document boundary. Only
  `CanvasDocumentService` may write the durable scene projection.
- Do not use the Cangine recorder as a persistence or history command bus, and
  do not enable `record` solely for canvas persistence.
- Apply complete snapshots with `scene.replace()` only at bootstrap or
  reconciliation.
- Own acknowledgements retire pending work without projecting an equal echo.
  Apply disjoint remote differences once; reload and invalidate pending/history
  on overlap, rejection, revision gaps, or `resync-required`.
- Adopt prepared image Blobs before projection, retain their resources, and
  media-gate server persistence until durable URL metadata is promoted.
- Runtime replacement and disposal must remain serialized and idempotent.
- Optional widget behavior belongs behind `ICanvasExtension`.
- Product identity, transport clients, database models, browser export effects,
  sidebars, and product tool names belong in the host composition root.
- Keep toolbar contributions narrow, ordered, and host-owned. Base canvas must
  not name AI Chat or a shell sidebar.
- Bind listeners and DOM work to the canvas container's `ownerDocument` and
  `defaultView`; do not assume the ambient document realm.
- Do not dispose injected diagnostics owners. The host constructs and owns
  them; canvas only emits through the capability.
- Keep CSS selectors below `.omnidraw-canvas-host`. Package fonts and assets must use
  distribution-relative URLs; never add a `/fonts` or host-root convention.

## Functional files

- `fn.*.ts` exports only deterministic `fn*` functions and types.
- Runtime imports in `fn.*.ts` must be type-only unless the imported leaf is a
  permitted function or constants file.
- Keep state and browser effects in the runtime, component, or service edge.

## Verification

Run:

```sh
bun run --cwd packages/canvas typecheck
bun run --cwd packages/canvas test
bun run --cwd packages/canvas build
```
