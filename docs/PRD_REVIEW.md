# PRD implementation review

Date: 2026-08-13  
Reviewed tree: branch `effectV4`, working-tree implementation based on `1f09f265b`  
Verdict: **not accepted; release-blocking refactor and product defects remain**

## 1. Executive verdict

The repository has the requested outer workspace shape—two applications and five
public packages—but the application refactor itself was not completed. Most of
the old backend was relocated beneath `apps/backend/src/private`, `services`, and
`plugins`, then wrapped by a small Effect runtime. The frontend was moved into
application-owned folders, but it has no `core`, `shell`, `sim`, or
`conformance` split at all.

The current product also fails its primary widget and AI Chat workflows:

1. A newly drawn widget frame is persisted and selected, but its DOM portal is
   not mounted until the page is reloaded.
2. After reload, the backend rejects every canonical AI Chat node because the
   frontend writes `kind: "ai-chat"` while the backend still authorizes only
   `kind: "ai"`.
3. The frontend independently redefines the Effect RPC contract without its
   error schema. It therefore decodes every legitimate backend failure against
   `never`, producing the reported `Expected never at ["cause"][0]["error"]`.
4. Generic published widget placement also creates a nested `undefined` field,
   which Effect's JSON codec rejects before the request can be sent.
5. Sidebar drag/drop was reduced to an immediate `pointerdown` commit using raw
   screen coordinates. The former threshold, pointer lifecycle, camera
   conversion, clamping, cancellation, and placement preview are absent.

The test suite's green result is not evidence that the product works. The
repository browser acceptance passes while AI Chat is visibly in an error
state, because it checks only that a frame was persisted. It does not require a
portal, a mounted chat shell, a successful `agent.chat.connect`, or a prompt
round trip.

This review treats the application architecture document as authoritative and
also applies the clarified requirement that **both** applications use only
`core`, `shell`, `sim`, and `conformance` under `src`, apart from tiny entrypoint
or stylesheet exceptions. Frontend simulation readiness is required; frontend
DST schedule exploration is not yet required.

## 2. Authorities and review method

The review used these authorities:

- `docs/internal/llm.app-architecture.md`
- `docs/PRD.md`
- `docs/external/llm.effect.md`
- `docs/internal/llm.widget-system.md`
- `docs/internal/screens/SCREENS.md`
- the repository `AGENTS.md`
- the vendored Effect v4 source under `repos/effect`

The review was evidence-driven rather than based only on static source scans.

### 2.1 Runtime reproductions

Two isolated source-run development environments were used:

| Environment | Backend | Frontend | Purpose |
|---|---:|---:|---|
| Fresh isolated home | `39100` | `39102` | Real Canvas creation and AI Chat drag |
| Copy of the reported user home | `39110` | `39112` | Reopen the exact reported Canvas and chat IDs without modifying the original home |

The in-app browser was used to operate the real UI. The original user data was
never mutated; testing used a temporary copy.

Observed on the fresh home:

- A real AI Chat drag persisted a `widget-frame` and left its selection outline.
- Immediately after the drag there were zero AI Chat shells and zero registered
  widget portals.
- After reload there was one AI Chat shell and a registered portal for the same
  durable node.
- This proves that persistence succeeds while live portal reconciliation fails.

Observed on the copied reported home:

- The reported Canvas opened with two persisted AI Chat frames.
- Both frames rendered the same alert:

  ```text
  Could not connect to AI chat
  Expected never at ["cause"][0]["error"]
  ```

- The DOM contained two `.omnidraw-ai-chat-shell` elements and two matching
  alerts, reproducing the supplied screenshot rather than inferring from it.
- The title bars also rendered duplicated `AI Chat`/`Settings` labels.

The source-run Canvas CLI queried the exact reported Canvas
`d7c1aeaa-f990-45c6-88d5-6b7a7a72f650`. It returned the rectangle and two
persisted `widget-frame` items, including widget
`fe62024d-647b-4a80-b92e-a2b055b89752`, with the canonical extension:

```json
{
  "schemaVersion": 1,
  "type": "ui-widget",
  "kind": "ai-chat",
  "payload": {
    "sessionId": "a1ec3f24-7312-47db-8731-388ddf0bd587"
  }
}
```

Calling the backend agent service directly against the copied database, thereby
bypassing both RPC error mappers, returned the hidden root cause:

```text
CONNECT_ERROR_CODE CHAT_SCOPE_INVALID
CONNECT_ERROR_MESSAGE The AI Chat element is not present on the requested canvas.
```

### 2.2 Verification commands

The following commands were run against the reviewed working tree:

| Command | Result |
|---|---|
| `bun run test:workspace` | Pass: 1,013 tests across the two apps and five public packages |
| `bun run --sequential --filter '*' typecheck` | Pass: all seven workspaces |
| `bun run test:backend:conformance` | Pass: 12 tests |
| `bun run test:db` | Pass: 27 schema, constraint, and recovery tests |
| `bun run test:browser` | Pass: packed browser checks and the live 16-route run |
| `bun run test:architecture` | Pass after package build: 45 tests |

The first direct architecture run failed because an existing Canvas `dist` tree
still contained declarations importing Cangine. `test:browser` rebuilt and
pruned that ignored output, after which the architecture command passed. This
also shows that the root test path relies on generated package state that it
does not itself build first.

The important result is the contradiction: all of the final commands can pass
while the manually exercised product remains broken.

## 3. What the refactor did accomplish

These parts are materially present and should be preserved during correction:

- The top-level workspace resolves to `apps/backend`, `apps/frontend`, and the
  five named public packages.
- `public-package-set.json` records the five versions and exact qualification
  versions.
- PartySocket, repository-owned `ws`, oRPC package dependencies, the custom
  runtime package, and the old public package workspaces are absent from the
  final manifests.
- Canvas Contract owns a strict versioned authored-node model and has useful
  codecs and conformance vectors.
- Theme is scoped and namespaced.
- SDK encapsulates Capsule behind Omnidraw-owned host types.
- The native WebSocket/Effect RPC connection can physically reconnect, advance
  its logical generation, abort an old lease, reject stale use, and execute a
  later Canvas request.
- Canvas item insertion now starts at item revision 1.
- Database schema, constraint, backup, and recovery tests are extensive.
- A backend simulation harness can record and replay its own controlled model.

These successes do not offset the application architecture and live workflow
failures below.

## 4. Severity model

- **P0** — blocks a primary workflow, causes data/UI inconsistency, or makes the
  claimed application architecture false.
- **P1** — a required PRD capability is absent, unsafe, or implemented through a
  parallel legacy mechanism.
- **P2** — enforcement, cleanup, diagnostics, or test evidence is materially
  deficient but not by itself the immediate product blocker.

## 5. P0 product defects

### P0-01 — New widget content is not mounted until reload

This is the direct cause of the durable outline with missing widget content.

`packages/canvas/src/services/CanvasDocumentService.ts:933-940` applies the
Cangine scene reduction before it updates `#authoredNodes`. The scene engine
synchronously notifies subscribers from `#applySceneReduction` at
`CanvasDocumentService.ts:1603-1607`.

`packages/canvas/src/internal/CanvasExtensionBridge.ts:127-131` reconciles
portals only from that scene notification. Its desired portal set is computed
from `document.authoredNodes()` at `CanvasExtensionBridge.ts:248-257`. At the
moment of the callback, the newly created widget is not in that authored map,
so no portal is registered. Updating `#authoredNodes` emits no later portal
reconciliation signal.

The server acknowledgement path repeats the ordering at
`CanvasDocumentService.ts:1461-1464`. In the normal optimistic case it also skips
a second scene reduction because the accepted projection is already equal.

Impact:

- AI Chat and normal widgets both use the same bridge.
- The durable frame and selection decoration can exist while the HTML content
  does not.
- Reload works because the authored map is already populated before initial
  scene notification.
- The defect is deterministic, not a slow-load timing issue.

### P0-02 — Backend rejects every canonical AI Chat node

The public AI Chat extension writes and recognizes:

