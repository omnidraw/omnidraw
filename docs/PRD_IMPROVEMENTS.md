# PRD implementation improvements

This is a code-quality audit of the implementation described by
[`docs/PRD.md`](PRD.md) and [`docs/internal/llm.app-architecture.md`](internal/llm.app-architecture.md).
It is an independent follow-up inspection, not a product or architecture
correctness review. The findings below are suggestions: opportunities to make
the current implementation cheaper on hot paths, easier to reason about, and
more explicit about where Effect ownership lives.

The implementation is already highly disciplined: `apps/backend` and
`apps/frontend` both keep a real `core` / `shell` / `sim` / `conformance`
split, the five public packages keep their exported APIs Effect-free, no
public package imports Zod, `canvas-contract` and `theme` have no Effect
dependency, and the retired runtime (`tapable`, oRPC, PartySocket, `ws`, SSE,
`global.d.ts`, `FILES.md`) is gone from final manifests. The items below are
refinements on top of that baseline.

Related documents:

- [`docs/PRD_REVIEW.md`](PRD_REVIEW.md) records previously closed product and
  architecture defects.
- `IMPROVEMENTS.md` (repo root) is a separate audit that overlaps on a few of
  the larger refactors (Canvas document service, RPC registry, widget-contract
  duplication). This document is self-contained and cites its own evidence.

Priority guide:

- **P1** — boundary or lifecycle work with broad blast radius; do before adding
  behavior in the affected area.
- **P2** — worthwhile cleanup or optimization; schedule with related work.
- **P3** — naming, dead code, and low-risk consistency cleanup.

## At a glance

| Priority | Area | Recommendation |
| --- | --- | --- |
| P1 | RPC dispatch | Replace the manual path-dispatch chain with one declarative operation registry. |
| P1 | Semantic authorities | Split the single live-authority adapter file and the repeated error mappers into feature-local adapters. |
| P1 | Agent events | Remove the duplicate `AgentAuthority` / `EventAuthority` event path. |
| P1 | Widget contracts | Delete or mechanically sync the backend copy of SDK-owned portable contracts. |
| P1 | Widget-state limiter | Move the mutable rate limiter out of core into a pure transition plus a shell-owned store. |
| P2 | Effect idioms | Express retry/polling with `Schedule` instead of hand-rolled recursion; stop using `Queue.offerUnsafe` in `Stream.callback`. |
| P2 | SQL registry | Consolidate numbered near-duplicate statements and fix double-prefixed names. |
| P2 | Hot paths | Benchmark Canvas command validation, canonical JSON, and rate limiting before optimizing. |
| P3 | Dead code | Remove the unused `core/shared/functional` helpers and stray debug `console.log`s. |
| P3 | Assets | Differentiate `theme/default.css` from `theme/canvas.css`; reduce the dual `lucide-static`/`lucide-solid` split. |

## 1. Clearer Effect separation

### 1.1 Make the private RPC operation registry the routing source — P1

Evidence: `apps/backend/src/shell/transport/layer.rpc-dispatcher.live.ts`.

Dispatch is currently four hand-written string-matching chains
(`coreCanvasRequest`, `coreSemanticRequest`, `coreCanvasStream`,
`coreSemanticStream`) that each:

- normalize a path, then `join('.')` and compare to literal strings;
- cast `input` with `input as Parameters<typeof fx…>[0]` or rebuild request
  objects field by field from `request.canvasId as string`, etc.;
- repeat the same `Effect.provideService(...)` + `Effect.mapError(rpcError)`
  boilerplate for every operation.

`rpcError()` also encodes HTTP status selection as a nested ternary tree that
must be kept in sync with every failure type.

Suggested shape: a single declarative registry entry per operation holding
`path`, request/response codec, whether it is a stream, the core program or
shell handler, error policy, and idempotency/cursor metadata. Derive the path
union and the dispatcher from that registry. Keep the existing frontend parity
test (`tests/transport/private-rpc-contract.test.ts` and the frontend mirror in
`apps/frontend/src/core/app/private-operation-contract.ts`) as the guardrail
while the manual chains are retired.

This removes most `as` casts, makes new operations a data row instead of a new
`if (normalized === …)` branch, and gives idempotency/cursor policy one home.

### 1.2 Split the semantic-authority Layer and centralize error mapping — P1

Evidence: `apps/backend/src/shell/runtime/layer.semantic-authorities.ts`
(one file building all six authorities) and
`apps/backend/src/shell/runtime/layer.live-mechanics.ts` (730 lines).

