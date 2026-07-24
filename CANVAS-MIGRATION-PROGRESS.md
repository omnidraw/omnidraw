# Canvas Migration Progress

Implementation ledger for
[`docs/internal/llm.canvas-migration.md`](docs/internal/llm.canvas-migration.md).

Last updated: 2026-07-24

Branch: `codex/canvas-engine-migration`

BASED task: [`S111`](tasks/s/S111.md)

Overall status: **in progress — hard cutover implemented; strict qualification incomplete**

## Protected boundaries

- Automerge `TCanvasDoc` is the sole durable product authority.
- Persisted canvas/group/element/widget schemas and backend APIs do not change.
- Persisted rotation remains degrees; engine projection uses clockwise radians.
- Persisted string `zIndex` values pass unchanged to engine `orderKey`.
- Projection never writes to CRDT or deletes data because rendering failed.
- No dual production renderer and no Konva compatibility layer.
- Engine runtime imports stay inside the canvas engine boundary and minimal
  composition code.

## Artifact identity

| Item | Value | Status |
|---|---|---|
| Engine source commit | `58009176fd4622c661e50ddf0c7d3216633c76c0` | specified |
| Filesystem artifact | `/Users/omarezzat/Workspace/vibecanvas/canvas-engine/artifacts/vibecanvas-canvas-engine-0.1.0.tgz` | present |
| Expected SHA-256 | `7069d90a20253b69f7c805d369961f09e737c133bb3594684e71ca9fb0c73240` | matches |
| Package version | `0.1.0` | pinned by absolute `file:` dependency; release portability open |
| Upstream provenance | external checkout artifact is modified/uncommitted relative to audited source | handoff blocker |

## Starting baseline

Captured before production migration edits:

| Gate | Result |
|---|---|
| `bun run --cwd packages/canvas test` | PASS — 51 files / 223 tests |
| `bun run --cwd packages/canvas test:perf` | PASS — 1 file / 8 tests |
| Canvas source files with Konva references | 97 |
| Canvas source Konva match lines | 681 |
| Canvas test files with Konva references | 36 |
| Canvas test Konva match lines | 293 |
| `packages/canvas` dependency | `konva@^10.3.0` present |
| Vitest engine externalization override | present historically; removed during Phase 0 |

Historical behavior and screen states are recorded in
[`docs/internal/screens/SCREENS.md`](docs/internal/screens/SCREENS.md).

## Phase ledger

| Phase | Status | Exit evidence |
|---|---|---|
| 0 — Freeze invariants and exact engine bytes | completed | Artifact SHA, schema snapshots, default Vitest consumption, package tests, legacy perf, and screen-atlas source captured; portable provenance remains a Phase 11 gate |
| 1 — Semantic product contracts | completed | Revisioned/field-aware CRDT summaries, semantic targets/hits/input/transforms, selection, and active-session conflict policy pass focused tests |
| 2 — Engine runtime boundary | completed | Exact profile/capability assertion, lifecycle, stable layers, incremental commands, resource/portal/transient ownership, diagnostics/metrics, last-good/fatal behavior, and teardown pass public-boundary tests |
| 3 — Complete static projection | completed | All built-in projectors, nested groups, deterministic index/diff, JSON-only snapshots, resources/portals, visible placeholders, and element-local capability/resource/portal failure handling are implemented and focused-tested |
| 4 — Authoritative incremental hydration | completed | SceneService owns one serialized local/remote path; ordinary element summaries reproject changed elements only, while structural group changes retain a bounded full-projection fallback |
| 5 — Camera, grid, input, selection, menus | completed | Engine camera/input, semantic selection/context menu, engine marquee, key filtering, remembered style defaults, and coalesced opacity history are implemented |
| 6 — Tools and element creation | completed | Shape2d, line/arrow with product bindings, pen, text, image, cancellation, and transient-to-durable creation are renderer-neutral |
| 7 — Transforms, groups, order, clone | completed | Element/group/mixed transforms, group/order persistence, point editing, product-first subtree clone IDs/policies, lifecycle-aware delete, and dependency-aware remote cancellation are implemented |
| 8 — Text and image runtime behavior | completed | Text commit/cancel/history and image resource/upload/clone/delete/restore lifecycle are implemented |
| 9 — Real widgets and extensions | completed | Widget chrome/title actions, distinct content focus, portal ownership, frame transforms, clone policy, placement transient, and renderer-neutral `ui-ai-chat` consumer are implemented |
| 10 — Cutover and canvas Konva deletion | completed | Engine-backed SceneService is sole runtime; source/manifests/lock scan is Konva-free and the compatibility layer was not retained |
| 11 — Qualification and repository handoff | in progress | Final local monorepo/build/binary/index and Konva-artifact gates pass; complete browser, real two-client, performance, soak, human atlas, and portable provenance gates remain |