```text
type: "ui-widget"
kind: "ai-chat"
```

at `packages/component-ai-chat/src/canvas-extension.tsx:33-40,73-79`.

The live backend chat scope instead requires `extension.kind === 'ai'` at
`apps/backend/src/setup-services.ts:578-592`. Preview inspection repeats the
same stale discriminator at `setup-services.ts:451-468`.

Therefore a valid node created by the current public package cannot pass the
current live backend's authorization check. The copied reported database and
direct service call prove this exact mismatch is the source of
`CHAT_SCOPE_INVALID`.

This is a cross-boundary contract drift. A hard-coded application string is
being treated as authority instead of consuming one canonical AI Chat contract
or predicate.

### P0-03 — Frontend RPC declares every server error impossible

The backend's RPC contract declares `error: PrivateRpcError` for request and
stream RPCs at `apps/backend/src/shell/transport/rpc-contract.ts:4-32`.

The frontend independently recreates both RPC definitions at
`apps/frontend/src/services/rpc.ts:11-28`, but omits `error` entirely. In Effect
v4 an omitted RPC error schema is `Schema.Never`; see
`repos/effect/packages/effect/src/unstable/rpc/Rpc.ts:896-947`.

Any legitimate server `Failure` is consequently decoded against `never`. This
directly produces:

```text
Expected never at ["cause"][0]["error"]
```

This defect affects every private RPC failure, not only AI Chat. It is possible
because the client and server wire definitions are duplicated and the actual
domain procedures are hidden behind a string path plus `Schema.Unknown`.

### P0-04 — Backend destroys the useful chat failure before transport

Agent chat failures are plain `Error` objects with an attached `code` at
`apps/backend/src/private/agent/AgentService.ts:892-894`.

The RPC mapper recognizes only `PrivateRpcError`, `CanvasAuthorityError`, and
`ProcedureError`. Every other error becomes generic code
`INTERNAL_SERVER_ERROR`, status 500, generic message, and `details: null` at
`apps/backend/src/shell/transport/layer.rpc-dispatcher.live.ts:72-106`.

As a result, even after repairing the frontend schema, callers would still lose
`CHAT_SCOPE_INVALID`, `CHAT_CANVAS_INVALID`, and `CHAT_CANVAS_CONFLICT` unless
the backend adopts typed domain failures and an exhaustive shell translation.

### P0-05 — Published widget requests contain JSON-invalid `undefined`

`apps/frontend/src/feature/canvas-extension/index.ts:54-108` always creates an
own `titleBarColor` property. For a published widget the value is `undefined` at
line 76.

The node is optimistically committed and selected at lines 244-245. Effect RPC
then encodes the `Schema.Unknown` payload through `Schema.toCodecJson`; see
`repos/effect/packages/effect/src/unstable/rpc/RpcClient.ts:795-798`. Nested
`undefined` is not JSON and fails with `Expected JSON value`.

A direct codec probe against the pinned Effect version reproduced that failure.
This independently explains generic widget placement producing a transient or
blank outline without a durable usable widget. Optional fields must be omitted,
not emitted with `undefined`, and the boundary requires a typed JSON-safe codec
rather than `unknown`.

### P0-06 — Sidebar widget drag/drop is no longer a drag operation

`apps/frontend/src/feature/canvas-extension/index.ts:234-247` now:

1. calls `onDragStart` on `pointerdown`;
2. creates a node immediately;
3. uses raw `event.clientX/clientY` as Canvas world coordinates;
4. commits and selects immediately;
5. calls `onDragEnd` in the same stack.

It has no primary-button check, movement threshold, pointer capture,
`pointermove`, `pointerup`, `pointercancel`, Escape cancellation, transient
ghost, Canvas hit test, client-to-viewport-to-world conversion, pan/zoom
handling, or visible-world clamping.

The pure threshold and clamp helpers remain in
`apps/frontend/src/feature/widget-placement/fn.pointer-placement.ts`, but
production code never calls them. Their isolated tests therefore prove unused
functions, not placement behavior.

`addToCanvas` claims that an absent position defaults to viewport center in
`WidgetPlacementCoordinator.ts:13-19`, but the implementation hard-codes world
position `{x: 80, y: 80}` at `canvas-extension/index.ts:249-258`.

The public Canvas extension context at `packages/canvas/src/extension.ts:112-118`
also lacks a renderer-neutral external-placement/camera projection capability.
The frontend therefore has no supported public seam through which to implement
correct sidebar placement.

## 6. P0 application architecture failures

### P0-07 — Backend source topology is mostly a legacy relocation

The required backend layout is:

```text
apps/backend/src/
  core/
  shell/
  sim/
  conformance/
  index.ts       # named facade only
```

The current top-level implementation also includes:

```text
private/
services/
plugins/
widget-prerequisites/
build-config.ts
config.ts
fn.home-preflight-error.ts
fn.local-registry-npm-userconfig.ts
main-app.ts
main.ts
parse-argv.ts
setup-services.ts
setup-signals.ts
```

Only a minimal executable shim is a plausible exception. Configuration,
composition, CLI, signals, helpers, authorities, and adapters are not.

Current TypeScript inventory:

| Backend path | TS files | TS LOC | Assessment |
|---|---:|---:|---|
| `core/` | 9 | 366 | Canvas and canonical JSON only |
| `shell/` | 10 | 607 | Thin wrappers; additionally owns 208 SQL files |
| `sim/` | 14 | 2,010 | Separate simulation model |
| `conformance/` | 4 | 312 | Canvas-only suite and source scan |
| `private/` | 504 | 72,074 | Forbidden catch-all containing most product code |
| `services/` | 38 | 11,803 | Forbidden mixed service bucket |
| `plugins/` | 20 | 2,062 | Forbidden plugin topology |
| `widget-prerequisites/` | 4 | 147 | Additional unowned top-level bucket |

The `private` tree reproduces retired package boundaries such as agent, API,
database, widget domain/runtime/state, resources, functions, events, and Canvas
authority. It also contains six nested pseudo-core trees. This is relocation,
not the semantic/shell split required by the architecture.

The required named-export `apps/backend/src/index.ts` facade is absent.

### P0-08 — Frontend architecture was not implemented

`apps/frontend/src` has zero `core`, `shell`, `sim`, or `conformance` folders.
Instead it contains:

```text
components/
feature/
inspection/
pages/
services/
styles/
types/
utils/
```

plus substantial root implementation files such as `App.tsx`,
`ai-chat-adapters.ts`, `startup-canvas.ts`, and `store.ts`. `services/` alone has
21 files.

Reasonable exceptions are a tiny browser entrypoint and imported styles. Eight
parallel implementation buckets and root-owned application logic are not minor
exceptions.

Only one frontend source file imports Effect. There is one transport-specific
`Context.Service`, no domain semantic service graph, no application Layer
composition, no simulated Layers, and no frontend conformance suite. A scan of
non-test frontend source finds 104 `async` occurrences, so this is not a mostly
pure frontend with one small browser adapter.

### P0-09 — Backend Effect runtime wraps a second service locator and lifecycle

`apps/backend/src/shell/runtime/service-registry.ts:13-35` is a string-keyed
`Map` service locator with runtime `provide`, `get`, and `require`.

`apps/backend/src/setup-services.ts:148-639` manually constructs the application
with `new`, mutation, nullable closures, and ordered registration. Circular
construction is hidden by mutable `widgetBuildGeneration` and `resourceService`
variables at lines 347-379.

`apps/backend/src/shell/runtime/layer.application.ts:27-62` then loops through
that registry and imperatively calls arbitrary Promise-based `start` and `stop`
methods. The ManagedRuntime owns a wrapper around a second lifecycle owner
rather than one resolved Layer graph.

The RPC dispatcher performs sixteen `application.services.require(...)`
lookups at `layer.rpc-dispatcher.live.ts:184-206`. Every non-Canvas request is
the old Promise handler wrapped in `Effect.tryPromise` at lines 227-233.

