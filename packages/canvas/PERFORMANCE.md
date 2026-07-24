# Canvas Performance

The canvas uses one retained engine scene, one authoritative Automerge
projection path, indexed semantic queries, and owner-scoped transients. This
document defines the performance gates for that architecture.

## Acceptance budgets

| Metric | Initial gate |
|---|---:|
| Pointer/transform event p95 | < 16.7 ms |
| Pointer-to-preview p95 | < 16.7 ms |
| Ordinary one-element projection p95 at 5k visible elements | < 8 ms |
| Engine transaction for an ordinary one-element diff p95 | < 4 ms |
| No-op CRDT projection | no scene transaction |
| Remote ordinary element update | no full-document projection |
| Ordinary-interaction long task | none > 50 ms |
| Portal/resource/transient owners after teardown | 0 |

Report p50/p95/p99 together with visible/total element count, group depth, pen
command count, portal count, image bytes, selected count, DPR, browser, and
build mode.

## Render and update model

`CanvasEngineAdapter` owns stable background, content, world-overlay, and
screen-overlay layers. The engine coalesces rendering through its scheduler.
Application code does not request per-layer draws.

A durable update follows:

1. Automerge produces one revisioned local or remote summary.
2. Product projection derives an immutable JSON snapshot.
3. Semantic diffing identifies node, order, reparent, resource, and portal
   changes.
4. The adapter applies one serialized command batch.
5. The engine schedules the retained-scene render.

An ordinary update must not scan rendered nodes or rebuild the document.
No-op summaries advance the authoritative revision without an engine scene
transaction.

During a gesture, engine transients provide immediate preview. Completion
writes product data once and keeps the transient until the authoritative
projection handoff is visible. A conflicting remote change cancels the
dependent preview before that revision applies.

## Metrics to separate

Measure these spans independently:

- Automerge write/change-summary time;
- full product projection and incremental semantic diff time;
- engine command transaction time;
- engine render time and scheduled/coalesced frame counts;
- resource load/decode/upload and portal synchronization;
- input-to-transient preview latency;
- input-to-authoritative-projection latency;
- full hydration and bounded fallback count/duration;
- remote revision queue depth and apply duration;
- teardown time and residual owner/node/DOM counts.

`SceneService.metricsSnapshot()` and diagnostics expose the engine-side
snapshot. Projection and CRDT harnesses must retain their own application-side
timings because an upstream engine benchmark does not measure product
projection or Automerge.

## Workload matrix

- Empty canvas: boot, resize, pan, zoom, create, destroy.
- Mixed visible elements: 100 / 1,000 / 5,000.
- Culling: 50,000 total with 5,000 visible.
- Nested groups: 10 / 100 / 1,000 descendants.
- Pen paths: 1k / 10k / 100k commands, including transform preview.
- Marquee: 100 / 1,000 / 5,000 candidates.
- Portals: 20 / 100 / 500 frames, with mounted DOM measured separately.
- Images: repeated sources, source replacement, load failure, and teardown.
- Collaboration: remote bursts of 1 / 10 / 100 changed elements per second.
- Transients: creation, clone, drop, transform, and point edit.
- DPR 1 and 2 in Chromium, Firefox, and WebKit where supported.

## Hot-path rules

- Do not enumerate the retained scene from product code.
- Resolve hits through `ProjectionIndex` and geometry through the product
  runtime.
- Keep path geometry immutable during transform preview; update transforms
  rather than rebuilding commands.
- Never project on raw pointer movement. Pointer movement updates transients;
  authoritative projection follows durable commits.
- Batch related CRDT patches into one product history action.
- Version resource identity when source bytes change and share ownership for
  identical sources.
- Mount only widget DOM that must be interactive; frame rendering stays in the
  retained scene.
- Keep diagnostics bounded and the recorder development-only.

## Leak gates

After gesture completion and after repeated runtime destroy, assert:

- zero transient owners and transient nodes;
- zero portal registrations and detached portal hosts;
- zero resource owners and released image/font handles;
- zero input subscriptions, resize observers, and engine callbacks;
- zero retained projection indexes from the old runtime;
- no additional canvas or overlay DOM after remount;
- context restoration does not duplicate GPU resources.

Run both repeated open/close qualification and a mixed-interaction soak.

## Harness

The package performance suite uses the same projection/product contracts as
production and an injected public engine test backend:

```sh
bun run --cwd packages/canvas test:perf
```

The normal package suite excludes `tests/perf/**`:

```sh
bun run --cwd packages/canvas test
```

Record local samples outside version control. Commit benchmark definitions and
summarized results only. Compare production browser builds separately from
Vitest/jsdom measurements.

## Migration baseline

The legacy pre-cutover baseline is preserved in
[`../../CANVAS-MIGRATION-PROGRESS.md`](../../CANVAS-MIGRATION-PROGRESS.md).
It includes empty/100/1k/5k hydration, remote update, camera, marquee, and CRDT
batch measurements. New results must be reported beside—not silently replace—
that baseline because the harness and ownership model changed.

## 2026-07-24 bounded incremental projection evidence

The D3 structural lane uses 40 warm in-process samples and the production
projector contracts. These are Vitest/jsdom application-projector timings, not
browser frame timings:

| Total elements | p50 | p95 | p99 | Deterministic work per update |
|---:|---:|---:|---:|---|
| 5,000 | 0.088 ms | 0.432 ms | 0.650 ms | 0 collection copies/scans; 1 root; 2 nodes; 128 bounded leaf slots |
| 50,000 | 0.086 ms | 0.129 ms | 0.288 ms | 0 collection copies/scans; 1 root; 2 nodes; 128 bounded leaf slots |
| 100,000 | 0.284 ms | 1.625 ms | 1.660 ms | 0 collection copies/scans; 1 root; 2 nodes; 128 bounded leaf slots |

The published projection retains immutable JSON serialization while ordinary
updates path-copy a persistent record/tree leaf instead of copying the node or
signature collection. Command construction sorts only changed nodes through
the projection index. Group creation, deletion, descendant reparenting, and
group reparenting splice only the affected persistent subtree; ownership
recovery is capped at one incremental retry.

Reproduce the scale lane with:

```sh
bun run --cwd packages/canvas test:perf -- -t \
  'isolated one-element product projection'
```