## Progress log

### 2026-07-24 — Migration start

- Created branch `codex/canvas-engine-migration` from
  `5443d9e0ed583b0c759945e3b8b7c0c406893f05`.
- Read the complete 1,818-line migration contract.
- Verified the filesystem artifact matches the required SHA-256.
- Ran the pre-change canvas package test baseline successfully.
- Counted current package-local Konva coupling for final deletion comparison.
- Created this ledger and migration task; the task was renumbered to unique
  `S111` to avoid an existing subtraction-task ID collision.

### 2026-07-24 — Phase 0 contract evidence

- Removed the obsolete `vitest.ssr.noExternal` override.
- Added exact artifact path/version/commit/SHA verification with visible test
  output.
- Added schema snapshots covering every current `TCanvasDoc` field, element
  discriminator, widget window value, style field, binding, crop, and group
  field.
- Captured the current legacy renderer performance harness:
  - empty boot/hydration: 184.564 ms;
  - 100-element boot/hydration: 106.201 ms;
  - 1,000-element boot/hydration: 241.327 ms;
  - 5,000-element boot/hydration: 2,092.144 ms;
  - 600-element boot/hydration: 379.104 ms;
  - one remote add at 600 elements: 9.698 ms;
  - 120 camera updates: 32.98 ms and 11.333 scheduled batch draws/update;
  - 2,000-node marquee scan: 23.738 ms;
  - 1,000 element / 3,000 field CRDT batch patch: 7.079 ms.
- Confirmed the current screen atlas is the visual-parity source; dedicated
  empty/100/1k/5k engine/browser baselines remain to be captured.

### 2026-07-24 — Collaboration policy foundation

- Extended CRDT change summaries with a monotonic revision, local/remote
  origin, per-entity before/after snapshots, and sorted changed-field lists.
- Decoupled summary origin from the legacy hydrator's consumable local marker;
  remote changes remain correctly classified after the old skip path is
  deleted, and failed writes cannot leave stale origin state.
- Added a renderer-neutral active-session service with exact element/group
  dependencies, idempotent cancellation, explicit-only rebasing, replacement,
  completion, and teardown semantics.
- Added conflict tests for unrelated changes, geometry, deletion, reparenting,
  text/data, line bindings, ancestor groups, order-only updates, local
  acknowledgements, and session replacement.
- Added renderer-neutral product target, semantic hit, pointer/wheel input,
  modifier, selection-mode, and transform-proposal contracts.
- Added pure target identity/deduplication/guard and proposal-to-persisted
  transform conversion tests, including normalized radians-to-degrees cases.
- Extracted the page-level runtime replacement edge into a serialized
  lifecycle owner. Rapid source changes coalesce, teardown finishes before a
  replacement boots, stale boot work self-cleans, boot/shutdown failures are
  isolated, and disposal is idempotent.
- Added a source-boundary test that fails if canvas-engine runtime imports
  escape `src/engine/**` or use unpublished deep imports.