This is the exact service-locator/two-lifecycle anti-pattern prohibited by
`llm.app-architecture.md:564-576,735-749`. Requirements are hidden rather than
visible in `Effect<A, E, R>`, and live/sim substitution is impossible at domain
service granularity.

### P0-10 — Live and simulated Canvas do not run the same authority program

Production Canvas adapts the old
`apps/backend/src/private/canvas-authority/CanvasService` at
`apps/backend/src/shell/canvas/layer.canvas-authority.live.ts:1-63`.

The nominal core `fnReduceCanvasCommand` is referenced only by
`apps/backend/src/sim/canvas/layer.canvas-authority.sim.ts`. Production never
executes it. The live service has a separate large state machine and command
implementation.

The dispatcher also has two production Canvas paths:

- four special-cased routes use the new core `CanvasAuthority`;
- legacy private handlers still call the old Canvas context directly.

The live and simulated systems therefore do not exercise one business program
with different Layers. Passing the current shared scenario does not establish
the architecture's central claim.

## 7. P1 backend architecture and transport findings

### P1-01 — Most `fn`/`fx`/`tx` code retains the retired portal model

The architecture requires pure `fn` functions and non-async `fx`/`tx` functions
that take zero arguments or one `args` object and return an explicit lazy
`Effect.Effect<A, E, R>`.

Current production backend source contains:

- 57 exported `fx`/`tx` declarations in the old eager/Promise form;
- 52 production files containing `portal` dependencies.

Representative violations include:

- `widget-prerequisites/fx.probe-widget-npm.ts`
- `widget-prerequisites/tx.check-widget-prerequisites.ts`
- `private/database/DbServiceTurso/fx.canvas.ts`
- `private/database/DbServiceTurso/tx.canvas.ts`
- `private/agent/workspace/tx.chat-storage.ts`
- `private/agent/widget-filesystem/publication/tx.publication.ts`
- `services/tx.terminate-widget-build-process-tree.ts`

Some `fn` files also own timers or process output, so filename prefixes are not
reliable boundaries.

### P1-02 — Live world handles silently default inside domain objects

The architecture makes omission of world handles a compile error. Current
constructors silently fall back to live globals:

- `BunChildSandboxDriver.ts:243-275` defaults `Bun.spawn`, executable, temp
  root, wall time, UUIDs, resource probes, and process mechanics.
- `SecretStoreKeyProvider.ts:63-74` defaults to Node entropy.
- `WidgetStateService.ts:78-115` defaults to `Date.now`.
- `WidgetBuildGenerationService.ts:150-171` opens the real filesystem, defaults
  to real time, and starts a real interval.
- `AgentService` owns Promise lanes, timers, entropy, and mutable maps directly.
- Preview inspection owns Promise races and host timers directly.

These are exactly the choices that simulation must replace. Because they are
not core semantic services, controlled Layers cannot supply them.

### P1-03 — Simulation is a parallel model, not a shell for production services

`apps/backend/src/sim/service.simulation-capabilities.ts` declares simulation-
only capabilities such as `SimulationStorage`, `SimulationNetwork`, and
`SimulationProcesses`. Live code does not implement those contracts, and live
core programs do not require them.

The simulated store is an independent `Map` transaction model. It does not use
the production Turso engine, migration, SQL, row codecs, or domain storage
services. Widget publication/load and cancellable-commit scenarios are synthetic
state transformations; they do not execute the actual build generation,
publication, runtime admission, FunctionService, or ResourceService programs.

The no-host-world gate scans only files already under `sim`. It cannot find
world access in the production code that simulation is supposed to exercise,
because that code remains under `private` and `services`.

The seeded scheduler's default auto-flush also drains after each schedule call,
which limits peer accumulation and schedule exploration. The required
fork/yield/callback/virtual-time/interruption/finalizer/runtime-isolation
qualification matrix is absent.

### P1-04 — Conformance covers only a narrow Canvas scenario

The four conformance files cover one Canvas insert/duplicate/replay/resync/query
path plus the simulation source scan.

The “live” suite uses a custom in-memory store, not the production Turso
adapter. It does not cover typed failures, interruption, rollback,
commit-then-lost-ack, subscriber overflow, concurrent command races, or
resource disposal.

There is no shared live/sim conformance for:

- agent/chat;
- widget publication, build, and load;
- widget state;
- resources;
- functions and process cancellation;
- event delivery;
- catalog recovery;
- preview inspection;
- database semantics.

Implementation-specific conformance entrypoints are also placed inside
`conformance`, whereas the architecture requires them beside the shell and sim
adapters.

### P1-05 — Database ownership is inverted

The 208 extracted statement files are under `shell/database/stmts`, but the
engine, migration, row codecs, stores, schema contract, verification, and
statement registry remain under `private/database`.

`private/database/statement-registry.ts` imports upward into the shell SQL
folder. `DbServiceTurso` exposes a broad mutable subservice surface and invokes
the old two-argument `fx`/`tx` functions.

The required ownership is the reverse: semantic persistence capabilities and
failures in core; Turso, migrations, SQL, registry, row decoding, backup, and
recovery together under `shell/database`; a controlled implementation of the
same semantic services under `sim`.

This structural correction does not require changing the resolved DDL.

### P1-06 — Effect RPC is an untyped envelope around a second router

Both RPCs carry only `path: String`, `input: Unknown`, and `success: Unknown`.
All domain typing is outside Effect RPC.

`apps/backend/src/private/api/procedure.ts` implements a second custom
procedure/router framework. Its `procedureType()` marker performs no runtime
validation: `parseWithSchema` returns marked values unchanged at lines 256-257
and 284-300. Agent connect, history, and edit use these unchecked output markers
at `private/api/agent/contract.ts:153-173`.

The frontend then builds an arbitrary nested Proxy and casts it to whatever API
shape the caller requests at
`apps/frontend/src/services/frontend-api.ts:62-84`.

This arrangement permits the exact contract drift seen in P0-03. It is not a
typed Effect RPC replacement; it is the previous path-dispatched model behind a
new transport envelope.

Additional status mapping errors exist: `ProcedureError` has no mappings for
`ALREADY_EXISTS` or `TOO_MANY_REQUESTS`, although handlers throw both. They fall
back to status 500.

### P1-07 — Stream semantics do not meet the PRD

- RPC declares top-level `afterCursor`, but the dispatcher never consumes it.
- `agent.events` subscribes with no cursor.
- EventBus replay/cursors exist only in process memory.
- Each EventBus subscriber has an unbounded pending array.
- The Effect RPC bridge forks the producer, always ends the queue in a finalizer,
  and does not join/propagate the producer failure. A terminal failure can look
  like clean stream completion.
- The queue has no explicit capacity or backpressure policy.
- Catalog streaming retains a custom Promise wake queue.

These fail the PRD's explicit cursor recovery, backpressure, terminal-error,
ordering, and process-restart requirements.

### P1-08 — Shell and root still depend on forbidden plugin/private layers

- `shell/server/layer.server.ts` imports `plugins/server/http`.
- That plugin owns file mutation validation, ID generation, hashing, and direct
  database writes.
- Root `main-app.ts` imports plugin CLI, private database, private filesystem
  mutation, and portal prerequisite code.
- Root `main.ts` dispatches a private Bun function worker.
- The private backend manifest exports every source subpath (`"./*": "./src/*"`).
- 117 source files self-import `@omnidraw/backend/private...`, disguising local
  implementation coupling as a package boundary.

CLI and server edges belong under `shell`; domain decisions belong in core.
There should be no `plugins` folder or broad private self-package API.

## 8. P1 frontend architecture and behavior findings

### P1-09 — Frontend has no semantic core

The only Effect service is the concrete RPC client. Feature code instead uses
raw procedure strings, a Proxy-cast API tree, broad `Record<string, unknown>`
inputs, and application-global coordinators.

`apps/frontend/src/ai-chat-adapters.ts` mixes AI DTO mapping, native fetch,
files, browser globals, Canvas images, theme access, sidebar creation,
navigation, catalog invalidation, and RPC. Resource and DB screens import shared
invalidation state from this AI file, coupling unrelated domains.

