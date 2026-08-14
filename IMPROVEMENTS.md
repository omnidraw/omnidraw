# Implementation improvements

This is a follow-up code-quality audit of the implementation described by
[`docs/PRD.md`](docs/PRD.md). It assumes the corrective work recorded in
[`docs/PRD_REVIEW.md`](docs/PRD_REVIEW.md) is complete; it does not repeat the
previously closed product or architecture defects.

The findings below are opportunities to make the current implementation easier
to reason about, cheaper on hot paths, and more explicit about Effect
ownership. They are suggestions, not evidence that the current product
behavior is incorrect.

Priority guide:

- **P1** — high-leverage boundary or lifecycle work; prioritize before adding
  substantial behavior in the affected area.
- **P2** — worthwhile cleanup, optimization, or guardrail; schedule alongside
  related work.
- **P3** — naming, ergonomics, and low-risk consistency improvements.

## At a glance

| Priority | Area | Recommendation |
| --- | --- | --- |
| P1 | Canvas runtime | Split document policy, sync supervision, and browser/transport adapters. |
| P1 | Resource lifetime | Replace manual release lists with instance-owned `Scope`/`acquireRelease`. |
| P1 | Core Effect programs | Define exported `fx.*`/`tx.*` programs with `Effect.fn`. |
| P1 | Typed failures | Standardize expected failures around `Schema.TaggedError`. |
| P1 | Agent events | Give event history/streaming one authoritative service. |
| P1 | RPC transport | Make the operation registry the source of routing and codecs. |
| P1 | Shell boundaries | Decouple live mechanics ports from `TApiContext`. |
| P1 | Widget contracts | Remove or mechanically synchronize the backend copy of SDK-owned portable contracts. |
| P2 | Payload typing | Replace boundary `unknown` values with explicit JSON/DTO schemas. |
| P2 | Validation | Clarify and narrow the Zod/Effect Schema split. |
| P2 | Hot paths | Optimize Canvas validation, JSON canonicalization, and rate limiting after benchmarking. |
| P2 | Concurrency | Consolidate the two serialized-operation implementations. |
| P2 | Package cancellation | Add cancellation-aware request ports where the public API can support it. |
| P2 | Runtime composition | Split the large live-authority Layer file into feature-local adapters. |
| P3 | Cleanup | Normalize lifecycle naming, runtime wrappers, callback isolation, and test-runner policy. |

## 1. Effect separation and lifecycle

### 1.1 Split Canvas document orchestration into smaller owners — P1

Evidence:

- `packages/canvas/src/services/CanvasDocumentService.ts` is roughly 2,600
  lines and currently combines authored state, history, optimistic command
  queues, command planning, media upload/promotion/deletion, event
  consumption, recovery, retries, and image indexing.
- `packages/canvas/src/runtime.ts` is roughly 1,200 lines and combines engine
  boot, document service construction, editor setup, theme subscriptions,
  extension installation, shell state, input listeners, release ordering, and
  shutdown.

Suggested shape:

1. Keep pure `fn.*` modules for document transitions, command planning, image
   indexing, and optimistic reconciliation.
2. Add a small instance-owned `CanvasSyncSupervisor` for queues, retries,
   cancellation, generation fencing, and transport/media coordination.
3. Keep Cangine, DOM, transport, and media implementations in narrow adapters.
4. Leave the existing Promise and `AsyncIterable` public ports intact; adapt
   them at the package boundary rather than leaking Effect types.

This should make deterministic policy tests independent from browser setup and
make interruption/recovery behavior visible in one supervisor instead of being
distributed across a large mutable service and runtime closure.

### 1.2 Use an instance-owned `Scope` for Canvas resources — P1

`packages/canvas/src/runtime.ts` maintains a group of nullable release
functions and manually runs them in reverse order during shutdown. The
implementation is careful, but the ownership protocol is spread across
construction, failure cleanup, and disposal. `CanvasRuntimeLifecycle` also
maintains generation and disposal state separately.

Use an instance-owned Effect `Scope` with `Effect.acquireRelease` for engine,
subscriptions, listeners, extensions, and transport resources. Expose only a
Promise-based `dispose`/lifecycle facade from the public package. Keep one
boundary-level policy for best-effort cleanup and aggregated shutdown errors.

Benefits are uniform cleanup on partial acquisition failure, less manual state,
and clearer guarantees when a runtime is replaced during a generation change.

### 1.3 Define exported `fx.*` and `tx.*` programs with `Effect.fn` — P1

Many core programs follow this shape:

```ts
export function fxSomething(args: Args) {
  return Effect.gen(function* () {
    // ...
  })
}
```