- Added a renderer-neutral selection owner with ordered product targets,
  element/group ID disambiguation, focus invariants, projection pruning,
  injected-clock suppression, immutable change snapshots, and pure
  replace/add/toggle/remove policy.

### 2026-07-24 — Complete static projection core

- Added collision-safe namespaced IDs for layers, product groups, semantic
  element roots, derived children, portals, versioned image resources, and
  transient owners.
- Added exact degrees/radians conversion, deterministic JSON signatures,
  theme/token resolution, stable topological group ordering, and projection
  indexes for semantic hits, resources, portals, and last-applied revision.
- Added projectors for rect, ellipse, diamond, line, arrow, pen, text, image,
  `ui-widget`, and `widget-instance`, including inline text and deterministic
  Catmull-Rom-to-cubic path conversion.
- Added full-document projection and semantic diffing for node,
  resource/portal, element, group, reorder, and reparent changes.
- Added visible, selectable placeholders for missing, invalid, or throwing
  projectors; projection failures remain derived diagnostics and never mutate
  product data.
- Enforced JSON-only projection data. Dates, maps, sets, regexes, DOM nodes,
  callbacks, `undefined`, non-finite numbers, cycles, and non-plain objects are
  rejected before they can enter a scene snapshot.
- Deep-froze completed projections so extension or product consumers cannot
  mutate scene nodes, ownership descriptions, diagnostics, or indexes after
  projection returns.
- Added a ThemeService edge that snapshots the selected theme, complete color
  token palette, sizing tokens, and style defaults into renderer-independent
  projection input.

### 2026-07-24 — Engine lifecycle and ownership boundary

- Added the sole stateful canvas-engine adapter with the forced profile
  `{ vector2D: "webgl2", threeD: "disabled", portals: "dom" }`, explicit
  capability assertions, accessibility, diagnostics, metrics, and stable
  background/content/debug layers.
- Added idempotent start, resize, suspend/resume, render, context-loss/restore,
  fatal visible fallback, repeated destroy, and host cleanup behavior.
- Added last-good retained-scene handling and both explicit snapshot
  replacement and incremental serialized-command application. Incremental
  updates reject embedded snapshot replacement.
- Added staged resource ownership with shared-owner reference tracking,
  preloading, source-generation identity protection, rollback, release, and
  deterministic destruction.
- Added staged DOM portal ownership that exposes only a canvas-owned
  `{ portalId, host }` mount context, plus transient owner wrappers and
  durable-handoff stages.

### 2026-07-24 — Authoritative projection coordinator

- Added a renderer-independent coordinator for initial hydration and one
  serialized local/remote revision path.
- Added monotonic revision rejection, no-op advancement, bounded explicit full
  reload, diff continuation after recoverable failure, last-good
  projection/index retention, ownership rollback, selection/focus pruning,
  and idempotent teardown.
- Verified add/update/delete/reparent, resource/portal changes, throwing
  projector placeholders, queued changes, and local/remote equivalence without
  a CRDT writer in the coordinator.

### 2026-07-24 — Production composition and product-policy cutover

- Replaced the Konva-owned scene service with a production `SceneService` that
  composes the engine adapter, authoritative CRDT projection, camera/input
  bridges, product facade, portal content, resize observation, diagnostics,
  theme/extension reprojection, and deterministic teardown.
- Added a canvas-owned product runtime for geometry, semantic interactions,
  text-edit alignment, selection transforms, owner-scoped transients, and
  transient-to-durable handoff. Raw engine controllers remain private.
- Remote CRDT changes now cancel active engine product interactions/transforms
  before authoritative projection advances.
- Reworked selection, context menu, render order, and grouping around semantic
  product targets and CRDT data. Group/order operations retain exact product
  history and no longer store or scan renderer nodes.
- Replaced `ElementService` and `ToolService` renderer-node contracts with
  product definitions, transform policy, projection extensions, and
  renderer-neutral tool sessions.
