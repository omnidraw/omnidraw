# Canvas Package Guide

## Purpose

`@vibecanvas/canvas` is the browser adapter for the authoritative server canvas
API. `CanvasDocumentService` owns the current-session optimistic document;
`CanvasService` remains the only durable authority. Cangine plans immutable
editor command batches and renders the accepted browser document, but is not a
document or persistence authority.

## Ownership

- `src/components/Canvas.tsx` owns the Solid host and compact editor controls.
- `src/components/CanvasRuntimeLifecycle.ts` serializes host replacement.
- `src/runtime.ts` owns Cangine/editor construction and teardown.
- `src/services/CanvasDocumentService.ts` owns server-accepted rows, the
  optimistic runtime-node map, pending commands, custom history, reconciliation,
  and prepared-image media state.
- `src/services/fn.local-document.ts` applies one editor command batch to the
  optimistic document and returns bounded before/after images.
- `src/services/fn.scene-node-diff.ts` owns pure authored-node diff and patch
  helpers at the application-to-server edge.
- `src/extension.ts` is the only optional runtime extension seam.

Keep server concurrency rules in `@vibecanvas/service-canvas` and shared wire
types in `@vibecanvas/canvas-contract`.

## Boundaries

- Do not add another durable browser authority.
- Do not persist the synthetic content layer.
- Keep server-accepted item snapshots separate from optimistic runtime nodes.
- Accept an editor request synchronously: reduce it locally, install its pending
  record, call `scene.apply()` exactly once, and return the successor revision.
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
- Optional widget behavior belongs behind `ICanvasRuntimeExtension`.

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
bun run .codex/hooks/functional-core-eslint.ts packages/canvas/src/services/fn.local-document.ts packages/canvas/src/services/fn.scene-node-diff.ts
```