Frontend `fx.db-resource.ts` and `tx.db-resource.ts` preserve the forbidden
`(portal, args) -> Promise` shape. Startup and toast files repeat the same
portal-era naming without lazy Effect programs or semantic services.

### P1-10 — Frontend runtime/state are module-global and not disposed

`apps/frontend/src/services/rpc.ts:362` constructs one module-global
`FrontendRpcConnection` and hidden `ManagedRuntime`. Its `dispose()` is never
called.

Other module-global owners include:

- the Solid store and browser storage;
- `ThemeService` and an ignored subscription disposer;
- catalog invalidation and placement coordinators;
- Canvas host retirement coordinator;
- Preview inspection state.

The tested `retireAll()` path is not called by production. Two frontend
instances cannot coexist independently, and HMR/navigation can leak sockets,
subscriptions, listeners, or state. This violates per-instance runtime
ownership and the explicit ban on module-level ManagedRuntime state.

### P1-11 — Frontend is not simulation-ready

The live RPC implementation hardwires `globalThis.location` and the global
WebSocket constructor at `services/rpc.ts:143-169`. Other production paths read
or call `localStorage`, `fetch`, `crypto.randomUUID`, `crypto.subtle`, `Date`,
real timers, `window`, `document`, `navigator`, `ResizeObserver`, and
`FileReader` directly.

There is no frontend `sim` runtime or Layer set for scripted RPC, HTTP/media,
in-memory browser storage, seeded IDs, controlled clock, navigation,
notifications, clipboard, or DOM-independent sinks. There are no shared
frontend conformance scenarios.

Frontend DST need not explore distributed schedules yet. Simulation readiness
still requires the same core programs to run against live shell Layers and
controlled sim Layers. That foundation is absent.

### P1-12 — Complex frontend lifecycles mostly bypass Effect

Only `services/rpc.ts` imports Effect, while 104 production `async` occurrences
remain. Examples include:

- manual Promise/iterator cancellation in Canvas transport;
- Promise-tail Canvas host retirement;
- manual stream/timer state in WidgetCatalogProvider;
- large DB and resource components owning polling, mutations, stale counters,
  secret expiry, and browser listeners;
- widget runtime mount/reload/dispose orchestration;
- application Canvas extension state.

These are precisely the concurrency, cancellation, streaming, and resource
lifetime cases for which the PRD selected Effect.

### P1-13 — More JSON-invalid request shapes remain

The published widget bug is not isolated:

- `apps/frontend/src/ai-chat-adapters.ts:190-208` copies optional `widgetRefs`,
  `model`, and `thinkingLevel` into prompt/edit input even when absent.
- `apps/frontend/src/feature/db-resource/fx.db-resource.ts:33-39` sends optional
  `cursor` and `columns` as `undefined`.

Normal prompt/edit and initial DB table requests will fail JSON encoding once
the earlier connect error is repaired. Existing tests use direct mocks and do
not run the real wire codec. The resource-data helper already uses conditional
spreads correctly; that pattern was not applied consistently.

### P1-14 — Frontend expects the wrong error envelope

Once P0-03 is fixed, Effect will expose `PrivateRpcError` fields at the top
level: `code`, `status`, and `details`.

Frontend feature types instead require `error.data.code` in:

- `feature/sidebar/ports.ts:10-12`;
- `feature/db-resource/types.ts:1-3`;
- `feature/db-resource/fn.db-resource.ts:103-108`.

Tests fabricate the old `{data: {code}}` shape, so they cannot detect the real
transport mismatch. DB mutation approval and conflict handling will not
recognize backend codes.

AI error mapping loses still more information: `ai-chat-adapters.ts:61-78`
classifies an error only by whether its message contains “connect”, maps all
other cases to `unknown`, and marks every failure retriable.

### P1-15 — Semantic reconnect is incomplete

- Agent event cursor state is permanently `null`; the requested session scope is
  not used by the stream.
- Agent reconnect recovery only calls `getHistory`.
- If `afterReconnect` fails, it is outside the retry loop at
  `services/rpc.ts:342-351` and permanently ends the iterable.
- Catalog stream errors are swallowed at
  `WidgetCatalogProvider.tsx:80-94`, leaving a dead subscription.
- There is no database event recovery adapter.
- Canvas resubscription does not expose an explicit snapshot-before-ready state
  at the frontend domain boundary.
- The sidebar receives an idempotency-key creator that no mutation consumes.
  Proxy-dispatched resource calls cannot pass request options.

The current browser gate proves one physical WebSocket reconnect and a later
Canvas unary request. It does not prove semantic recovery for all domains.

### P1-16 — Backend process restart cannot recover mounted chat

Backend chat sessions are process-memory entries. `AgentService.getChatHistory`
requires an installed live session at `AgentService.ts:344-350`.

The component's connect effect reacts to local session/connect intent, not RPC
generation, at `component-ai-chat/src/chat/components/index.tsx:122-148`.
Frontend stream recovery calls history but does not reconnect the session at
`ai-chat-adapters.ts:271-285`.

Closing and reopening a socket against the same process works differently from
restarting the backend. The current acceptance only tests the former. A real
backend restart can leave a mounted chat permanently unable to restore history
or events.

### P1-17 — New Chat and preferences are not durably persisted

`component-ai-chat/src/chat/components/index.tsx:380-397` changes `sessionId`
only in component-local state, clears local messages, and retires the previous
backend session. It never patches the Canvas node payload.

On reload, the extension reads the original persisted session ID and resurrects
the prior chat. The frontend also supplies neither `preference` nor
`onPreferenceChange` when creating the AI Chat extension at
`apps/frontend/src/ai-chat-adapters.ts:323-335`, so model and thinking choices
are lost on remount.

Generated session IDs are plain UUIDs. The backend classifies non-dated IDs as
`legacy` and stores them under a legacy chat path, contrary to the clean-cut
direction.

### P1-18 — Startup and browser state contain stale-response risks

`services/canvas-bootstrap.ts:21-38` hard-codes `isCurrent = () => true`, bypasses
the tested deduplicating bootstrap factory, and uses mutable module-global host
state. An older response can update a newer app host.

`App.tsx:26-35` suppresses bootstrap failure without a retry supervisor or
visible persistent error state.

`store.ts:21-47` reads localStorage at module load, shallow-merges unvalidated
JSON, and persists the backend-authoritative Canvas list. Stale or malformed
browser data can render obsolete Canvas identities before server reconciliation.

### P1-19 — UI equivalence is not preserved

The screenshot's duplicate/overlapping title text has a direct source:

- the authored AI node persists a `Settings` header item at
  `component-ai-chat/src/canvas-extension.tsx:67-72`;
- the mounted component publishes a second `Settings` titlebar action at lines
  111-118.

Other visible regressions include blank frames, missing content until reload,
incorrect catalog placement under pan/zoom, and error alerts that expose a wire
decoder implementation message. These are not visually equivalent to the
screen atlas.

Widget runtime mount rejection also leaves the authored frame in place without
a stable frame-local error or rollback. Concurrent reload actions are not
serialized and can overwrite or leak earlier mounts.

## 9. P1 public package implementation findings

### P1-20 — Canvas uses Effect as a Promise wrapper, not its orchestration model

`packages/canvas/src/internal/CanvasEffectRuntime.ts` creates an empty
ManagedRuntime and accepts callbacks of shape `(AbortSignal) => Promise<T>`.
It wraps them with `Effect.promise`; it does not express the Canvas state machine
as Effect programs and services.

`CanvasRuntimeLifecycle.ts` still owns a Promise queue, generation counters,
manual state, and async shutdown. `CanvasDocumentService.ts` is roughly 2,400
lines and owns Promise tails, retry loops, media tasks, manual recovery,
AbortControllers, and mutable maps. `runtime.ts` remains another large async
imperative owner.

The package has the required dependency and an instance runtime, but the
complexity was not migrated to Effect. The mount-order P0 is one direct result
of retaining parallel mutable state and synchronous callback ordering.