Examples include `apps/backend/src/core/widgets/tx.publish.ts`,
`apps/backend/src/core/widgets/fx.catalog.ts`, and the Canvas, resources,
functions, and agent `fx.*`/`tx.*` modules.

The local Effect guide recommends naming exported programs with
`Effect.fn("programName")`. Convert the exported entrypoints to that form and
keep `Effect.gen` for nested implementation blocks. This gives programs stable
names for tracing and diagnostics and makes the functional-core convention
mechanically checkable.

Add an architecture test that rejects a direct `return Effect.gen(...)` from a
core `fx.*` or `tx.*` export once the conversion is complete.

### 1.4 Standardize expected failures with `Schema.TaggedError` — P1

Expected failure classes are repeated across agent, Canvas, database, events,
functions, resources, widget state, and widgets. Most carry a string `code`, a
message, and an optional cause. The live Layer then repeats code/message
extraction and feature-specific error mappers in
`apps/backend/src/shell/runtime/layer.semantic-authorities.ts`.

Define feature-owned tagged failure schemas with explicit code unions and
structured details. Keep provider, database, and transport failures in the
shell; only map them into semantic failures at the service boundary. Then
centralize the shell mapping from semantic failures to RPC errors/log fields.

This enables typed matching instead of `instanceof` and ad hoc string
inspection, and makes serialization and observability consistent. It should be
done incrementally, feature by feature, because changing failure tags is a
wire/diagnostic contract change.

### 1.5 Make cancellation bridging consistent across public packages — P2

The Canvas, SDK, and AI Chat packages all keep Effect internal, but their
runtime bridges do not have one consistent cancellation policy:

- `packages/canvas/src/internal/CanvasEffectRuntime.ts` uses a managed runtime
  and manual serial semaphore/disposal state.
- `packages/sdk/src/internal/effect-runtime.ts` wraps arbitrary Promise tasks in
  `Effect.promise`; cancellation only works when the task observes the signal.
- `packages/component-ai-chat/src/internal/stream-lifecycle.ts` uses explicit
  `AbortController` instances for stream/poll lifecycles.

Use one documented local pattern in each package: `acquireRelease` for an
abort controller or subscription, `tryPromise` for abort-aware operations, and
an explicit policy for defects versus expected failures. Do not create a new
public shared runtime package just to deduplicate a few helpers.

The polling program in `stream-lifecycle.ts` should also express repeat,
retry, and cancellation with an Effect schedule rather than recursive Effect
construction.

### 1.6 Consolidate duplicate Promise/Effect connection waits — P2

`apps/frontend/src/shell/transport/rpc.ts` has both Promise-based connection
generation waits and an Effect callback-based wait. Keep one internal
generation primitive and provide the Promise adapter only at the browser/client
boundary. This avoids maintaining two listener and timeout paths with subtly
different interruption behavior.

### 1.7 Consider cancellation-aware public async ports — P2

`packages/canvas-contract/src/types.ts` exposes Promise-based document transport
operations without an `AbortSignal`, and Canvas image/media ports have the same
shape. Internal Effect interruption can fence a late result, but it cannot stop
the underlying fetch, upload, or provider work unless the adapter has a signal
to pass through.

For a compatible API revision, add an optional signal to request arguments or
provide an abortable wait handle. Implement and test actual adapter-level
abort, not only stale-generation rejection. If this would be a breaking
public-package change, schedule it for the next major version rather than
forcing a compatibility shim into the current contract.

## 2. Ownership and boundary clarity

### 2.1 Make EventAuthority the sole agent-event authority — P1

Agent events currently appear in both:

- `apps/backend/src/core/agent/service.agent.ts` and `fx.events.ts`; and
- `apps/backend/src/core/events/service.events.ts` and
  `fx.agent-events.ts`.

The live Layer wires both paths to `subscribeAgentEventRecords`, and the
simulation Layer keeps two corresponding event collections. The RPC stream
uses the AgentAuthority path while EventAuthority is mainly exercised by its
own conformance suite.

Choose one owner for agent event history, cursors, replay, and streaming—most
naturally EventAuthority. Keep AgentAuthority focused on agent connection and
history operations, or explicitly rename the two concepts if they represent
different semantics. Remove the duplicate program, Layer wiring, and fixture
state after the conformance suite is moved to the chosen owner.

This reduces the risk of diverging cursor, ordering, retention, or backpressure
behavior between live and simulated implementations.

### 2.2 Decouple live mechanics ports from API context — P1