- Added renderer-neutral `CanvasPortalService` content ownership and late
  renderer refresh, keeping widget DOM application-owned.
- Replaced the Konva widget placement ghost with a portal-free engine
  `widget-frame` transient. It uses engine camera conversions and visible-world
  bounds, stays visible for async commits, changes from dashed positioning to
  a strong “Adding…”/“Building Preview…” state, and is never persisted.
- Began the atomic external consumer cutover across canvas widget-host and
  `packages/ui-ai-chat`; no compatibility layer or dual widget contract is
  being retained.

### 2026-07-24 — Hard cutover completion

- Completed the atomic renderer-neutral consumer cutover across
  `packages/canvas`, `packages/ui-ai-chat`, `apps/frontend`, manifests, and the
  lockfile. Current scans show no Konva source/dependency entries; no dual
  renderer or compatibility layer remains.
- Added changed-element projection. Ordinary element-only CRDT summaries now
  rebuild only affected element projections/index entries and emit
  node/resource/portal diffs. Structural group changes retain the explicit
  bounded full-projection fallback.
- Wired engine marquee into semantic selection and retained product
  drill-down, group collapse, and selection-mode policy.
- Replaced blanket remote cancellation with declared element/group field
  dependencies. Unrelated remote changes continue; transform and line
  point-edit conflicts cancel before authoritative projection.
- Completed element, group, and mixed-selection move/resize/rotation
  persistence, including ancestor selection collapse and product-only history.
- Completed product-first Alt-drag cloning: durable IDs are allocated before
  preview, group ancestry and bindings are remapped, image side effects are
  compensated on failure, and registered widget cloneability/payload policy is
  applied before same-ID durable handoff.
- Completed line/arrow endpoint binding creation and point-edit binding
  persistence without storing engine identities.
- Routed generic selection deletion through `ElementService` so registered
  `onDelete`/`onRestore` effects run for delete, undo, and redo.
- Added element-local projection fallback for capability, resource preload, and
  portal registration/mount failure. Scene diagnostics and user notifications
  are emitted once per active failure generation and reset after recovery.
- Completed style-menu remembered defaults for selected/active tools and
  coalesced continuous opacity input into one history entry.
- Completed renderer-neutral widget chrome/title actions, distinct content
  focus versus frame selection, minimize/restore/fullscreen routing, portal
  isolation, frame transforms, creation, and clone policy.
- Fixed a persisted-canvas hard-reload race by delaying the canvas runtime
  lifecycle until its host ref is mounted.

### 2026-07-24 — Partial product qualification

- Ran a Chromium development smoke covering persisted hard reload, rectangle
  create/move/style, grid/theme, wheel/hand camera control, text blur commit,
  AI/widget portal mounting and isolation, and widget drag, resize, minimize,
  and fullscreen.
- Confirmed cached Chromium, Firefox, and WebKit browser binaries can launch at
  DPR 1 and 2 with WebGL/WebGL2. Vibecanvas still has no complete product
  browser suite for the required browser × DPR × mouse/touch/pen matrix.
- Focused dependency/conflict tests exist, but no required real two-client
  Automerge/browser scenario matrix has run.
- The product performance harness ran after cutover:
  - empty boot, 4 frames, revision 2: 303.293 ms;
  - 100 elements / 200 projected nodes: 136.203 ms;
  - 1,000 elements / 2,000 projected nodes: 1,037.447 ms;
  - 5,000 elements / 10,000 projected nodes: 2,863.703 ms;
  - isolated one-element product projection at 5,000 elements, 40 samples:
    p50 1.580 ms / p95 2.434 ms / p99 2.490 ms;
  - end-to-end remote 600 → 601 elements: 51.146 ms;
  - 120 camera updates → one frame: 31.608 ms;
  - marquee 2,000 elements / 460 hits: 29.119 ms;
  - CRDT batch 2,000 elements / 1,000 updates / 3,000 fields: 23.793 ms.