### P1-21 — AI Chat also has incomplete Effect ownership

`packages/component-ai-chat/src/internal/stream-lifecycle.ts` wraps one stream
in Effect but calls global `Effect.runFork`. The rest of the component owns
manual async request IDs, polling, Promise actions, cancellation flags, and
lifecycle state directly in Solid components.

There is no per-component scoped ManagedRuntime or Layer-owned lifetime. The
package meets the manifest requirement but not the intended resource/lifecycle
ownership.

## 10. P2 enforcement, testing, and cleanup findings

### P2-01 — Architecture enforcement is a false-green gate

`scripts/architecture-boundaries.test.ts:369-411`:

- checks only that backend `core`, `shell`, `sim`, and `conformance` exist;
- never rejects extra backend top-level folders or root implementations;
- scans `fx`/`tx` shape only inside `core`;
- never scans frontend topology or program shape;
- does not enforce semantic service coverage, one Layer graph, required world
  handles, direct-run edges, or live/sim conformance registration;
- scans host-world tokens only inside `sim`, not the production programs the
  sim claims to execute.

This gate passes despite more than 85,000 lines under forbidden backend folders
and no frontend architecture at all.

### P2-02 — Browser acceptance checks persistence, not usability

`tests/browser/live-app.acceptance.ts:536-593` draws the Canvas-owned AI Chat
tool and waits only for a persisted `widget-frame`, size, minimum size, and item
revision. It never asserts:

- a registered portal;
- `.omnidraw-ai-chat-shell` before reload;
- successful `agent.chat.connect`;
- absence of a chat alert;
- one prompt/event round trip;
- New Chat persistence;
- backend process restart recovery.

The passing run's captured traffic includes `agent.chat.connect`, but the test
does not inspect its failed result. A handled WebSocket RPC failure is neither a
page error nor an HTTP response with status 400+, so the final generic error
gate misses it. The test navigates away immediately after checking persistence.

Resources and reconnect are also exercised through direct imports of
`/src/services/rpc.ts` and raw RPC calls rather than their user controls. Route
coverage checks one visible string rather than workflow usability.

No live browser test places a catalog widget. The broken sidebar pointer path is
never executed.

### P2-03 — Unit tests encode mocks and orphaned helpers instead of integration

- Agent tests inject `chatScope.validate: async () => true`, bypassing the live
  `ai`/`ai-chat` mismatch.
- One production composition test constructs the stale `kind: 'ai'`, thereby
  enshrining the wrong contract.
- CanvasExtensionBridge tests begin with an authored widget already present or
  update authored state before firing scene listeners, reversing the live
  callback order.
- Placement tests cover the orphaned threshold/clamp helpers and coordinator
  forwarding, not the production pointer session.
- RPC generation tests cover counters, not a typed client/server failure round
  trip.
- DB error tests fabricate `{data: {code}}` instead of running a real Effect RPC
  error.

### P2-04 — Root verification ordering is stateful

`bun run test:architecture` initially failed against stale ignored Canvas
declarations. `bun run test:browser` rebuilt the package, after which the same
architecture command passed.

The root `test` command runs workspace tests before architecture, but it does
not build public packages first. A gate that inspects generated `dist` must
either build its own exact inputs or inspect source/staged output created in the
same command. Its result must not depend on what a developer ran previously.

Frontend's package-local `test` script also omits typecheck and production
build; those pass only when called separately.

### P2-05 — Dead and misleading residue remains

- `apps/backend/src/private/kv/KvService.ts` is an empty lifecycle service that
  only logs start/stop.
- `apps/backend/src/private/kv/types.ts` is effectively empty.
- An empty `apps/backend/src/plugins/orpc` directory remains.
- Plugin, private, service, and nested core names preserve the retired mental
  model.
- `App.tsx` installs an anonymous global wheel listener and never removes it.
- `theme.ts` ignores the disposer returned by its global theme subscription.
- Canvas diagnostic composition records Cangine `0.6.0` while the exact
  dependency is `0.6.1`.

## 11. Database decision conflict

There is a specification conflict that the final implementation and docs must
resolve explicitly:

- The original implementation brief requested the same database schema.
- The current PRD, architecture guide, and repository guide require a new
  clean-install schema and explicitly forbid opening or interpreting the
  pre-refactor database.

The current implementation preserves the prior 14-table/18-index fingerprint
and successfully opened the copied existing user home, including its Canvas and
chat nodes. There is no explicit replacement boundary between that retained
format and the redesigned application. This behavior aligns with “same schema”
but fails the checked-in PRD's clean-cut acceptance criteria.

Under the current repository authorities, this is a PRD failure: the backend
does open and interpret the old home. If schema preservation is the intended
fixed decision, `docs/PRD.md`, `AGENTS.md`, and the architecture persistence
section must be corrected together; the repository must not claim both
incompatible policies.

This conflict is separate from database ownership. The existing DDL can remain
byte-for-byte unchanged while its implementation is correctly moved into
`shell/database` and exposed through core semantic services.

## 12. Acceptance-criteria assessment

| PRD area | Status | Evidence |
|---|---|---|
| Two apps / five public packages | Partial pass | Outer workspace is correct; application internals are not |
| No retired application/package dependency | Mostly pass | Final manifests are narrowed; legacy implementation structure was relocated into apps |
| Public Canvas Contract | Pass with integration gaps | Strict contract tests pass; application discriminants and JSON projection drift from it |
| Theme | Pass | Scoped, namespaced, package tests pass |
| SDK portability boundary | Mostly pass | Capsule types are encapsulated; live generic widget placement/hosting is broken |
| Canvas public boundary | Partial | Public entrypoints are narrowed after build; internal async ownership and live portal behavior fail |
| AI Chat public component | Fail in product | Component packages/tests pass, but live connect, persistence, restart, and titlebar behavior fail |
| Backend `core/shell/sim/conformance` | Fail | Most code is under forbidden `private/services/plugins`; live and sim use different programs |
| Frontend `core/shell/sim/conformance` | Fail | All four folders and all simulation/conformance capabilities are absent |
| One Effect lifecycle owner | Fail | Effect runtime wraps a string registry/manual Promise lifecycle; frontend/package globals leak |
| Typed Effect RPC | Fail | String path + Unknown envelope + custom router; client/server error schemas differ |
| Native WebSocket physical reconnect | Narrow pass | Generation 1→2 and later Canvas request work |
| Semantic recovery | Fail | Cursors, restart recovery, terminal errors, catalog recovery, and domain readiness incomplete |
| Canvas optimistic authority behavior | Fail | Durable frame and portal projection diverge until reload |
| Widget drag/drop | Fail | Immediate raw-coordinate pointerdown commit |
| Product/UI equivalence | Fail | Blank frames, duplicate Settings, decoder error in UI, broken chat |
| Live/sim conformance | Fail | Only narrow Canvas model; publication/function/resource scenarios are synthetic |
| Database correctness tests | Pass | 27 focused checks pass |
| Database replacement policy | Fail/contradictory | Old copied home opens successfully despite current PRD forbidding it |
| Packed packages | Pass after rebuild | Packed browser gate and package tests pass |
| Browser workflow acceptance | Fail despite green script | Gate omits portal, chat success/prompt, catalog drag, and backend restart |

## 13. Required application target

### 13.1 Backend

Apart from a tiny executable/facade entry, backend source should contain only:

```text
apps/backend/src/
  core/
    canvas/
    agent/
    resources/
    functions/
    widgets/
    widget-state/
    events/
    preview/
  shell/
    database/
      migrations/
      stmts/
    transport/
    server/
    cli/
    agent/
    resources/
    functions/
    widgets/
    preview/
    runtime/
  sim/
    canvas/
    agent/
    resources/
    functions/
    widgets/
    widget-state/
    events/
    runtime.ts
    clock.ts
    scheduler.ts
    faults.ts
  conformance/
    canvas.suite.ts
    agent.suite.ts
    resources.suite.ts
    functions.suite.ts
    widgets.suite.ts
    widget-state.suite.ts
    events.suite.ts
  index.ts
```