`apps/backend/src/shell/runtime/service.live-mechanics.ts` defines feature
mechanics such as `LiveAgent`, `LiveResource`, and `LiveWidgetCatalog` in terms
of properties from `TApiContext`. This makes the runtime service layer depend
on the transport-facing API context even when the mechanics are used by
non-RPC code.

Define feature-owned shell ports (`IAgentMechanics`, `IResourceMechanics`,
`IWidgetMechanics`, and so on) beside their adapters. Make API procedures
consume those ports, rather than making the ports derive their types from the
API context. The runtime composition can then be tested independently of RPC
and the dependency direction is easier to see.

### 2.3 Make the private RPC operation registry authoritative — P1

`apps/backend/src/shell/transport/layer.rpc-dispatcher.live.ts` contains a
large manual path-dispatch chain with repeated input casts, service provision,
and error mapping. Separately, `operation-contract.ts` manually lists the
request and stream paths, while the frontend maintains another large mirror in
`apps/frontend/src/core/app/private-operation-contract.ts`.

Create one declarative operation registry containing path, request/response
codec, procedure or stream adapter, error policy, and idempotency/cursor
metadata. Derive path unions and server dispatch from it. Generate or validate
the frontend contract from the same source without adding a runtime dependency
from backend to frontend. Keep the current parity tests as a guardrail.

This removes most string comparisons and `input as ...` casts, makes new
operations cheaper to add, and provides a natural place to document replay and
cancellation policy.

### 2.4 Canonicalize the overlapping SDK/backend widget contracts — P1

The PRD assigns the portable widget manifest, artifact, guest ABI, and related
contracts to `@omnidraw/sdk`, but the backend has a substantial parallel
`apps/backend/src/core/widget-domain` surface. Most backend code imports that
copy, while the backend imports `@omnidraw/sdk` primarily for package metadata
and generated widget dependency paths.

Separate the surfaces explicitly:

- import the canonical SDK manifest/artifact/descriptor types, schemas, and
  pure canonicalizers wherever the backend needs the portable contract;
- keep backend-only authority, filesystem, release, provider, and policy types
  local; and
- if a server projection is unavoidable, generate it from the SDK contract or
  add a parity test that compares canonical schema/version/type inventories.

The current duplicate files are similar but not identical, including naming
and import differences in filesystem-manifest, filesystem-input,
portable-build-receipt, and function-descriptor code. Making the projection
mechanical will prevent OSS/managed widget behavior from drifting.

Also reconsider `lucide-static` in backend core widget-domain code. The SDK
should own portable icon-key validation; backend core should consume the
contract rather than making a renderer asset library part of core policy.

### 2.5 Reduce `unknown` at semantic and wire boundaries — P2

Several semantic contracts intentionally use `unknown` for values that are
already crossing a known boundary: event JSON, agent history messages and
vector-clock JSON, function inputs/outputs, chat messages, widget artifacts,
and resource data-set results. The dispatcher also reconstructs request maps
with broad casts.

Use an explicit package-owned JSON alias (or `Schema.Json`) for arbitrary JSON,
and define feature DTOs for values whose shape is known. Decode once at the
shell ingress, then pass the decoded value through the semantic service. Keep
provider-defined payloads opaque only where they are genuinely provider-owned,
and wrap them in a typed domain envelope.

This narrows unsafe casts and makes error paths visible without making the
public packages depend on Effect.

### 2.6 Clarify the Zod versus Effect Schema policy — P2

The public packages correctly avoid Zod, but backend application code mixes
Zod schemas in `core/widget-domain` and the API layer with Effect Schema in
other areas. The repository’s Effect guide treats Schema as the preferred
validation model.

Decide and document a narrow rule. A good transition is to use Effect Schema
for private RPC/error and semantic boundary contracts, while permitting Zod as
a shell-only adapter where existing tooling requires it. Avoid exposing either
library from public package APIs and avoid maintaining two independent schemas
for the same wire contract.

## 3. Hot paths and concurrency

### 3.1 Benchmark and optimize Canvas command validation — P2

`apps/backend/src/core/canvas/fn.reduce-command.ts` validates the full current
document after each command, scans current items for deleted-child checks, and
sorts changed items per command. `fn.command.ts` also recursively measures JSON
and canonicalizes keys during validation/equality checks. The live Canvas
authority performs additional reads and retry validation around the optimistic
revision loop.

Before changing semantics, add large-document and multi-operation benchmarks.
Then consider:

- maintaining parent/clip indexes so affected validation closure is selected
  without scanning every item;
- validating the complete document at external snapshot ingress while using
  affected-closure validation for trusted internal transitions;
- carrying canonical byte size/digest information through pure transitions; and
- memoizing or reusing canonical JSON for repeated equality/size checks.