- Each authority repeats `codeOf`/`messageOf` and a feature-local
  `agentFailure` / `eventFailure` / `resourceFailure` / `functionFailure` /
  `stateFailure` / `widgetFailure` mapper that differ only by the fallback
  code and message.
- `widgetAuthorityFromLive` mixes a manual `close()` side channel,
  `Object.assign(authority, { close() { … } })`, and a separately registered
  `Effect.addFinalizer` to dispose it.

Suggested shape: one shared shell helper that maps a `{ code?, message? }`
unknown into a tagged semantic failure, parameterized by the feature's fallback
code. Move each `*AuthorityFromLive` adapter beside its feature's shell adapter
files. For the widget authority, model the subscription lifetime as
`Effect.acquireRelease` returning the authority (or the close function), so
`Layer.effect` owns the resource and no `Object.assign` side channel is needed.

### 1.3 Stop using `Queue.offerUnsafe` inside `Stream.callback` — P2

Evidence: `apps/backend/src/shell/runtime/layer.semantic-authorities.ts:348`.

The widget publication stream is built with `Stream.callback`, but the inner
listener pushes events via `Queue.offerUnsafe(queue, event)` rather than the
emit function the callback contract provides.

`offerUnsafe` is non-suspending and does not honor queue capacity, so a slow or
paused consumer can silently drop publication events or violate backpressure
expectations. Use the emit/`Effect.callback` path so backpressure and error
semantics are the runtime's responsibility, and add a test that a slow
consumer applies backpressure without losing publications.

### 1.4 Use `Schedule` for retry and polling instead of recursion — P2

Two programs hand-roll what `Schedule` already expresses:

- `apps/frontend/src/core/app/fx.recover-after-reconnect.ts` implements
  `attempt(retryIndex + 1)` with a hardcoded delay array
  (`FRONTEND_RECONNECT_RECOVERY_RETRY_DELAYS_MS`) and manual `Effect.sleep`.
- `packages/component-ai-chat/src/internal/stream-lifecycle.ts` builds its poll
  loop with `Effect.suspend` and a self-referential `Effect.andThen(poll)`.

Express the retry policy with an Effect `Schedule` (bounded delays plus an
on-failure generation check) and the poll loop with a repeat/schedule
combinator. This makes the cancellation, backoff, and terminal conditions
declarative and keeps the active `Clock` as the only time source.

### 1.5 Move the widget-state rate limiter to a pure transition — P1

Evidence: `apps/backend/src/core/widget-state/WidgetStateMutationRateLimiter.ts`.

This class owns a mutable `Map` and timestamp arrays inside `core`, so it is
neither deterministic nor state-free and cannot be reused directly by `sim`.

Suggested shape:

```text
fnAdmitWidgetStateMutation({ state, scope, now, limits })
  -> { decision, state }
```

Shell owns the ledger `Map`, lifecycle, and clock; core owns only the
admission/eviction policy as a pure function. This is a direct instance of the
architecture rule that core owns decisions and shell owns mutable
infrastructure.

### 1.6 Remove the duplicate agent-event authority — P1

Evidence:

- `apps/backend/src/core/agent/fx.events.ts` exposes `fxAgentEvents` through
  `AgentAuthority`.
- `apps/backend/src/core/events/fx.agent-events.ts` exposes
  `fxAgentEventRecords` through `EventAuthority`.
- Both return the same `Stream<TSequencedEvent<TAgentEvent>>`, and the live
  Layer wires both paths to the identical `subscribeAgentEventRecords`.

The RPC stream uses the `AgentAuthority` path while `EventAuthority` is
primarily exercised by its own conformance suite. Choose one owner for agent
event history, cursors, replay, and streaming (most naturally
`EventAuthority`), move the conformance scenario to it, and delete the
duplicate program, Layer wiring, and simulation fixture state. Otherwise cursor
and retention semantics will inevitably drift between the two.

### 1.7 Align the three package runtime wrappers — P2

`packages/canvas/src/internal/CanvasEffectRuntime.ts`,
`packages/sdk/src/internal/effect-runtime.ts`, and
`packages/component-ai-chat/src/internal/stream-lifecycle.ts` each wrap a
`ManagedRuntime` with a slightly different disposal, serialization, and
cancellation policy:

- `SdkEffectRuntime.run` uses `Effect.promise`, so interruption only fences the
  result and cannot cancel the underlying Promise unless the task observes the
  `AbortSignal`.
- `AiChatEffectRuntime` keeps a manual `#latestTasks` map keyed by semantic
  strings.
- `CanvasEffectRuntime` keeps its own serial semaphore/disposal state.

