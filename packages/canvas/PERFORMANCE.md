# Canvas Performance

This document records the current performance model for `@vibecanvas/canvas` and the KPIs we should optimize before changing code.

## Metrics

Primary KPIs to optimize:

| KPI | What to measure | Target direction | Relevant paths |
|---|---|---:|---|
| Interaction frame time | p50/p95/p99 wall time per pointer/wheel/drag/transform event, including draw scheduling | Keep p95 under one 16.7ms frame at 60Hz | `src/plugins/camera-control`, `src/plugins/select`, `src/plugins/transform`, element drag listeners |
| Input latency | time from pointer/key event receipt to visible Konva/DOM update | Minimize, especially during drag/pan/zoom | `src/plugins/event-listener/EventListener.plugin.ts`, `src/services/camera/CameraService.ts` |
| Draw work per frame | `batchDraw()` calls by layer, actual layer draw time, hit graph/listening work, grid line count, connection line point writes | Avoid duplicate layer redraws for one user event | `src/services/scene/SceneService.ts`, `src/plugins/grid/tx.draw.ts`, `src/services/widget/tx.sync-widget-connections.ts` |
| Scene size scalability | interactive FPS/latency at 100, 1k, 5k elements and nested groups | Should degrade predictably, not cliff | `src/plugins/scene-hydrator/SceneHydrator.plugin.ts`, `src/services/element/ElementService.ts` |
| Hydration/reload time | time to convert CRDT doc to Konva nodes and restore selection | Keep startup and remote reload responsive | `src/plugins/scene-hydrator/SceneHydrator.plugin.ts` |
| CRDT commit cost | time/op count/bytes per local commit, and commits per second during drag | Fewer smaller commits on hot paths | `src/services/crdt/CrdtService.ts`, drag/transform setup files |
| Network sync volume | Automerge change count and approximate encoded bytes per gesture | Reduce high-frequency sync traffic | `src/automerge.ts`, `src/services/crdt/CrdtService.ts` |
| Remote change application | time and UI disruption when non-local CRDT changes arrive | Avoid full scene reload when a patch can update nodes | `src/plugins/scene-hydrator/SceneHydrator.plugin.ts` |
| Main-thread blocking | long tasks from serialization, cloning, text layout, image decode/upload, and widgets | Keep under 50ms long-task threshold | text/shape/pen/image/widget plugins |
| Memory pressure | live Konva nodes, DOM portals, history snapshots, cloned element payloads | Avoid unbounded growth and large retained snapshots | `src/services/history/HistoryService.ts`, clone/drag/history paths |

Suggested benchmark matrix:

- Empty canvas: boot, pan, zoom, draw one element.
- Dense flat canvas: 100 / 1k / 5k mixed shapes/text/pen/image nodes.
- Nested groups: group drag with 10 / 100 / 1k descendants and pen-heavy content.
- Selection marquee: drag-select across 100 / 1k / 5k top-level nodes.
- Widget/WIP mesh: existing 80-widget connection mesh, then 200+ widgets.
- Collaboration: local drag while remote peer edits 1 / 10 / 100 elements per second.

## Konva rendering model

`docs/external/llm.konva.md` describes Konva as a `Stage -> Layer -> Group -> Shape` hierarchy. The important performance consequence is that each `Layer` is its own canvas under one stage container. Groups are logical transforms/containers inside a layer; they do not create separate canvases.

Practical judgement rules for this package:

- A layer draw redraws that layer canvas, not only the changed shape. Redraw scope is therefore primarily controlled by layer placement.
- More layers can isolate redraw work, but each layer adds canvas memory and compositing overhead.
- Konva also maintains hit-detection state for listening nodes. Non-interactive visuals should be `listening(false)` where possible so pointer hit work is smaller.
- `batchDraw()` is the right primitive for event-driven updates because it coalesces layer draw requests, but repeated calls still show which code paths are invalidating work.
- Changing camera `position`/`scale` on a layer invalidates the rendered layer. For this canvas, pan/zoom means full foreground and dynamic layer redraws, while the grid redraws on the background layer.
- Expensive geometry reads such as `getClientRect()`, broad `find()`/`findOne()` scans, and stage hit testing should be treated as CPU-side render-adjacent work.
- Complex shapes or groups may need Konva caching only after measurement; caching can trade memory and invalidation complexity for faster redraws.

## Current render loop model

There is no package-owned central `requestAnimationFrame` render loop. Rendering is event-driven through Konva node changes and explicit `batchDraw()` calls.

- `SceneService` creates one `Konva.Stage` and three layers: static background, static foreground, dynamic.
- Camera pan/zoom changes layer `position`/`scale` and calls `batchDraw()` on dynamic and foreground layers.
- Grid is a custom `Konva.Shape` on the background layer. It redraws on camera change, theme change, resize, and visibility toggles.
- Draw-create tools keep previews on the dynamic layer and commit final nodes to the foreground layer.

Performance risk: one input event can trigger multiple independent layer invalidations across services/plugins. Konva can coalesce `batchDraw()` calls, but a foreground-layer draw is still a foreground-layer draw; measure duplicate scheduling and actual layer draw cost per interaction.

## Interaction hot paths

Important hot paths found in code:

