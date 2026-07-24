# Canvas-engine compatibility and cutover report

Status: **implementation cutover complete; strict product qualification incomplete**

Vibecanvas branch: `codex/canvas-engine-migration`

Inspected engine: `/Users/omarezzat/Workspace/vibecanvas/canvas-engine`

Engine commit audited: `58009176fd4622c661e50ddf0c7d3216633c76c0`

Filesystem artifact: `artifacts/vibecanvas-canvas-engine-0.1.0.tgz`

Artifact SHA-256: `7069d90a20253b69f7c805d369961f09e737c133bb3594684e71ca9fb0c73240`

Report date: 2026-07-24

## Executive decision

`@vibecanvas/canvas-engine` supplies the public rendering, geometry, input,
transform, transient, portal, resource, and lifecycle mechanisms required by
Vibecanvas. The product has completed a hard implementation cutover: the
production canvas uses the engine-backed projection architecture, the
renderer-neutral widget consumer was migrated, and the Konva implementation
and dependencies were removed without a compatibility layer or a second
production renderer.

That is an implementation result, not a release-readiness claim. The migration
Definition of Done remains open because product-level cross-browser,
collaboration, performance, leak/soak, visual-acceptance, release, and artifact
provenance gates have not all passed.

## Compatibility ledger

The executable ledger is
[`compatibility.matrix.ts`](../../packages/canvas/tests/canvas-engine/compatibility.matrix.ts).
It contains 36 requirements:

| Status | Count | Meaning |
|---|---:|---|
| Compatible | 19 | canvas-engine directly supplies the mechanism |
| Canvas adapter | 13 | Deliberately application-owned policy, now implemented above the engine |
| Engine gap | 0 | No missing public engine mechanism blocks parity |
| Release gap | 1 | The absolute local artifact dependency is not portable |
| Validation gap | 3 | Real widget matrix, real two-client conflicts, and full product performance qualification remain |

“Adapter” identifies ownership; it does not mean the adapter is still
unimplemented. “Validation gap” is intentionally retained until the complete
specified product matrix passes.

## Implemented cutover

### Authority and projection

- Automerge `TCanvasDoc` remains the sole durable product authority.
- The engine scene is a deterministic derived projection; projection code has
  no CRDT writer.
- Persisted rotations remain degrees and convert to/from clockwise radians only
  at the engine boundary.
- Persisted string `zIndex` values project unchanged to engine `orderKey`.
- Every built-in element, group, image resource, widget frame, and portal has a
  renderer-neutral projection.
- Ordinary element-only summaries reproject only changed elements and produce
  node/resource/portal diffs. Structural group updates retain a bounded
  full-projection fallback.
- Projection/resource/portal failures retain the last good scene or localize
  the affected element to a visible derived placeholder. Diagnostics and user
  notifications are deduplicated by active failure generation.

### Product interaction policy

- Engine-normalized input drives semantic product IDs and hit parts.
- Selection uses engine picking and the engine-owned marquee session rather
  than renderer node scans.
- Element, group, and mixed-selection move/resize/rotation proposals persist
  through CRDT/history product patches.
- Alt-drag allocates product clone IDs before preview, remaps group ancestry and
  bindings, applies registered image/widget clone policy, and hands the same
  IDs from transient preview to durable projection.
- Line/arrow creation and point editing persist product binding payloads and use
  active-session dependencies.
- Active transforms and point edits declare element/group field dependencies;
  unrelated remote changes continue, while conflicting remote changes cancel
  the affected session before authoritative projection advances.
- Generic selection deletion routes elements through `ElementService`, so
  image/widget `onDelete` and `onRestore` lifecycle policy also runs on
  delete/undo/redo.
- Selection style edits remain tokenized product writes, update remembered
  defaults for selected and active drawing tools, and coalesce continuous
  opacity input into one history entry.

### Widgets and extensions

- Widget frames and DOM portals use renderer-neutral definitions and
  application-owned content.
- Stable engine hit parts route minimize, restore, fullscreen, title actions,
  and resize policy.
- Widget content focus is distinct from frame selection.
- Widget creation, clone policy, placement ghost, portal ownership, and
  asynchronous durable handoff no longer expose renderer objects.
- `packages/ui-ai-chat` consumes the renderer-neutral canvas contract.
- Late element definitions register projection, transform, clone, lifecycle,
  menu, and portal product policy without engine-native objects escaping the
  canvas boundary.

### Konva subtraction

The final source/manifests/lockfile scan has no Konva matches in
`packages/canvas`, `packages/ui-ai-chat`, or `apps/frontend`, and no `konva`
package entry. The old nodes, serializers, listeners, transformer/proxy
implementation, widget-host helpers, and Konva test setup were removed.

The final local release build passed for all four platform targets, the
darwin-arm64 binary completed a `--help` smoke, and the generated `dist` tree
also contains no Konva match.

## Evidence recorded

### Engine and package contract

- The exact tarball hashes to
  `7069d90a20253b69f7c805d369961f09e737c133bb3594684e71ca9fb0c73240`.
- Public-package contract tests cover the root, `/backend`, `/geometry`, and
  `/testing` exports without deep imports.