This must be a semantic migration, not another folder rename:

- Core owns domain values, typed errors, `Context.Service` contracts, pure
  policy, and lazy programs.
- Shell owns Turso, SQL, HTTP/RPC/WebSocket, Pi, filesystem, processes,
  Playwright, browser/server/CLI edges, and one fully resolved Layer graph.
- Sim implements the same core services with controlled world handles.
- Conformance executes unchanged scenarios against live and simulated Layers.
- `private`, `services`, `plugins`, and `widget-prerequisites` do not survive.
- No service registry or broad application context hides requirements.

### 13.2 Frontend

Apart from a tiny browser entry and imported style assets, frontend source
should contain only:

```text
apps/frontend/src/
  core/
    app/
    canvas/
    chat/
    widgets/
    resources/
    navigation/
    notifications/
  shell/
    framework/
    transport/
    browser/
    canvas/
    chat/
    widgets/
    resources/
    inspection/
    runtime/
  sim/
    transport/
    browser/
    storage/
    navigation/
    notifications/
    runtime.ts
  conformance/
    rpc.suite.ts
    startup.suite.ts
    reconnect.suite.ts
    widget-placement.suite.ts
    chat.suite.ts
    resources.suite.ts
  index.ts
```

The Solid components belong under `shell/framework`, because replacing Solid
would replace them. Pure view-model transitions and domain policy belong in
core. Browser APIs belong behind shell capabilities. The simulated frontend
supplies scripted RPC/HTTP, in-memory storage, seeded IDs, controlled Clock,
navigation, clipboard/media, and recorded notification sinks.

No frontend distributed schedule explorer is required now. The frontend must
still be able to run the same lazy programs with controlled Layers and an
isolated simulated runtime.

## 14. Required remediation order

1. **Stop qualification/release claims.** The current green gates do not
   represent a usable product.
2. **Repair the live workflow contract chain.** Canonicalize AI Chat identity,
   share/derive one RPC error contract, preserve typed failures, omit absent
   JSON fields, and fix Canvas authored/scene notification ordering.
3. **Restore real widget placement.** Add a renderer-neutral Canvas placement
   seam and implement the full pointer state machine with pan/zoom conversion,
   threshold, preview, bounds, and cancellation.
4. **Create the final application topology and structural gates first.** Reject
   every extra `src` directory and root implementation exception not explicitly
   allowlisted.
5. **Migrate one vertical domain at a time.** Define core services/programs,
   live shell Layers, sim Layers, and shared conformance before deleting the old
   domain implementation. Canvas must be first because live/sim currently
   disagree.
6. **Delete the service locator/manual lifecycle.** Compose one resolved Layer
   graph and one disposable ManagedRuntime per app instance.
7. **Replace the Unknown path envelope with actual typed RPC definitions.** If a
   small private envelope remains, it still needs one canonical shared wire
   schema, strict per-path codecs, exhaustive errors, bounded stream semantics,
   and generated/derived client types—not independent declarations or Proxy
   casts.
8. **Make frontend simulation-ready.** Extract browser/world handles and run
   shared frontend conformance against live and simulated Layers.
9. **Move all database mechanics together under shell.** Preserve or replace
   DDL according to one documented decision, not both.
10. **Replace false-green acceptance.** Browser tests must prove usable content
    and action results, not only persistence, routes, or transport traffic.

## 15. Required regression and conformance matrix

The corrected implementation is not complete until the following evidence is
active in the default gates.

### Canvas and widgets

- Commit a widget through a real `CanvasDocumentService` plus
  `CanvasExtensionBridge`; assert its portal and content exist before reload.
- Repeat for AI Chat, preview widget, and published widget.
- Assert authored state, projected scene, portal state, and accepted revision
  change coherently in real callback order.
- Place a catalog widget through real pointer events under pan and zoom.
- Cover below-threshold movement, pointer cancel, Escape, non-primary button,
  off-canvas drop, visible-world clamping, cleanup, and Add-to-Canvas center.
- Run real JSON codecs over every command/request vector and forbid nested
  `undefined`, sparse arrays, non-finite numbers, and non-JSON objects.

### AI Chat

- Build a canonical `kind: "ai-chat"` node, persist it, and connect through the
  live backend composition.
- Assert a typed successful `agent.chat.connect` and one prompt/event/history
  round trip in the browser.
- Assert every typed agent failure round-trips through server and frontend
  without generic 500 or decoder failure.
- Restart the backend process while a chat is mounted; reconnect, recover
  history/cursor, and resume without reloading the page.
- Persist New Chat's new session ID in the Canvas node and prove reload does not
  resurrect the retired session.
- Persist model/thinking preferences and prove remount/reload behavior.
- Assert one title and one Settings action.

### Transport and runtime

- Define one canonical client/server RPC contract and compile both sides from
  it or enforce exact structural equality.
- Test failures, validation defects, terminal stream failures, bounded
  backpressure, cancellation, cursors, duplicate delivery, and stale
  generations.
- Restart the physical backend, not only the socket, for every resumable domain.
- Prove two app runtimes with different Layers coexist, isolate state, and
  dispose all sockets, fibers, listeners, timers, and public-package instances.
- Prove non-idempotent operations fail visibly and are not replayed; prove
  idempotent mutations deduplicate commit-then-lost-ack across restart.

### Backend architecture

- Structural test permits only `core`, `shell`, `sim`, `conformance`, and named
  tiny entry exceptions under `apps/backend/src`.
- Every domain program exposes its requirements in `R` and has typed expected
  failures.
- Every live/sim service pair runs the same conformance suite.
- Publication/load and function/resource cancellation scenarios execute the
  actual production core programs, not synthetic substitute models.
- Sim storage runs the same engine/migrations/SQL/row codecs where database
  fidelity is claimed.
- Scheduler qualification covers peer choice, fork, yield, callback, virtual
  time, interruption, finalization, runtime isolation, and replay.

### Frontend architecture

- Structural test permits only `core`, `shell`, `sim`, `conformance`, and tiny
  entry/style exceptions under `apps/frontend/src`.
- Pure transition tests live in core; shell adapter tests own browser mechanics.
- Live and simulated Layers pass the same startup, placement, chat, resource,
  reconnect, and notification scenarios.
- Sim tests control IDs, time, storage, RPC outcomes, navigation, and sinks.
- No module-global ManagedRuntime or mutable app singleton survives.

### Product acceptance

- Browser tests use the visible controls for Canvas, widgets, AI Chat,
  resources, and Preview rather than raw RPC shortcuts for the asserted
  workflow.
- Every route assertion includes one meaningful action and result, not only a
  visible heading.
- Browser tests fail on visible error alerts in addition to console, page, and
  HTTP errors.
- Visual comparison covers widget portal presence, titlebar composition,
  maximization, settings, resource workbenches, and Preview states against the
  screen atlas.
- Root test/build commands construct their own staged inputs and pass from a
  clean checkout with no prior `dist` state.

## 16. Final conclusion

The current tree demonstrates useful package extraction, schema testing, and a
working native WebSocket reconnection primitive. It does **not** demonstrate the
requested application architecture, lower complexity, live/sim equivalence, or
preserved product behavior.

The reported screenshot is explained by concrete and reproducible defects, not
an environment issue:

```text
Canvas updates scene before authored-node state
  -> extension bridge misses the new portal
  -> durable frame/outline exists without content until reload

reload mounts canonical kind "ai-chat"
  -> backend still requires stale kind "ai"
  -> AgentService raises CHAT_SCOPE_INVALID
  -> dispatcher erases it to generic 500
  -> frontend decodes the typed failure against never
  -> UI shows Expected never at ["cause"][0]["error"]
```

The refactor should be considered incomplete until the extra application
folders and parallel legacy runtime are removed, both apps have real
core/shell/sim/conformance boundaries, live and simulated systems run the same
programs, and the default browser gate proves the workflows a user can actually
see and use.