Keep the runtimes package-local (do not create a sixth public package), but
document one template: `acquireRelease` for an `AbortController`/subscription,
`tryPromise` for abort-aware work, an explicit expected-failure-versus-defect
policy, and a defined behavior for work started after disposal.

### 1.8 Do not keep mutable caches in `fn.*` modules — P3

Evidence: `apps/backend/src/core/shared/functional/fn.memoize.ts`.

`fnMemoize` is a stateful closure (`const cache = new Map(...)`) inside a module
that the file-naming convention marks as pure. The cache is also unbounded.
This module is currently dead code (see 3.1); if a memoizer is ever reintroduced
it should be shell-owned and size-bounded, not a `fn` helper.

## 2. Cleanup

### 2.1 Remove dead `core/shared/functional` helpers — P3

`apps/backend/src/core/shared/functional/` contains `fn.compose.ts`,
`fn.curry.ts`, `fn.memoize.ts`, and `fn.pipe.ts`. None of their exports
(`fnCompose`, `fnCurry`, `fnMemoize`, `fnPipe`) are referenced anywhere in
production code — only by their own conformance tests. These are portal-era
survivors. Delete the directory and its tests, or keep a single genuinely used
helper with a real consumer.

### 2.2 Remove stray debug logging in `AgentService` — P3

Evidence: `apps/backend/src/shell/agent/AgentService.ts:248` and `:286`.

`start()` and `stop()` still emit `console.log('start', this.name)` /
`console.log('stop', this.name)`. Replace with the shell's diagnostic/logger
port or delete. (CLI `console.log` output elsewhere is intentional; these two
are not.)

### 2.3 Canonicalize the SDK/backend widget-contract copy — P1

Evidence: `apps/backend/src/core/widget-domain` (24 files) versus
`packages/sdk/src/contracts/core` (16 files). A sample diff of
`fn.filesystem-input.ts` differs only by relative import paths and a trailing
newline; the same is true for `fn.filesystem-manifest.ts`,
`fn.portable-build-receipt.ts`, and `fn.function-descriptor.ts`.

The PRD assigns the portable manifest/artifact/guest ABI to `@omnidraw/sdk`.
Backend core should import the canonical SDK types/schemas for the portable
surface and keep only backend-only authority/filesystem/release/policy types
local. If a server projection is genuinely unavoidable, generate it or add a
parity test that compares canonical schema/version/type inventories so OSS and
managed cannot drift.

Related: `apps/backend/src/core/widget-domain/tool-icon.ts` re-imports
`lucide-static` for icon-key validation; portable icon-key validation belongs
to the SDK contract, not to backend core policy.

### 2.4 Consolidate the numbered and double-prefixed SQL statements — P2

Evidence: `apps/backend/src/shell/database/statement-registry.ts` and the
`apps/backend/src/shell/database/stmts/` directory.

The registry contains near-duplicate numbered variants and awkwardly
double-prefixed names:

- `canvasReadCanvases`, `canvasReadCanvases2`, `canvasReadCanvases3`
- `resourceControlReadResourceCatalog`, `…Catalog2`, `…Catalog3`
- `schemaContractReadSqliteSchema`, `…2`, `…3`
- `mediaFileReadReadMediaFiles`, `mediaFileReadReadMediaFiles2`
- `dbResourceReadReadDbResourceDrafts`, `dbResourceReadReadDbResourceDrafts2`
- `dbResourceWriteReadDbResourceDraftChanges`, `…2`
- `transactionSetPragmaForeignKeys`, `transactionSetPragmaForeignKeys2`
- `encryptionKeyReadReadResourceEncryptionKeys`,
  `keyValueReadReadKeyValues`, `dbResourceReadReadDbResourceApplyRuns`, etc.