- The obsolete Vitest `ssr.noExternal` workaround was removed.
- Engine lifecycle, stable layers, scene transactions, camera conversions,
  picking, transforms, transients, resources, portals, context recovery,
  diagnostics, and repeated teardown are covered by focused adapter tests.
- Projection tests cover every built-in discriminator, JSON-only snapshots,
  semantic IDs, resources/portals, placeholders, recovery, incremental
  element diffs, and a bounded full reload.

The durable command-by-command evidence is recorded in
[`CANVAS-MIGRATION-PROGRESS.md`](../../CANVAS-MIGRATION-PROGRESS.md).
Historical upstream results remain useful engine evidence, but do not satisfy
product qualification: the audited engine reported 110 files / 1,031 tests,
33 Chromium browser checks, and a 100,000-command transform chain of 1.63 ms
after initial compilation.

### Partial product browser evidence

A Chromium development smoke exercised:

- persisted-canvas hard reload and engine mount;
- rectangle creation, movement, and style;
- grid/theme, wheel zoom, and hand pan;
- text commit on blur;
- AI/widget portal mounting and portal event isolation;
- widget drag, resize, minimize, and fullscreen.

This is partial exploratory evidence. It is not the required automated/human
Chromium + Firefox + WebKit matrix at DPR 1 and 2 with mouse, touch, and pen
input. Historical console errors caused by deliberately stopping/restarting
the development server are not clean release evidence.

### Partial performance evidence

The migrated product harness recorded the following single-run measurements:

| Scenario | Result |
|---|---:|
| Empty boot, 4 frames, revision 2 | 303.293 ms |
| 100-element boot, 200 projected nodes | 136.203 ms |
| 1,000-element boot, 2,000 projected nodes | 1,037.447 ms |
| 5,000-element boot, 10,000 projected nodes | 2,863.703 ms |
| Isolated one-element product projection at 5,000 elements, 40 samples | p50 1.580 ms / p95 2.434 ms / p99 2.490 ms |
| End-to-end remote update at 600 → 601 elements | 51.146 ms |
| 120 camera updates → one scheduled frame | 31.608 ms |
| Marquee over 2,000 elements / 460 hits | 29.119 ms |
| CRDT batch: 2,000 elements / 1,000 updates / 3,000 fields | 23.793 ms |

The isolated one-element projection satisfies the initial `< 8 ms` projector
p95 target in that harness. The remote figure still combines Automerge
summary, projection, engine apply/render, and flush, so it does not isolate the
remaining budgets. A concurrent full nine-scenario run hit a 5k teardown-hook
timeout and is not clean qualification evidence. Several single-run values
exceed the strict targets, and no statistically useful p50/p95/p99 browser
results exist for the full 5k/50k/100k, group, path, image, and
20/100/500-portal workloads.

## Open validation and release gates

### Product-host browser matrix

Run the real application in Chromium, Firefox, and WebKit, at DPR 1 and 2,
covering mouse/touch/pen normalization, capture across canvas/portals, text/IME,
image failures, nested transforms, widget focus/window actions, context loss,
resize, destroy, and remount. Reproduce and accept the current states in
[`SCREENS.md`](screens/SCREENS.md).

### Real two-client collaboration matrix

Focused unit tests prove field-aware dependency classification and cancel-first
behavior. They do not replace two actual Automerge clients. Run every
collaboration scenario in the migration contract, including unrelated and
conflicting changes during transform/text/point-edit, remote deletion,
concurrent grouping/order, clone-effect failure, late join, and reconnect
bursts. Verify convergence, equivalent projection, selection cleanup, no stale
preview, and bounded history.

### Performance and lifecycle qualification

- Capture p50/p95/p99 by browser, DPR, scene size, and operation.
- Prove ordinary one-element updates avoid full-document projection.
- Meet the interaction, projection, transaction, long-task, owner-cleanup, and
  100k-path gates in the migration contract.
- Run repeated open/close and 30-minute mixed-interaction soaks.
- Measure detached portal DOM, WebGL resources, resources, transient owners,
  projection indexes, and recorder/history retention.

### Repository and release qualification

- Final package, frontend, widget-host, monorepo, build, binary-smoke,
  repository-index, and generated-artifact Konva gates pass locally.
- Resolve the absolute artifact dependency for portable CI/release use.

## Artifact provenance caveat

The dependency is deliberately pinned to:

```json
"@vibecanvas/canvas-engine":
  "file:/Users/omarezzat/Workspace/vibecanvas/canvas-engine/artifacts/vibecanvas-canvas-engine-0.1.0.tgz"
```

The bytes currently match the required SHA, but the audited tarball is newer
than the tracked artifact at engine commit `5800917` and is
modified/uncommitted in the external engine checkout. Before final handoff,
commit a reproducible upstream artifact or vendor the exact verified artifact
through an approved portable release mechanism. Do not silently rebuild the
same version/filename because Bun may reuse stale filepath-package cache
contents.

## Architecture verdict

The compatibility verdict is unchanged at the engine boundary:
canvas-engine is the correct replacement and exposes no public feature gap for
the current Vibecanvas canvas.

The product verdict is now “hard cutover implemented.”
It must remain **not fully qualified** until all strict Definition of Done
gates in [`llm.canvas-migration.md`](llm.canvas-migration.md) pass. Do not
reintroduce Konva, a compatibility layer, or a dual renderer to close those
qualification gaps.