- Pan/zoom: `CameraControl.plugin.ts` calls `CameraService.pan()` / `zoomAtScreenPoint()` for wheel and hand-drag events. `CameraService` redraws foreground + dynamic each change; grid separately redraws background on the camera change hook.
- Camera persistence: every camera change writes viewport to localStorage through `tx.write-camera-state-to-localstorage.ts`.
- Marquee select: `tx.handle-stage-pointer-move.ts` scans top-level foreground children and calls `getClientRect()` + intersection checks on each pointer move.
- Transform drag proxy: `Transform.plugin.ts` recomputes proxy bounds/transformer state and throttles CRDT move patches at 30Hz for proxy moves.
- Shape/text/pen/group drags: most element drag paths patch CRDT during drag at roughly 10Hz or 30Hz, then commit a full final element snapshot on drag end.
- Group drag: `services/group/tx.setup-group-node.ts` serializes descendant elements during drag and already has optional logging metrics for serialize/commit/boundary cost.
- Context menu fallback hit-test: `ContextMenu.plugin.ts` can scan all canvas nodes and call `getClientRect()` if direct intersection misses.

## CRDT and network path

`CrdtService` is the write boundary. It wraps Automerge writes, records local change markers, and emits `change` / `write` hooks.

Current behavior:

- Local UI commits mark pending local events so the scene hydrator can ignore the local Automerge change and avoid a full reload.
- Non-local CRDT changes trigger `scene-hydrator` reload: destroy all foreground children, recreate groups/elements, sort, draw, and restore selection by IDs.
- Drag paths emit repeated local commits during movement for collaboration/remote visibility, then commit final state for history.
- `fxBuilder` uses JSON cloning for rollback snapshots; many plugins use `structuredClone()` for history and drag snapshots.

Performance risk: high-frequency local commits can increase Automerge CPU/network cost; remote changes currently pay a full-scene rebuild cost even for small patches.

## Hydration and remote reload

`SceneHydrator.plugin.ts` does full scene construction:

1. sort groups and elements by persisted z-order;
2. create group nodes top-down;
3. create element nodes and attach listeners;
4. update elements after adding nodes;
5. sort runtime children top-down;
6. batch draw stage.

This is appropriate for startup, but expensive for non-local incremental changes. Measure hydration time by element count/type and separate create-node cost from update/listener cost.

## Blocking work and allocations

Known sources of main-thread work:

- `structuredClone()` in drag start/end, style changes, transform snapshots, and history entries.
- JSON clone in CRDT builder rollback snapshots.
- Text and shape inline text measurement/layout using Pretext.
- Pen rendering through `perfect-freehand`, especially many points.
- Image file read, image decode/dimension probing, and upload/clone operations.
- Widget DOM portals syncing CSS transforms on camera/selection/drag.
- Rich widgets can add large DOM work inside canvas portals.

## Existing measurement hooks

Existing performance-related code:

- `packages/canvas/tests/perf/canvas-runtime.perf.test.ts` measures runtime boot/hydration, non-local CRDT incremental apply, camera pan/zoom draw scheduling, marquee selection scanning, and CRDT batch patch cost.
- `packages/canvas/tests/perf/widget-connection-mesh.perf.test.ts` measures work while dragging one widget in a dense connection mesh.
- Perf tests append local JSON-line results to `tests/perf/*.local.txt`, which are gitignored.
- Run with `bun --filter @vibecanvas/canvas test:perf`; normal `test` excludes `tests/perf/**`.
- The widget perf test counts `batchDraw`, layer `find/findOne`, line point writes, and move-to-bottom calls, then appends local results.
- Group drag has built-in logging metrics behind `LoggingService` for serialize time, boundary time, commit time, move events, descendant count, pen points, and operation kinds.

Recommended next measurement additions:

- Lightweight `PerformanceObserver` or manual `performance.now()` spans around pointer hook dispatch, camera changes, scene hydration, CRDT commits, and layer draw scheduling.
- Counters for `batchDraw()` by layer per gesture.
- CRDT write counters: commit count, op count, changed entity count, approximate payload size.
- Scene counters: node count by type, group depth, selected count, widget connection count, pen point count.

## Initial findings and likely optimization areas

Prioritize measurement before code changes, but these are likely pressure points:

1. Remote element changes now have an incremental apply path; keep measuring fallback full reloads for group/unknown structural changes.
2. Foreground-layer invalidation: pan/zoom and many element edits redraw the large content layer; measure actual layer draw time, not just React/Solid time.
3. Duplicate draw scheduling: camera movement redraws foreground/dynamic and also triggers grid redraw; other plugins can add more draws for the same event.
4. Hit/listening overhead: many interactive nodes increase Konva event hit work; static/overlay-only nodes should be measured for `listening(false)` opportunities.
5. O(n) scans on hot paths: marquee selection, context-menu fallback hit testing, theme refreshes, widget connection sync, and node lookup by `findOne()`.
6. Drag-time CRDT commits: movement writes are throttled but still frequent; measure Automerge CPU and network bytes.
7. Snapshot allocation: large selections/groups clone many elements for history and rollback.
8. Widget/WIP connection sync: current sync builds widget maps from layer scans and rewrites line points; existing perf test should become a tracked baseline.

## Measurement rules

- Measure production-like builds separately from Vitest/jsdom micro-benchmarks.
- Report p50/p95/p99, not only averages.
- Track scene dimensions with each result: element count, group count/depth, pen point count, widget count, connection count, selected count.
- Keep local result files out of git; commit benchmark definitions and summary docs only.
- Make every optimization show before/after metrics for at least one primary KPI and one regression KPI.