The `2`/`3` suffixes indicate statements that accreted near-duplicates instead
of being parameterized or deleted, and the `readRead`/`writeRead` prefixes are
redundant. Consolidate into one operation per semantic read/write (the
architecture's "one operation per SQL file" rule) and add a lint/test that
rejects numbered statement suffixes and duplicated prefixes.

### 2.5 Differentiate the two theme stylesheet entrypoints — P3

Evidence: `packages/theme/scripts/build.ts` writes both `dist/default.css` and
`dist/canvas.css` from the same `scopedDefaults` string, so the two published
entrypoints are byte-identical.

The PRD says `default.css` exports application defaults and `canvas.css`
exports Canvas-scoped defaults. If the two are meant to differ, emit distinct
content; if they are intentionally identical today, document that the
Canvas-scoped entrypoint is currently an alias so consumers and the PRD stay in
sync.

### 2.6 Reduce the dual icon-library dependency — P3

`@omnidraw/component-ai-chat` depends on both `lucide-solid` (peer-adjacent,
for Solid components) and `lucide-static` (for `WidgetIcon`). `@omnidraw/sdk`
depends on `lucide-static`, and `@omnidraw/canvas` depends on `lucide-solid`.
Consolidate on one icon strategy per package (static SVG names where no Solid
runtime is needed, `lucide-solid` where it is) so `component-ai-chat` is not
shipping two icon runtimes, and verify the icon set used for portable widget
icons lives only in the SDK contract.

## 3. Optimizations

### 3.1 Benchmark Canvas command validation before optimizing — P2

Evidence: `apps/backend/src/core/canvas/fn.reduce-command.ts` validates the full
current document after each command, scans current items for deleted-child
checks, and sorts changed items per command; `fn.command.ts` recursively
measures JSON and canonicalizes keys during validation/equality checks.

Add a large-document benchmark first, then consider:

- maintaining parent/clip indexes so the affected validation closure is
  selected without scanning every item;
- full-document validation only at external snapshot ingress, with
  affected-closure validation for trusted internal transitions;
- carrying canonical size/digest through pure transitions rather than
  recomputing them for repeated equality/size checks.

Correctness of the existing validation remains the first constraint; optimize
only where the benchmark shows material cost.

### 3.2 Avoid repeated `Array.shift()` in the rate-limiter prune loop — P2

`WidgetStateMutationRateLimiter.#prune` calls `ledger.timestamps.shift()` in a
`while` loop, which is O(n) per element removed. A head index or a small deque
removes timestamps in O(1). Only worth doing if profiling confirms the limiter
is hot; the larger win is extracting it to a pure transition (1.5) so the store
can be profiled and replaced independently.

### 3.3 Reuse canonical JSON on repeated equality/size checks — P2

`apps/backend/src/core/fn.canonical-json.ts` is correct and pure, but
`fnCanonicalJson` + `fnCanonicalStateDigest` re-walk and re-stringify the value
on every call. Where the same value is measured more than once (command
equality, size gating, replay digests), memoize the canonical form or carry the
digest alongside the transition result. Keep this bounded and shell-owned if a
cache is introduced.

### 3.4 Split the largest modules along ownership lines — P2

These are the largest non-test source files and combine multiple owners:

- `packages/canvas/src/services/CanvasDocumentService.ts` (~2,620 lines): state,
  history, optimistic queues, command planning, media, events, recovery,
  retries, image indexing.
- `packages/canvas/src/runtime.ts` (~1,230 lines): boot, service construction,
  editor setup, theme subscriptions, extensions, shell state, input listeners,
  release ordering.
- `apps/backend/src/shell/resources/local/DbResource.ts` (~2,610 lines) and
  `apps/backend/src/shell/resources/local/ResourceKeyValueStore.ts`
  (~1,370 lines): large shell adapters that can be split into capability-local
  files.
- `apps/backend/src/shell/database/CONSTANTS.ts` (~2,150 lines): mostly the
  embedded migration/statement text; splitting it does not reduce behavior but
  would make the registry more navigable.

Split by responsibility (pure policy vs sync supervisor vs adapter) where the
file mixes them; leave genuinely large adapters alone if they are single-owner.

## 4. Follow-up guardrails

Add focused checks as these refactors land:

- a dead-code check for `core` helpers with no production references;
- a statement-registry test rejecting numbered suffixes and redundant prefixes;
- a registry-drift test that the backend and frontend private RPC operations
  stay in sync with the operation registry (1.1);
- a parity or generation check for the SDK/backend widget-contract inventories
  (2.3);
- benchmarks for large Canvas reduction/query, widget-state rate limiting,
  canonical JSON, and serialized database operations;
- a lint rule that `fn.*` files import no Effect runtime values and hold no
  mutable module state (already largely enforced manually, but worth making
  structural).

## Suggested order

1. Remove the duplicate agent-event authority and dead `shared/functional`
   helpers (small, removes ambiguity).
2. Make the RPC operation registry authoritative and centralize the semantic
   error mappers.
3. Canonicalize the SDK/backend widget-contract boundary and move the
   widget-state limiter to a pure transition.
4. Replace hand-rolled retry/poll recursion with `Schedule` and drop
   `Queue.offerUnsafe` from the widget publication stream.
5. Consolidate the numbered SQL statements and split the largest modules.
6. Benchmark Canvas validation, canonical JSON, and rate limiting, then apply
   the measured optimizations and finish the P3 cleanup (logging, theme CSS,
   icon libraries).