The optimization is worthwhile only if the benchmark shows this path is a
material cost; correctness of the existing validation should remain the first
constraint.

### 3.2 Make `WidgetStateMutationRateLimiter` a pure transition — P2

`apps/backend/src/core/widget-state/WidgetStateMutationRateLimiter.ts` owns a
mutable `Map` and timestamp arrays inside core. Move the policy to a pure
function such as:

```text
fnAdmitWidgetStateMutation({ state, scope, now, limits })
  -> { decision, state }
```

Let the shell own the map, lifecycle, and clock. This makes the rule directly
reusable by simulation and eliminates hidden mutable state from core. The
current pruning loop also uses repeated `Array.shift()`; a head index or deque
would avoid repeated array movement if profiling confirms this is hot.

### 3.3 Consolidate serialized-operation machinery — P2

`apps/backend/src/shell/concurrency/run-serialized-operation.ts` and
`apps/backend/src/shell/database/run-database-transaction.ts` both implement
an `AsyncLocalStorage`-aware tail/queue pattern, with different constants and
transaction wrappers.

Extract one carefully tested shell primitive parameterized by operation scope,
lease/tail storage, and the actual runner. Keep
`runSerializedOperation`, `runDatabaseTransaction`, and `runDatabaseWrite` as
thin policy wrappers. Test nested calls, reentrancy, failure, interruption,
and tail cleanup once.

## 4. Runtime composition and cleanup

### 4.1 Split the live authority Layer by feature — P2

`apps/backend/src/shell/runtime/layer.semantic-authorities.ts` is a single
file that imports most core services and all live mechanics, then defines the
live adapters for agents, Canvas, events, functions, resources, widget state,
and widgets.

Move adapter factories into feature-local shell files and leave the runtime
module responsible only for composing Layers. This makes the live/sim pairing
obvious, reduces import fan-in, and lets feature tests exercise one adapter
without loading the entire authority graph.

### 4.2 Rename portal-era lifecycle terminology — P3

`packages/canvas/src/components/CanvasRuntimeLifecycle.ts` still exposes
`TCanvasRuntimeLifecyclePortal` and stores a `portal` field. The current
architecture language uses host/lifecycle/coordinator terminology and
explicitly retired portal parameters. Rename this to `host`, `lifecycleHost`,
or `coordinator` so the code does not suggest the old architecture is still a
supported extension point.

### 4.3 Standardize the small package runtime wrappers — P3

`CanvasEffectRuntime`, `AiChatEffectRuntime`, and `SdkEffectRuntime` each wrap
an internal managed runtime but implement slightly different disposal,
serialization, and callback behavior. Keep them package-local, but document a
common lifecycle template and align:

- runtime creation and disposal;
- serial work ownership;
- AbortSignal bridging;
- expected-failure versus defect handling; and
- behavior when work is started after disposal.

This is a consistency cleanup, not a reason to add a cross-package runtime
abstraction that would enlarge the public surface.

### 4.4 Isolate callback defects at browser/runtime edges — P3

`apps/frontend/src/shell/runtime/frontend-runtime.ts` and the transport layer
fork Effects around observer callbacks. The code handles the expected failure
channel, but callback exceptions/defects should have an explicit policy so one
observer cannot silently terminate a supervision path. Add a small edge helper
that records or reports `Cause` while preserving the runtime’s lifecycle
guarantees.

## 5. Follow-up guardrails

Add focused checks as these refactors land:

- a source rule for named `Effect.fn` entrypoints in core `fx.*`/`tx.*` files;
- a failure matrix covering typed failures, defects, interruption, and cleanup
  errors for each package runtime;
- a generated-or-parity check for SDK/backend widget contract inventories;
- a registry drift test for backend/frontend private RPC operations;
- benchmarks for large Canvas reduction/query, widget-state rate limiting, and
  serialized database operations; and
- a documented test-runner policy. The frontend currently uses both Bun tests
  and Vitest; standardize by layer or document the reason for the split so
  environment differences are intentional.

## Suggested order

1. Remove the duplicate agent-event authority and clarify live mechanics ports.
2. Convert core programs to named `Effect.fn` entrypoints and standardize
   typed failures.
3. Refactor Canvas resource ownership and then split its orchestration around
   the new scope/supervisor boundary.
4. Make the RPC registry authoritative and canonicalize the SDK/backend widget
   contract boundary.
5. Benchmark the Canvas and widget-state hot paths, then apply measured
   optimizations and consolidate serialized-operation machinery.
6. Finish naming, runtime-wrapper, callback, and test guardrail cleanup.
