# M10 final managed-service acceptance evidence

Captured on 2026-07-22 for the completed clean managed-service rewrite.

## Accepted immutable revision

| Field | Evidence |
| --- | --- |
| Source revision | `73014e08885e2547fb5a1912e3afb194a26bb567` (`73014e08`) |
| M10 implementation checkpoint | `b72109ff` added the permanent clean-room, joined-flow, packed-consumer, load, architecture, recovery, build, and binary acceptance infrastructure |
| Clean-room command | `bun run test:ci:docker` |
| Container image | `sha256:1f0926c52e33ace94f45c2d43937f3ac1903ebd0b9b148e1091388fa0ebfd451` |
| Container platform | Ubuntu 24.04, `linux/arm64`, selected from the Docker daemon's native platform |
| Toolchain | Bun `1.3.14`, Node.js `22.17.0` |
| Dependency install | `bun install --frozen-lockfile`; 1,664 packages; Automerge throttle and Arrow sandbox postinstall patches applied |
| Final result | Every durable, common, build, and compiled-binary gate passed with legacy actors disabled |

The Docker wrapper archives the exact committed revision with `git archive`,
extracts it into a temporary build context, and supplies no caller
`node_modules`, untracked file, dirty-worktree byte, or writable bind mount. The
image refuses a pre-existing `node_modules`, installs from the frozen lockfile,
and runs the permanent final-acceptance script with a brand-new empty
`VIBECANVAS_HOME`.

The wrapper defaults to the daemon-native Linux architecture and accepts only
an explicit `linux/amd64` or `linux/arm64` override. The accepted ARM run still
cross-built all three Linux release artifacts: ARM64, x64, and x64 baseline.
Runtime certification for another ISA should run on a native daemon for that
ISA rather than treating a Bun crash in cross-architecture QEMU as a product
result.

The terminal acceptance result was:

```text
[final-acceptance] all durable, common, build, and binary gates passed with legacy actors disabled
[ci-docker] immutable revision 73014e08885e2547fb5a1912e3afb194a26bb567 passed final acceptance
```

## Clean-room procedure

| Step | Required procedure | Accepted evidence |
| --- | --- | --- |
| 1 | Start from a clean checkout/build environment | Docker received only an immutable archive of `73014e08`; the context contained neither `.git` state nor dependencies from the caller. |
| 2 | Use a brand-new temporary `VIBECANVAS_HOME` | `test-final-acceptance.ts` created a new temporary directory, asserted it was empty, passed it to every suite, and removed it afterward. |
| 3 | Install dependencies with the lockfile | The image ran `bun install --frozen-lockfile` and retained both required postinstall patches. |
| 4 | Run every permanent command in Section 3.4 | All eleven documented durable commands ran in order and passed. |
| 5 | Run common, binary, and Docker/CI gates | Functional-core lint, the complete sequential product suite, release build, compiled-binary acceptance, host `git diff --check`, and the immutable Docker wrapper passed. |
| 6 | Boot the binary twice and verify deterministic state | The compiled ARM64 binary created the exact managed schema, five-migration identity, seed, and integrity state; a real `SIGKILL` was followed by an exact same-home second boot and state comparison. |
| 7 | Exercise browser-only and server-backed widgets end to end | Widget publication/host suites and the joined production flow published and mounted UI-only and server-backed revisions; only the server-backed path invoked a short-lived function. |
| 8 | Exercise two organizations against one Automerge service | The isolation gate used same-ID documents for two organizations through one shared service, including membership, known-foreign, persistence, replay, and reconnect checks. |
| 9 | Run load, noisy-neighbor, idle-memory, and handle tests | The structured M10 load runner selected exactly nine named cases covering 10,000 widgets, resource LRU/idle close, function zero-residue, tenant progress, admission ceilings, connection ceilings, and reconnect churn. |
| 10 | Kill/restart server, executor, and Resource Store at fault points | The compiled server was killed with `SIGKILL`, which also terminates its embedded local executor and Resource Store. Targeted function claim/recovery, sandbox interruption, resource receipt replay, owner restart, WAL recovery, and close/reopen suites exercised each service's independent fault boundaries. |
| 11 | Back up and restore control, artifacts, and resource data | Recovery copied the complete home, including `main.db` and sidecars, immutable artifact bytes, encryption material, and representative resource `data.db`, then reopened it through production services. |
| 12 | Revalidate restored schema, integrity, and isolation | The restored-root test directly compared the schema fingerprint, migration identity, representative rows, header PRAGMAs, integrity, foreign keys, artifact digest, and resource rows, then proved an owner read succeeds and the same known foreign resource ID is denied. |
| 13 | Boot with legacy actors disabled | Docker and the final runner forced `VIBECANVAS_LEGACY_ACTOR_ENABLED=0`; the joined flow, complete product suite, health checks, and compiled binary remained operational. |
| 14 | Build the external composition fixture | Both the source fixture and five packed public packages installed, typechecked, and ran from clean consumer directories using only documented public exports. |

