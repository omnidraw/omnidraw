# M0 managed-architecture baseline evidence

This artifact records the pre-migration actor-era baseline used to protect the canvas and compare later managed-architecture milestones. It does not mark M0 `PASSED`; the operational ledger and task leaf remain owned by the long-running migration run.

## Durable commands

```bash
bun run test:canvas-regression
bun run test:managed-architecture-baseline
bun run baseline:managed-architecture
bun run baseline:managed-architecture -- --output /tmp/vibecanvas-m0-baseline.json
```

`test:canvas-regression` composes the current renderer and host seams instead of introducing a second renderer test harness:

| Protected surface | Existing suite exercised |
| --- | --- |
| Camera, selection, movement, resize, transform, stacking, grouping, clone/delete, and CRDT visual replay | Full `@vibecanvas/canvas` non-performance suite |
| Widget window, DOM portal, fullscreen, placement, clone, resize, loading/error, and actor snapshot bridge | Focused `@vibecanvas/ai-chat` widget, widget-placement, and draft-preview suites |
| Shared document persistence and peer reconnect lifecycle | `AutomergeService.test.ts` and `websocket.adapter.test.ts` |
| Current child-process snapshot/message/resource behavior | `Actor.test.ts` and `Actor.resource-ipc.test.ts` |

The repository root `test` command now also runs `@vibecanvas/canvas`, `api-agent`, `sdk`, `service-theme`, and the deterministic baseline-fixture contract test. Packages with existing tests but no package command (`api-filesystem`, `api-notification`, `api-pty`, and `service-filesystem`) now expose a real `test` script, so root filters no longer silently omit them. `service-kv` currently has no tests; its stale nonexistent-directory command was replaced with an explicit `--pass-with-no-tests` check so the zero-test state is visible without inventing coverage.

## Repeatable fixture

[`managed-architecture-baseline.v1.json`](../../../scripts/fixtures/managed-architecture-baseline.v1.json) fixes the scenario sizes:

- 10,000 browser-only `ui-widget` metadata elements across 100 canvases and 25 definitions;
- 250 modeled idle actors, sampled with four idle and two hot live child processes;
- 32 Automerge document handles and 64 peers reconnecting four times (256 joins);
- 500 modeled idle resources, 40 provisioned resource files, 12 hot resources, and an eight-handle bound;
- one cold start of the current server in an isolated temporary XDG root.

The generated 10,000-element deterministic state has SHA-256 digest `4d864fc1ef407b89f6b65671d689de8dac315bd67d4c583064a33b2183af6d87`. Its contract test rejects count drift and asserts that no element contains `actorDefinitionName` or `actorInstanceId`.

The live actor sample is deliberately smaller than the modeled idle population: the behavior being documented is one resident Bun child per live actor, so routinely spawning 250 children would make this evidence harness unsafe on many developer machines. Likewise, the resource fixture provisions a representative subset while preserving the larger modeled population in the recorded input.

## Reference capture

Captured 2026-07-21 on macOS arm64, Bun 1.3.14, 10 logical CPUs. Machine-dependent timings and memory values are observations, not thresholds.

| Dimension | Observed current behavior |
| --- | --- |
| Package graph | 30 workspace packages, 104 internal edges, digest `2ca7916077954b0b4750a8ea2a43ff1c636674d5194f8b1ef6554c6e00f534c9` |
| Empty current server | healthy in 642.038 ms; 373,888 KiB RSS; 78.4% sampled CPU; zero direct child processes; clean exit in 7.959 ms |
| 10,000 UI-only metadata records | 5,540,401 serialized bytes; zero actor-backed records; 8.896 ms create/serialize; 23,937,024-byte RSS delta |
| Actor sample | six live actors produced six child processes; 203,200 KiB aggregate idle child RSS; 208,368 KiB after hot work; 46.1% aggregate sampled post-work CPU |
| Actor lifecycle | 26.866 ms start; 2.562 ms close; zero children after stop; 22 snapshot events and 16 actor message events |
| Automerge | 32 handles / 128 elements; 256 reconnect joins; maximum 64 active peers; zero after leave; 192 replaced sockets closed and 64 final sockets terminated |
| Resource files | 40 provisioned, 12 hot; peak/open-after-workload exactly eight handles; zero handles after close; 113.034 ms provision and 22.103 ms workload |

The harness waits for Automerge's throttled writes to drain to Turso before teardown. This keeps the measurement repeatable and also protects the repository's existing negative-timeout postinstall patch from being confused with a teardown race.

## Visual and state references

No new mockup or screenshot is needed for M0 because production UI and renderer code are unchanged. The existing [`SCREENS.md`](../screens/SCREENS.md) canvas captures remain the visual reference. The deterministic UI-only digest, canvas interaction assertions, DOM portal transform assertions, fullscreen/window assertions, and CRDT remote-update assertions are the machine-checkable state references.

## Verification log

The focused and common checks were run on 2026-07-21:

| Command | Result |
| --- | --- |
| `bun run test:canvas-regression` | Passed: 200 canvas, 55 focused widget-host/placement, 7 Automerge, and 29 actor compatibility tests |
| `bun run test:managed-architecture-baseline` | Passed: three fixture/golden contract tests, 19 assertions |
| `bun run baseline:managed-architecture -- --output /tmp/vibecanvas-m0-baseline.json` | Passed and produced the reference capture summarized above |
| `bun run test` | Passed with the expanded, explicit package filters; `service-kv` reported its known zero-test state |
| `bun run lint:functional-core` | Passed |
| `bun run build` | Passed for all four release targets after downloading the pinned Turso native packages |
| `git diff --check` | Passed |

The CLI download tests, filesystem watch test, and baseline server probe require host localhost/file-watch access. Their first restricted-sandbox attempts could not bind/listen or observe file events; the same commands passed with those existing test capabilities allowed. The first build attempt also encountered sandbox DNS denial while fetching pinned native packages; the permitted rerun passed all targets.

## Interpretation boundaries

- Server RSS is a single cold-start sample, not a sizing recommendation.
- Process `%CPU` is the platform `ps` sample; host CPU microseconds are also emitted in the JSON result.
- Memory deltas share one harness process and can be affected by runtime garbage collection; counts, bounds, digests, and cleanup assertions are the stable comparisons.
- Reconnect bursts use the real Automerge server adapter and CBOR frames in-process rather than opening hundreds of kernel sockets.
- This baseline describes current behavior only. It does not claim the M7 zero-backend invariant for all future UI-only widget manifests.