## 17. Corrective implementation verification

Date: 2026-08-13  
Scope: the implementation performed after this review  
Method: source inspection, strict repository gates, shared live/sim
conformance, source-run Playwright against an isolated home, native WebSocket
frame capture, a real backend process restart, and a bounded local
OpenAI-compatible provider. An independent fresh-home run in the Codex in-app
browser then repeated Canvas startup, AI Chat placement, durable reload, and
browser error inspection against the source dev stack.

This section does not replace the findings above. It records how the corrective
implementation closed the reproduced findings and which evidence prevents the
same false-green states from returning.
`Closed` means the original defect has a product fix plus an active regression
gate. `Partial` would mean the implementation materially improved but still
fell short of the requirement stated in this review. The final disposition
below is 36 `Closed`, 0 `Partial`, and 0 pending.

### 17.1 Verification snapshot

- `apps/backend/src` now contains only `core`, `shell`, `sim`,
  `conformance`, `index.ts`, and the tiny `main.ts` executable entry.
- `apps/frontend/src` now contains only `core`, `shell`, `sim`,
  `conformance`, `index.tsx`, and `index.css`.
- Production no longer contains `private`, `services`, `plugins`,
  `setupServices`, or a string service registry. The backend runtime resolves
  one scoped Layer graph; the frontend owns one disposable runtime per app
  instance.
- Backend shared conformance now covers agent, Canvas, events, functions,
  resources, widget state, and widgets. Frontend shared conformance covers RPC,
  startup, reconnect, placement, chat, and resources.
- Live and simulated Canvas execute the same core operation/precondition
  reducer. Live conformance uses the production Turso store, SQL, and row
  codecs; simulation supplies only the controlled authority mechanics.
- The private frontend API is operation-indexed across the exact 87 request and
  6 stream paths. Compile-time coverage and bidirectional codec tests prevent a
  feature from overriding a path's input, output, or typed failure.
- Canvas and AI Chat now keep asynchronous state machines inside their
  instance-owned Effect runtimes. Public Promise/AsyncIterable ports remain
  thin transport-neutral boundaries and public declarations remain Effect-free.
- The source-run browser gate constructs its own genuine SDK/Vite/Capsule draft
  artifact. A visible sidebar pointer drag must commit a bounded Canvas node,
  mount rendered guest content immediately, survive reload, and remount after a
  backend restart.
- The same gate captures the native Effect RPC wire. It requires one canonical
  AI Chat node, a successful connect, a durably replaced New Chat session,
  model plus `xhigh` preference persistence, a visible prompt through a bounded
  local streaming provider, authoritative history, physical reconnect, stale
  generation fencing, and no visible handled error alerts.
- The corrective gate found additional real defects that focused mocks had not:
  stale placement-host selection after remount, object codecs incorrectly sent
  through `JSON.parse`, invalid widget minimum size, an acceptance artifact
  without the SDK guest bridge, undefined unary outputs, a New Chat/connect
  race, Canvas keyboard capture ahead of embedded editors, no-op preference
  writes, and strict agent event/history output drift.
- Final visual review also caught a masked Preview Reload failure: Capsule
  correctly rejected reuse of a live shadow-root container. Each generation
  now stages in a fresh hidden target, swaps only after `ready()`, and leaves
  the last-good view intact on rejection. Error toasts expose `role="alert"`,
  so a handled extension failure fails browser acceptance.

### 17.2 P0 disposition

| Finding | Status | Corrective evidence |
|---|---|---|
| P0-01 | Closed | Canvas authored state and portal reconciliation now stay coherent. The browser gate asserts a real Capsule guest marker before reload and again after reload and process restart. |
| P0-02 | Closed | AI Chat scope consumes the canonical `kind: "ai-chat"` contract. A source-run canonical node completes `agent.chat.connect`. |
| P0-03 | Closed | Both Effect RPC peers declare the same `PrivateRpcError`; `tests/transport/private-rpc-contract.test.ts` cross-decodes failures in both directions and prevents `Schema.Never` drift. |
| P0-04 | Closed | Agent/domain failures are translated to bounded typed private RPC failures. Contract and prompt tests cover chat codes rather than erasing every cause to a generic decoder failure. |
| P0-05 | Closed | Optional widget fields are omitted and both physical peers use `Schema.Json`. The transport regression rejects nested `undefined`, sparse arrays, non-finite numbers, bigint, symbols, dates, and maps. |
| P0-06 | Closed | Sidebar placement owns the complete primary-pointer session, threshold, capture, preview, cancellation, active-host selection, Canvas bounds, and client-to-world projection. The live gate uses visible pointer events and checks committed geometry and portal bounds. |
| P0-07 | Closed | Strict topology enforcement permits only the four backend responsibility folders and named tiny entries. All former private/plugin/service implementation was moved under its core or shell owner. |
| P0-08 | Closed | The frontend now has the required four-way split, explicit core services, live and controlled Layers, shared conformance, and no frontend DST explorer. |
| P0-09 | Closed | `setupServices` and the registry lifecycle are gone. Production constructs one scoped semantic Layer graph and runtime edges alone execute programs. |
| P0-10 | Closed | `fnReduceCanvasCommandItems` is the single operation/precondition/no-op policy used by both the live `CanvasService` and the simulated authority. The unchanged command-matrix scenario exercises every operation, duplicate idempotency, replay, query, resync, and item revision through both Layers. |

### 17.3 P1 disposition