- The isolated projection p95 meets its initial `< 8 ms` budget. The remote
  measurement still combines Automerge summary, projection, engine
  apply/render, and flush. A concurrent full nine-scenario run hit a 5k
  teardown-hook timeout and is not clean qualification evidence. The required
  full p50/p95/p99 5k/50k/100k, portal, path/group, browser/DPR, leak, and
  30-minute soak results are still missing.

### 2026-07-24 — Final local repository gates

- The completed working tree passed `bun run test`, including canvas,
  ui-ai-chat, frontend, CLI, public-contract, architecture-boundary, and
  external-composition suites.
- `bun run test:widget-host` passed all 11 widget-host suites, including the
  10,000-widget case.
- `bun run build` passed after granting the build script npm access for its
  platform-specific Turso addon packages. It emitted darwin-arm64,
  linux-arm64, linux-x64, linux-x64-baseline, the wrapper package, and
  `release-manifest.json`.
- The native darwin-arm64 binary completed its `--help` smoke. It printed the
  existing Turso `initSync()` deprecation warning before normal help output.
- `bun run generate:files` regenerated `FILES.md` from the final tree.
- Final source, manifest, lockfile, dependency-tree, and generated `dist`
  scans contain no Konva match. Canvas-engine runtime imports exist only under
  `packages/canvas/src/engine/**`.
- The backend/API/database boundary diff is empty and `git diff --check`
  passes.

## Verification log

| Date | Command | Result |
|---|---|---|
| 2026-07-24 | `shasum -a 256 …/vibecanvas-canvas-engine-0.1.0.tgz` | PASS — exact expected SHA |
| 2026-07-24 | `bun run --cwd packages/canvas test` | PASS — 51 files / 223 tests |
| 2026-07-24 | `bun run --cwd packages/canvas test:perf` | PASS — baseline extended to empty/100/1k/5k; 1 file / 8 tests |
| 2026-07-24 | focused artifact/schema/compatibility/CRDT/session tests | PASS — 5 files / 28 tests |
| 2026-07-24 | `bunx vitest --run tests/semantic/contracts.test.ts` | PASS — 1 file / 11 tests |
| 2026-07-24 | focused lifecycle/semantic/import-boundary tests | PASS — 3 files / 18 tests |
| 2026-07-24 | focused CRDT/session tests after origin hardening | PASS — 2 files / 19 tests |
| 2026-07-24 | complete projection slice before boundary hardening | PASS — full canvas suite, 58 files / 273 tests |
| 2026-07-24 | projection plus strict JSON-boundary tests | PASS — 2 files / 27 tests |
| 2026-07-24 | `bun run lint:functional-core:agent` | PASS |
| 2026-07-24 | Phase 2 full canvas non-perf suite | PASS — 64 files / 314 tests |
| 2026-07-24 | Phase 2 package TypeScript + functional-core lint + diff check | PASS |
| 2026-07-24 | ProjectionCoordinator focused suite | PASS — 1 file / 12 tests |
| 2026-07-24 | frozen projection/coordinator focused suite | PASS — 3 files / 40 tests |
| 2026-07-24 | `bun run --cwd packages/canvas test` after Phases 1–4 foundations | PASS — 64 files / 314 tests |
| 2026-07-24 | `bunx tsc -p packages/canvas/tsconfig.json --noEmit` | PASS |
| 2026-07-24 | focused product runtime + adapter + engine-import boundary | PASS — 5 files / 18 tests |
| 2026-07-24 | focused widget placement/product transient/import boundary | PASS — 4 files / 14 tests |
| 2026-07-24 | post-cutover source/manifests/lock Konva scan | PASS — no matches in canvas, ui-ai-chat, frontend, package manifests, or lockfile |
| 2026-07-24 | post-cutover isolated projection performance | PASS — 40 samples at 5k: p50 1.580 ms / p95 2.434 ms / p99 2.490 ms |
| 2026-07-24 | end-to-end remote 600 → 601 rerun | RAN — 51.146 ms combined pipeline; not an isolated budget result |
| 2026-07-24 | concurrent full nine-scenario performance run | INCONCLUSIVE — 5k teardown hook timed out |
| 2026-07-24 | post-widget canvas package suite | PASS — 72 files / 346 tests |
| 2026-07-24 | post-widget ui-ai-chat package suite | PASS — 38 files / 262 tests |
| 2026-07-24 | canvas/ui-ai-chat TypeScript and functional-core lint | PASS |
| 2026-07-24 | `bun run test:widget-host` | PASS — 11 suites, including 10,000 widgets |
| 2026-07-24 | `bun run test` from the completed source state | PASS |
| 2026-07-24 | `bun run build` with required npm access | PASS — four platform packages, wrapper, and release manifest |
| 2026-07-24 | darwin-arm64 compiled binary `--help` smoke | PASS — normal help output; existing Turso deprecation warning observed |
| 2026-07-24 | `bun run generate:files` | PASS — `FILES.md` regenerated |
| 2026-07-24 | final engine-import boundary and Konva source/dependency/`dist` scans | PASS — no boundary escape and no Konva match |
| 2026-07-24 | final backend/API/database diff plus `git diff --check` | PASS — no boundary change and no whitespace error |
| 2026-07-24 | focused widget portal transition tests | PASS — 2 files / 8 tests |
| 2026-07-24 | ui-ai-chat TypeScript + functional-core lint + diff check after review fix | PASS |
| 2026-07-24 | `bun run --cwd packages/ui-ai-chat test` after review fix | PASS — 38 files / 262 tests |