## Durable and common gates

| Gate | Accepted result |
| --- | --- |
| `bun run test:canvas-regression` | Four protected suites passed: canvas 50 files / 212 tests, widget UI 24 files / 196 tests, Automerge 41 tests, and actor IPC 31 tests. |
| `bun run db:schema:verify` | 7 tests / 541 assertions passed for pinned Turso features and the exact strict schema manifest. |
| `bun run db:constraints:test` | 10 tests / 52 assertions passed for invalid tenant, type, lifecycle, digest, path, lease, usage, and bound-SQL mutations. |
| `bun run db:recovery:test` | 48 tests / 233 assertions passed, including killed WAL writer, immutable migration recovery, compiled-style restart rules, and whole-home restore. |
| `bun run test:isolation` | All nine authority suites passed across tenant derivation, repositories, collaboration, filesystem/PTY, events, HTTP media, and browser teardown/switching. |
| `bun run test:resource-runtime` | All five ownership/recovery suites passed with mandatory file-descriptor inspection, single-owner fencing, operation receipt replay, WAL recovery, encryption, and bounded handles. |
| `bun run test:widget-artifacts` | All five immutable artifact suites passed for v2 contracts, builds, publication, rollback, authorization, retention, and crash-safe garbage collection. |
| `bun run test:function-runtime` | All seven bounded execution suites passed for durable invocation state, idempotency, leases, cancellation, limits, receipts, recovery, SDK generation, and zero residue. |
| `bun run test:widget-host` | All twelve neutral host suites passed, including exact CRDT projection, sandbox authority, collaborative state, function proxying, and two independent 10,000-widget paths. |
| `bun run test:external-composition` | The independent fake managed stack passed 2 tests / 14 assertions using public capability roots only. |
| `bun run test:architecture` | 19 tests / 254 assertions passed for package/API/UI boundaries, forbidden dependencies, public composition, and optional legacy ownership. |
| `bun run test:managed-v2-joined` | The legacy-disabled production path passed 1 test / 20 assertions and left zero child-process or resource-handle residue. |
| `bun run test:packed-public-composition` | Five public packages at `0.1.0` packed, installed into a clean consumer, typechecked, passed two tests, and completed a runtime smoke test. |
| `bun run test:m10:load` | All 9 exact structured-report cases passed. |
| `bun run lint:functional-core` | All `fn`, `fx`, and `tx` source rules passed. |
| `bun run test` | The complete sequential monorepo product suite and its final baseline/external/architecture gates passed. |
| `bun run build` | SPA assets, embedded assets, five embedded migrations, three Linux executables, release manifest, checksums, native Turso addons, and wrapper package built. |
| `bun run test:binary` | Native addon, old-home refusal, widget prerequisites, actor IPC, exact HTTP/assets/WebSockets, first-boot `SIGKILL`, same-home restart, schema/migration/seed/integrity/FK state, path precedence, legacy diagnostics, and port fallback all passed. |