| Finding | Status | Corrective evidence |
|---|---|---|
| P1-01 | Closed | Legacy portal-form programs were deleted with the old trees. Architecture tests enforce pure `fn` roles and lazy, explicitly typed one-argument-or-zero-argument core `fx`/`tx` programs. |
| P1-02 | Closed | Live constructors now require filesystem, process, database, time, entropy, token, and scheduler handles explicitly. A whole-shell gate rejects optional world handles and ambient fallback patterns; backend verification passes 687 tests across 164 files. |
| P1-03 | Closed | Simulation supplies controlled Layers for the same semantic services and core programs used live. Seeded scheduling, virtual time, entropy, faults, replay, nodes, process/network/storage outcomes, completion admission, fork/yield/callback order, interruption, finalizers, and runtime isolation are qualified without admitting Turso or host completion into deterministic ordering. |
| P1-04 | Closed | One unchanged scenario per backend domain now runs through live and simulated Layers. Live suites use scoped production Canvas/Turso, Agent, Resource/Turso, Widget State/Turso, Function Service/Direct Executor, Event Publisher, and widget publication mechanics; deterministic drivers replace only the host outcomes being controlled. Preview/runtime mounting is additionally exercised through the real source-run SDK/Vite/Capsule browser flow. |
| P1-05 | Closed | Turso, migrations, schema, SQL, statement registry, row codecs, backup/recovery, stores, and verification now live together under `shell/database`; core exposes semantic database programs. |
| P1-06 | Closed | Arbitrary wire strings and caller-selected result types are gone. The exact request/stream inventories drive path-indexed frontend input/output types, backend per-operation codecs, JSON-only Effect RPC envelopes, and typed failures. Compile-time key coverage plus bidirectional request, stream, error, optional-field, and non-JSON parity tests enforce exact structural equality. |
| P1-07 | Closed | Publishers and domain supervisors provide monotonic cursors, acknowledgement-based advancement, duplicate suppression, retained replay or explicit resync/terminal failure, bounded queues, cancellation, and stale-generation rejection. Shared six-domain frontend matrices and backend restart/future/eviction scenarios cover Canvas, agent, notifications, catalog, database, widget state, and publication; source-run restarts prove the mounted recovery path. |
| P1-08 | Closed | Shell/server/CLI composition is under `shell`; no plugin/private package self-import layer or broad backend source export survives. |
| P1-09 | Closed | Frontend policy and lazy programs live in `core`; Solid, Canvas adapters, browser mechanics, resources, inspection, chat, and transport live under `shell`. |
| P1-10 | Closed | The frontend creates an instance-owned `ManagedRuntime`, store, theme controller, transport, placement coordinator, and retirement coordinator, and disposes them on page/HMR teardown. Sim runtime-isolation tests prove two instances do not share state and one can be disposed independently. |
| P1-11 | Closed | Controlled frontend Layers supply transport, storage, IDs, clock, navigation, and notification behavior; the same startup, placement, chat, resource, reconnect, and RPC scenarios run live and simulated. |
| P1-12 | Closed | The app runtime now owns DB-operation polling, resource debounce/secret expiry, catalog and notification streams, database-event subscriptions, reconnect recovery, and Canvas-host retirement as scoped Effect work. Controlled Clock tests prove polling termination and interruption. Remaining DOM callbacks and Promise/AsyncIterable calls are thin framework or injected port edges. |
| P1-13 | Closed | Prompt/edit/DB/resource adapters use conditional spreads; strict JSON regressions verify omitted optionals rather than own properties with `undefined`. |
| P1-14 | Closed | Feature error policy consumes the top-level `PrivateRpcError` shape and retains bounded code/status/details. Cross-peer codec tests use the real envelope. |
| P1-15 | Closed | Lazy core reconnect recovery now owns finite Effect-Clock backoff, transient classification, terminal propagation, generation retirement, and generation-checked replay. The unchanged live/sim scenario covers retry, 404 termination, and controlled-time generation replacement. |
| P1-16 | Closed | Backend session connection and history reads are serialized through the connection lane. The source-run browser gate submits a visible streamed prompt, verifies authoritative history, restarts the real backend while AI Chat is mounted, and requires the replacement connection to return and visibly render that same history. |
| P1-17 | Closed | New Chat persists a replacement session ID into the Canvas node and retires the old session. Model and thinking changes persist; native frame capture proves the replacement ID plus the selected local model and `xhigh` survive reload. |
| P1-18 | Closed | Startup is a core generation-aware program; stale completions are rejected, bootstrap failure is routed through explicit notification state, and shared live/sim startup conformance is active. |
| P1-19 | Closed | Blank frames, duplicate AI Chat actions, opaque decoder alerts, placement bounds, embedded keyboard containment, no-op preference writes, streaming, reload, and process recovery pass the source-run gate. Preview uses one native responsive titlebar; Reload mounts into a fresh hidden Capsule target, swaps only after readiness, and retains the last-good view on failure. The live 360 px gate checks non-overlap, exact menu actions, successful Reload, painted output, and zero error alerts. |
| P1-20 | Closed | Canvas command serialization, late acknowledgements, recovery, event consumption, retry timing, media gates, prepared uploads, promotion/rollback/deletion, preload/orphan cleanup, boot, and teardown are lazy Effect programs on one instance runtime. Deterministic disposal tests interrupt partial uploads and clean completed resources; only public/injected Promise ports remain at the boundary. |
| P1-21 | Closed | One component runtime owns prompt, cancel, edit, history, approval, settings, authentication, API-key, catalog, polling, and stream lifecycles. Keyed tasks replace stale work and scoped disposal interrupts it. Manual request IDs, browser interval ports, module-global catalog state/locks, and the generic Promise escape hatch were removed; public declarations remain Effect-free. |

### 17.4 P2 disposition

| Finding | Status | Corrective evidence |
|---|---|---|
| P2-01 | Closed | The architecture gate rejects extra app folders, forbidden dependency direction, ambient world access, invalid program roles, manual composition/service locators, application runtime execution outside edges, missing sim services, and missing substantive conformance domains. |
| P2-02 | Closed | The clean source-run browser gate performs visible AI Chat prompt/stream/history and durable preference actions, a real widget pointer placement and Reload, widget Config save and file selection, KV write, secret create/reveal/hide, and a live SQL query. It also verifies immediate/reload/restart guest paint, two backend restarts, native generation fencing, all atlas route families, and absence of handled alerts, console/page errors, or bad HTTP responses. |
| P2-03 | Closed | Former mock-only gaps have live integration regressions for callback ordering, canonical AI scope, codec parity, real pointer placement, current host generation, prompt submission, and restart recovery. |
| P2-04 | Closed | Root architecture/browser/test commands build or stage the exact public inputs they inspect; default `pretest` builds all public packages and the browser fixture constructs a genuine bridge-enabled widget artifact. |
| P2-05 | Closed | Empty KV/plugin residue, retired package/topology names, anonymous global subscriptions, stale diagnostics, and legacy helper workspaces were removed or placed under an explicit current owner. |

### 17.5 Final live and manual results

The strict source-run browser gate passes from a fresh isolated home. It builds
a genuine SDK/Vite/Capsule draft, starts the real backend and Vite frontend,
and drives Chromium through visible product controls. The visible ProseMirror
editor submits to a bounded local OpenAI-compatible streaming provider with
the selected model and `xhigh`; the gate observes a partial response, releases
the final chunk, verifies authoritative history, and proves New Chat plus the
preferences survive reload.

The same run proves the seeded draft guest paints immediately after a real
sidebar pointer drag, paints again after reload, and remains painted after a
second backend process restart. AI Chat history recovers visibly across the
first backend restart. A forced native WebSocket disconnect then creates a new
generation, delivers no late frame from the retired connection, and admits a
post-reconnect Canvas mutation. Sixteen route states are covered. The gate
saves widget Config and inspects a real source file, creates and reads a KV
value, creates/reveals/hides a secret, and runs `SELECT 42 AS answer` against
the live database resource. These actions complete without a handled alert,
console error, page error, or bad HTTP response.

Manual review of the fresh screenshots confirms the AI Chat response,
titlebar, settings action, model, and thinking state render. The Preview guest
also renders with one responsive native titlebar: at 360 px, the title and
compact `•••` action are contained and non-overlapping, and its menu exposes
Reload, Rebuild, Build and Publish, and Remove. The final rerun exercised these
exact DOM and geometry contracts, clicked Reload, observed a new successful
Preview-open request, and passed.

A separate source `bun run dev` session used a new empty `OMNIDRAW_HOME` and
the Codex in-app browser. It created the initial Canvas, placed AI Chat through
the visible toolbar and pointer gesture, showed the provider-setup state inside
the mounted widget, reloaded the durable Canvas URL, retained exactly one AI
Chat surface, reported no visible alerts, and recorded no browser errors or
warnings. The dev stack was stopped after the check and its temporary home was
moved to Trash.

### 17.6 Commands with current evidence

| Command | Corrective result |
|---|---|
| `bun test tests/transport/private-rpc-contract.test.ts` | Pass: 8 tests, 52 expectations |
| `bun test scripts/architecture-boundaries.test.ts` | Pass: 15 tests; full architecture/tooling selection passes 49 tests, 499 expectations |
| `bun run test:backend:conformance` | Pass: 74 tests, 177 expectations, including scheduler qualification |
| `bun run test:frontend:conformance` | Pass: 13 tests, 12 expectations; the focused reconnect matrix, full frontend Bun/Vitest suites, typecheck, and build also pass |
| Canvas package verification | Pass: typecheck, 156 tests, standalone staged build, declaration leak scan |
| AI Chat package verification | Pass: typecheck, 88 tests, standalone staged build, five reachable public declarations and zero Effect leaks |
| Backend full verification | Pass: 687 tests across 164 files, 6,843 expectations, typecheck, explicit-world gate, and production-adapter conformance |
| Frontend full verification | Pass: 80 Bun tests, 24 Vitest tests, typecheck, and production build |
| `bun run test:browser:typecheck` | Pass |
| `bun run test:browser:live` | Pass: 16 routes; Config save/file inspection; KV write; secret reveal/hide; live SQL; visible streamed prompt/history; durable New Chat/model/`xhigh`; immediate/reload/restart Preview pixels; last-good Reload replacement; non-overlapping titlebar; two backend restarts; native reconnect; zero retired-socket late frames and zero handled error alerts |
| `bun run test` | Pass after the final fixes: all app/public-package typechecks, workspace tests/builds, architecture, live/sim conformance, database, packed composition, packed browser, and source-run browser gates |