## Deviations and decisions

- No deviations approved.
- No visual mockup was added: this migration protects existing UI states, and
  the screen atlas plus the architecture flow in `S111` are the relevant
  validation artifacts.
- The audited tarball is newer than the tracked tarball at engine commit
  `5800917`; its exact bytes are currently modified/uncommitted in the external
  engine checkout. The migration pins and tests the specified SHA, but upstream
  artifact provenance must be committed or the exact artifact vendored before
  final handoff.
- Bun reused stale filepath-package cache contents during Phase 0. The installed
  package was refreshed from the audited tarball, and the artifact identity
  test now fails visibly on byte drift. Rebuilding the same external filepath
  remains forbidden; use a new filename/hash.

## Placeholders and unsupported cases

- Forced projector, capability, resource, and portal failure tests exercise the
  derived placeholder/recovery protocol. No public canvas-engine feature gap
  has been found.
- Normal-operation qualification has not yet proved that no unexpected
  placeholder appears across the complete human/browser matrix.

## External coordination

- The renderer-neutral canvas widget-host and `packages/ui-ai-chat` consumer
  change is implemented atomically; old renderer-native exports and direct
  Konva usage are removed.
- The repository-wide source/manifests/lock/dependency and generated `dist`
  scans are clean. The local release build and binary smoke pass; portable,
  reproducible engine artifact provenance remains a Phase 11 release gate.

## Current next action

Keep the hard cutover and finish Phase 11: execute the full browser/DPR/input
and real two-client matrices, meet the complete performance budgets with
p50/p95/p99 evidence, complete leak/soak and human screen-atlas acceptance,
and resolve portable, reproducible artifact provenance. Task `S111` stays in
progress until every strict Definition of Done gate passes.

### 2026-07-24 — Post-review follow-up

- Left connector-binding projection unchanged per review direction.
- Recorded the irreversible image delete/undo lifecycle as
  [`B55`](tasks/b/B55.md), including the rapid undo/redo orphan race.
- Fixed mounted widget portal isolation so contained/fullscreen transitions
  update the live resize-boundary policy without remounting widget DOM.
- Added regression coverage for contained → fullscreen → contained edge-event
  routing on the same portal surface.