## Bounded-cost and scale-to-zero proof

- The CRDT projection fixture committed 10,000 neutral widget rows and reported
  zero actor child processes, zero legacy actor rows, zero function sandbox
  starts, and zero function invocation rows across replay, delete, and undo.
- The production UI host rendered the 10,000-widget document with 32 active UI
  realms, a 512-entry queued-render ceiling, 2,420 deferred widgets, 7,036
  offscreen unmounts, 32 artifact loads, zero actor transport calls, and zero
  function transport calls.
- Widget artifact cleanup admitted exactly 64 global and 32 per-organization
  operations and reclaimed every retained capacity key. A blocked organization
  did not stop an independent organization from making progress.
- KV and database resource providers opened 40 resources against the production
  32-handle limit, proved LRU reopening, asserted the configured 60-second idle
  deadline with an injected deterministic clock, and closed to zero handles.
- One exact function revision executed in a real guest process and returned to
  zero PID, process-group, RSS, and working-directory residue. The joined
  production path repeated that proof while using a real resource binding.
- Automerge enforced and released global and per-organization connection
  ceilings, then replaced reconnect-burst peers without retaining stale
  sockets.

## Final acceptance matrix

| Property | Evidence |
| --- | --- |
| Fresh storage | Schema, recovery, and compiled-binary gates create `main.db` from the embedded immutable migration sequence and verify exact header, ledger, schema, and seed state. |
| Strict schema | Every application table is checked against the strict manifest; connection PRAGMAs and invalid tenant/type/state mutations are asserted through pinned Turso. |
| No old compatibility | Read-only preflight refuses actor-era, partial, view-only, virtual/shadow, unknown, and newer databases without repair or mutation. |
| API consolidation | Architecture and route-equivalence tests prove `@vibecanvas/api` is the sole API package and implements the complete router. |
| UI naming | Architecture and full package tests prove `ui-ai-chat` and `ui-actor-legacy` names, exports, imports, and builds. |
| Canvas preservation | The four M0 protected regression suites remain green, including the unchanged renderer and widget-frame behavior. |
| Browser-only cost | Both 10,000-widget paths report zero actor rows/processes and zero function starts/calls with bounded UI admission. |
| Function scale-to-zero | Function runtime, M10 load, and joined production tests prove exact process/group/RSS/cwd teardown. |
| Resource ownership | Mandatory FD inspection and owner-lock tests prove only Resource Store opens writable resource `data.db` files; logical consumers receive capabilities only. |
| Collaboration | One shared Automerge service persists same-ID documents for two organizations and contains reconnect, rate, storage, and membership authority. |
| Tenant integrity | The nine-suite same-ID and known-foreign/unknown isolation gate passes across storage, API, collaboration, resources, files, PTYs, events, media, agents, and browser state. |
| Artifact correctness | Immutable source/build bytes, revision pins, authorization, rollback, Preview retention, tamper rejection, and crash-safe GC all pass. |
| Fault recovery | Stale epochs are fenced; server `SIGKILL`, executor claims/receipts, Resource Store receipts/WAL, migrations, artifacts, and restored data recover to the declared exact state. |
| Private seam | Source and packed-consumer fixtures replace identity, placement, artifact, dispatch/execution, resource, collaboration, event, and usage implementations without source patching. |
| Legacy optionality | The default-disabled plugin is absent from normal v2 composition, while the complete product, joined, health, build, and binary paths pass with legacy disabled. |
| Explicit exclusions | Architecture scanning covers all manifests, source imports, and migrations and rejects PostgreSQL families, Resonate, durable-workflow, schedule/wait state, and maintained workflow engines. |

Independent recovery, end-to-end flow, clean-room, and holistic audits found no
remaining P0 or P1 blocker before the immutable Docker run. The accepted run
then exercised the exact committed implementation without a mutable workspace
escape hatch.

The Automerge throttle postinstall patch remains installed. Its negative-delay
clamp is still required until the pinned upstream dependency is deliberately
verified fixed.
