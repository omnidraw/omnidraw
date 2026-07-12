# Vibecanvas Widget + Actor System

This document summarizes the current widget system and the architecture implied by the local `sdk-test` fixture. It is written as context for designing the public SDK exposed to guest widget authors.

## Goal

Vibecanvas allows generative widgets to appear as live UI on the infinite canvas. A widget has two guest-authored halves:

- **Widget UI**: browser-side Arrow code mounted inside an `@arrow-js/sandbox` sandbox.
- **Actor backend**: Bun-side functions executed in a child process and driven by messages/state-machine transitions.

The SDK should make this split feel intentional: UI authors should work with canvas/widget concepts, while actor authors should work with typed messages, durable state, and controlled effects. The current implementation exposes lower-level pieces, so the next SDK layer should hide transport, IPC, schema validation, and storage details.

## Important files

### Runtime services

- `packages/service-actor/src/ActorService.ts`
  - Public service facade for actor definitions, widget source loading, actor instance lifecycle, and actor input delivery.
  - Wraps `ActorSupervisor`.
  - `sendMessage(instanceId, msgName, msgPayload)` delegates to the in-memory actor and returns the accepted message id.

- `packages/service-actor/src/ActorSupervisor.ts`
  - Loads widget manifests from `<configPath>/widgets/*/vibecanvas.json`.
  - Syncs actor definitions into DB.
  - Boots DB-backed actor instances into memory.
  - Creates/removes actor instances when canvas widget elements are created/deleted.
  - Publishes actor event envelopes to `IEventPublisherService`.
  - Routes only `kind === "actor"` output messages across actor connections.

- `packages/service-actor/src/Actor.ts`
  - In-memory runtime for one actor instance.
  - Owns current actor state/data and serializes inbox processing.
  - `inbox(msgName, msgPayload)` validates and enqueues immediately, returning a generated message id.
  - `start()` boots the child process and emits system lifecycle/state events.
  - Emits discriminated actor events with `kind: "system" | "actor"`.
  - Validates input and output message payloads with AJV schemas from `vibecanvas.json`.
  - Spawns `icp-client.ts` as a Bun child process to run guest code.

- `packages/service-actor/src/icp-client.ts`
  - Child-process bridge that loads guest `actor/functions.ts`.
  - Receives transition runs from parent.
  - Builds the portal passed to guest functions: `next`, `setData`, `emitMessage`.
  - Supports transition pipelines such as `fn.check`, `fx.read`, `tx.write` via `portal.next()`.

### AI widget wizard

- `packages/service-agent/src/AgentService.ts`
  - Owns Pi sessions for the AI wizard.
  - `connectWizzard(widgetId, sessionId)` creates/resumes the Pi session for a widget draft cwd under `<dataPath>/pi/agent/widget-cwd/*`.
  - Returns chat history plus the latest actor candidate custom entry when one exists.
  - Loads phase-specific tools from `packages/service-agent/src/tools/fn.phase-tools.ts`.

- `packages/service-agent/src/tools/tool.set-actor-candidate.ts`
  - Phase 1 custom Pi tool.
  - Accepts a full actor candidate, validates it, and appends it to the Pi session with `sessionManager.appendCustomEntry`.
  - Uses a hand-authored TypeBox tool parameter schema so the model sees actor state and transition-function constraints.

- `packages/service-agent/src/tools/tool.approve-actor-candidate.ts`
  - Phase 1 custom Pi tool.
  - Approves the latest actor candidate revision, writes scaffold files into the draft cwd, appends an approval custom entry, and emits a widget update event when wired.
  - Scaffold includes `vibecanvas.json`, `package.json`, `actor/functions.ts`, actor function stubs, `actor/types.ts`, `widget/main.ts`, and `widget/main.css`.
  - After writing `package.json`, tries `npm install`; install failure is reported in tool details and does not by itself undo approval.

- `packages/service-agent/src/tools/tool.validate-widget-files.ts`
  - Phase 2 custom Pi tool.
  - Validates the generated draft files against the approved manifest and actor registry expectations.

- `packages/service-agent/src/tools/tool.publish-widget.ts`
  - Phase 2 custom Pi tool.
  - Copies the draft widget folder to `<configPath>/widgets/<slug>` and reloads actor definitions through `ActorService.reload()` when available.

- `packages/service-agent/src/core/fx.session-candidate.ts` and `packages/service-agent/src/core/tx.session-candidate.ts`
  - Read/write latest actor candidate and approval records from Pi session custom entries.
  - Candidate records are not written to separate files.

### Manifest and schemas

- `packages/service-actor/src/core/types.ts`
  - Current TypeScript contract for `TVibecanvasJson`, actor state, messages, transition functions, and JSON Schema.
  - Also defines SDK actor types currently re-exported by `@vibecanvas/sdk`.

- `packages/service-actor/src/core/vibecanvasjson.zod.ts`
  - Runtime validation of `vibecanvas.json`.

- `packages/service-db/src/model.ts`
  - Zod model for persisted DB rows.
  - Actor rows include definitions, instances, connections, status, state, and JSON context.

### Canvas/front-end integration

- `packages/api-actors/src/contract.ts`
  - ORPC contract for listing/getting actor definitions, actor snapshots, actor event streaming, and actor input sending.
  - `definitions.get` returns the merged manifest/DB definition plus widget source files.
  - `events` streams `TActorEvent` envelopes.
  - `instances.sendMessage` accepts `{ instanceId, name, payload }` and returns `{ messageId }`.

- `packages/api-actors/src/api.def-get.ts`
  - Reads the manifest from `ActorService` and widget source from disk.

- `packages/canvas/src/plugins/widget/Widget.plugin.ts`
  - On canvas init, fetches actor definitions and widget source.
  - Registers each actor-backed widget with `WidgetManagerService`.

- `packages/canvas/src/services/widget/fx.draw-host.ts`
  - Creates a canvas element with `data.type === "widget"` and `actorDefinitionName`.

- `packages/canvas/src/services/widget/attach-dom-portal.ts`
  - Attaches an absolutely positioned DOM portal over the Konva widget body.
  - Mounts the Arrow sandbox if the widget config contains sandbox source.
  - Passes a fresh actor-instance-id reader and actor-event subscription capability into the sandbox host bridge.

- `packages/canvas/src/services/widget/mount-arrow-sandbox.ts`
  - Wraps `@arrow-js/sandbox`.
  - Injects base CSS.
  - Rewrites `@vibecanvas/sdk/widget` imports to `/__vibecanvas_sdk_bootstrap.js`.
  - Injects the built widget SDK module at `/__vibecanvas_sdk.js`.
  - Implements the private `host-bridge:vibecanvas-widget` module used by the SDK bootstrap.
  - Fetches initial actor snapshots through the actor API.
  - Sends widget input messages through `api.actors.instances.sendMessage`.
  - Converts relevant actor events into sandbox snapshot updates.

### UI action → backend actor trace

Read these files in order when debugging a widget button click such as `actor.sendMessage(name, payload)`:

1. `local-volume/config/widgets/sdk-test/widget/main.ts`
   - Guest Arrow UI calls `actor.sendMessage(...)` from `@vibecanvas/sdk/widget`.
2. `packages/sdk/src/widget.ts`
   - Public widget SDK singleton; forwards `actor.sendMessage(...)` to the injected private implementation set by `__setSendMessage`.
3. `packages/canvas/src/services/widget/mount-arrow-sandbox.ts`
   - Injects SDK/bootstrap modules into `@arrow-js/sandbox`.
   - Implements `host-bridge:vibecanvas-widget`.
   - `sendActorMessage({ name, payload })` waits for the widget actor instance id and calls `api.actors.instances.sendMessage(...)`.
   - `getActorSnapshot()` waits for actor id and fetches `api.actors.instances.snapshot(...)`.
   - `nextActorEvent({ cursor })` delivers event-driven snapshot updates into the sandbox.
4. `packages/canvas/src/services/widget/attach-dom-portal.ts`
   - Mounts the sandbox for a Konva widget host.
   - Supplies `getActorInstanceId()` from fresh Konva node attrs, avoiding stale initial canvas element data.
   - Supplies `subscribeActorInstanceEvents(...)` from `WidgetManagerService`.
5. `packages/canvas/src/services/widget/WidgetManagerService.ts`
   - Registers widget tools/elements.
   - Opens one service-level `api.actors.events({})` stream.
   - Routes incoming actor events by `event.actorId` to mounted sandbox subscribers.
6. `packages/api-actors/src/contract.ts`
   - Defines `instances.sendMessage`, `instances.snapshot`, and streamed `TActorEvent` envelopes.
7. `packages/api-actors/src/api.instance-send-message.ts`
   - ORPC handler for `instances.sendMessage`; calls `context.actor.sendMessage(...)` and returns `{ messageId }`.
8. `packages/service-actor/src/ActorService.ts`
   - Service facade; delegates `sendMessage(instanceId, msgName, msgPayload)` to the supervisor actor map.
9. `packages/service-actor/src/ActorSupervisor.ts`
   - Owns in-memory actor instances.
   - Publishes all actor events to `IEventPublisherService`.
   - Routes only `kind: "actor"` output events across actor connections.
10. `packages/service-actor/src/Actor.ts`
    - Validates input, enqueues immediately, returns message id.
    - Serializes queue processing.
    - Emits system events (`ack`, `state.changed`, `data.changed`, `status.changed`, `error`) and actor output events.
11. `packages/service-actor/src/icp-client.ts`
    - Child-process runner for guest actor functions.
    - Implements guest portals: `next`, `setData`, `emitMessage`.
12. `local-volume/config/widgets/sdk-test/actor/functions.ts` and sibling actor files
    - Guest actor transition implementation.

For actor creation before UI send, also read:

- `packages/canvas/src/services/widget/fx.draw-host.ts`
  - Creates widget canvas elements with `data.actorDefinitionName`.
- `packages/imperative-shell` / Automerge actor-create integration files as needed
  - Canvas element creation triggers `ActorService.createInstance(...)`.
- `packages/service-actor/src/ActorSupervisor.ts`
  - `createInstance(...)` inserts DB row, creates `Actor`, listens before `start()`, and returns the actor id used as `data.actorInstanceId`.

### Guest fixture

- `local-volume/config/widgets/sdk-test/vibecanvas.json`
  - Defines the Todo Actor System manifest.
  - Declares initial actor data, JSON schemas for data/input/output messages, state transitions, actor function path, and widget tool metadata.

- `local-volume/config/widgets/sdk-test/widget/main.ts`
  - Arrow UI widget.
  - Imports `actor` from `@vibecanvas/sdk/widget`.
  - Renders reactive actor state/context and sends typed todo input messages through `actor.sendMessage(...)`.

- `local-volume/config/widgets/sdk-test/actor/functions.ts`
  - Guest actor function registry.
  - Exports `{ fn, fx, tx }` maps keyed by manifest transition names.

- `local-volume/config/widgets/sdk-test/actor/*.ts`
  - Example actor logic split into pure reducers (`fn.*`), read helpers (`fx.*`), and writes (`tx.*`).

## Current lifecycle

### 1. Service startup

1. CLI starts `DbServiceTurso`, `AutomergeService`, and `ActorService` during `serve`.
2. `ActorService.start()` calls `ActorSupervisor.init()`.
3. Supervisor scans `<configPath>/widgets/*/vibecanvas.json`.
4. Each manifest is parsed and validated by `ZVibecanvasJson`.
5. Definitions are synced into `actor_definitions`.
6. Existing `actor_instances` are loaded from DB and booted into in-memory `Actor` objects.
7. Existing `actor_connections` are loaded into `connectionMap`.

### 2. Widget registration in the canvas client

1. The canvas `Widget.plugin` calls `api.actors.definitions.list()`.
2. For each definition, it calls `api.actors.definitions.get({ name })`.
3. The API returns:
   - DB definition fields.
   - Manifest fields.
   - Widget source files from `widget.relWidgetDir`.
4. The plugin builds an Arrow sandbox source map like `{ "main.ts": string, "main.css": string }`.
5. The widget is registered with:
   - `id = actor.def.name`
   - `dataType = "widget"`
   - manifest `tool` metadata
   - `actor.actorDefinitionName`
   - sandbox Arrow source

### 3. Widget creation on the canvas

1. User selects the registered tool and creates a widget host.
2. `fx.draw-host.ts` creates an Automerge canvas element:
   - `data.type = "widget"`
   - `data.kind = widget id`
   - `data.actorDefinitionName = actor definition name`
3. `AutomergeService.onElementCreate` sees the widget element.
4. It calls `ActorService.createInstance(defName, canvasId, elementId)`.
5. Supervisor inserts an `actor_instances` row and creates an in-memory `Actor`.
6. The canvas element is patched with `data.actorInstanceId = actor.getId()`.

### 4. Widget rendering

1. The Konva widget host gets a DOM portal over its body.
2. If the widget config has `sandbox`, `mountArrowSandbox()` mounts an `@arrow-js/sandbox` template into that portal.
3. The sandbox runs the guest Arrow `main.ts` in QuickJS/WASM.
4. The host page owns the real DOM rendered by Arrow sandbox, not guest code directly.
5. The sandbox bridge waits for `data.actorInstanceId` with a short exponential backoff because widget DOM can mount before actor creation has patched the canvas element.
6. Once an actor id is known, the bridge fetches `api.actors.instances.snapshot({ instanceId })` and subscribes to routed actor events for that actor instance.

### 5. Actor message processing

1. Parent calls `actor.inbox(msgName, msgPayload)`.
2. `Actor` generates a message id.
3. `Actor` validates the message name against `actor.inputMsgSchema`, validates the payload against `actor.inputMsgSchema[msgName]`, and finds the transition for current state at `actor.states[currentState].on[msgName]`.
4. Invalid input messages are dropped instead of changing actor state. A dropped input emits only an implicit actor output event named `DROP_MESSAGE` with drop details, then returns the generated message id.
5. Valid input messages are enqueued, queue processing is triggered, and the message id is returned immediately.
6. Startup activation, inbox messages, timeout messages, and state activity ticks are processed one at a time by one serialized queue.
7. The transition function list is sent over IPC to the child process:
   - `func`
   - `payload`
   - current `data`
8. `icp-client.ts` maps function names to registered guest functions in `functions.ts`.
9. Guest functions receive `(portal, args)`.
10. Guest code may call:
   - `portal.next()` to continue a function pipeline.
   - `portal.setData(nextData)` to update actor data in the parent.
   - `portal.emitMessage({ type, payload })` to emit actor output.
11. `portal.setData(...)` emits a system `data.changed` event.
12. New transitions use one `targetState`. Legacy `allowedTargetStates` manifests are normalized at load time without breaking their current behavior.
13. Parent validates emitted outputs against `actor.outputMsgSchema`.
14. Valid output is emitted as `kind: "actor"` and supervisor can route it to connected target actors.
15. State-changing messages run source `onExit`, transition functions, target `onEnter`, then start target timeout/activity scheduling before emitting `ack`.
16. Final startup, input, activity, recovery, and implicit-error outcomes emit revisioned snapshot events for ordered persistence and widget updates.

## Current data model

### Manifest-level definition

`vibecanvas.json` is the source of truth for guest code structure:

- `slug`, `name`, `version`, `description`
- `actor.initialState`
- `actor.initialData`
- `actor.dataSchema`
- `actor.states[state].on[msgName].func`
- `actor.states[state].on[msgName].targetState`
- `actor.states[state].onEnter`, `onExit`, and `onError`
- `actor.states[state].activity` for one fixed-delay, non-overlapping state activity
- `actor.inputMsgSchema`
- `actor.outputMsgSchema`
- optional `actor.resources`, a definition-level map of named `kv`, `secretStore`, and versioned `db` requirements
- `actor.relFunctionPath`
- `widget.relWidgetDir`
- `widget.tool`

### AI wizard draft data

The AI wizard has a pre-publish draft layer before a widget becomes a real actor definition:

- Actor candidates are stored as Pi session custom entries, not as standalone candidate files.
- The latest candidate custom entry is returned by `agent.wizzard.connect` as `actorCandidate`.
- Successful approval appends a separate approval custom entry.
- Phase selection is derived from the session history:
  - no approval entry: phase 1 tools only (`vc_set_actor_candidate`, `vc_approve_actor_candidate`)
  - approval entry exists: phase 2 tools plus built-in `read`, `edit`, and `grep`
- Approval writes draft files into the wizard cwd. The draft is not installed for runtime until `vc_publish_widget` copies it to `<configPath>/widgets/<slug>` and reloads actor definitions.
- Approval scaffold writes a `package.json` and attempts `npm install` if `package.json` exists.

### DB-backed runtime rows

The active model in `packages/service-db/src/model.ts` contains:

- `actor_definitions`
  - `name`, `slug`, `url`, `description`, `manifest_path`, timestamps.
- `actor_instances`
  - `id`, `canvas_id`, `element_id`, `actor_definition_name`, `status`, `machine_state`, `machine_context`.
- `actor_connections`
  - Source/target actor instance ids, `enabled`, optional message whitelist, style.

### Shared actor resources

Actor resources are neutral shared infrastructure. A manifest declares stable named slots and permissions; it never contains a concrete resource ID, local path, provider handle, or credential. Users bind a definition slot to a catalog resource, and every actor instance of that definition resolves the same binding. Multiple definitions may intentionally bind the same resource.

Effective access is the intersection of manifest scope, the persisted binding restriction, and the function-class ceiling:

| Function class | Resource access |
|---|---|
| `fn.*` | none |
| `fx.*` | reads declared and permitted by the binding |
| `tx.*` | declared reads/writes permitted by the binding |

A resource call resolves its binding when the call starts. It finishes against that resolved resource even if a concurrent rebind commits; later calls resolve the new binding. Bindings are not copied into actor machine context.

Manifest examples:

```json
{
  "resources": {
    "preferences": { "kind": "kv", "required": true, "scope": ["read", "write"] },
    "credentials": { "kind": "secretStore", "required": true, "scope": ["read"] },
    "notes": {
      "kind": "db",
      "required": true,
      "scope": ["read", "write"],
      "schema": { "id": "notes", "version": 2 },
      "operations": {
        "listNotes": { "effect": "read", "sql": "SELECT id, title FROM notes", "result": "rows" }
      }
    }
  }
}
```

`KvResource` stores JSON-compatible values. Plain `set` is last-write-wins; revisions and `compareAndSet` provide explicit coordination for shared read-modify-write flows. Separate resources remain isolated even when their keys match. Writes do not automatically rerun other actor instances; they observe committed data on their next read.

`SecretStoreResource` stores string values on the shared resource-key-value persistence layer but has a distinct public interface and kind. Values are plaintext at rest in this version. `list`, write, delete, conflict, control responses, logs, and ordinary errors omit plaintext values; an explicit `get` returns the value to the trusted actor child. This is accidental-disclosure hygiene, not encryption or a hostile-process boundary.

`DbResource` is a separate host-managed local database, never Vibecanvas's application `DbServiceTurso`. DB slots declare an exact schema ID/version, named operations, and optional `arbitrarySql` (false by default). `db_resource_configurations` is authoritative for a resource's schema ID and applied/target versions; the physical database's `_vibecanvas_migrations` table is authoritative for its actual migration history. Version 0 means no host migrations have been applied, but the schema must still be published. Named parameters are bound rather than interpolated. `fx` can invoke reads/query when permitted; only `tx` can execute writes. Schema publication, migration, physical paths, and native handles are never actor capabilities.

Arbitrary `query(sql, parameters?)` accepts one row-producing statement. Arbitrary `execute(sql, parameters?)` accepts one write-capable statement, while `execute(operations)` accepts a bounded non-empty array of individually parameterized statements. An operation array runs in order through one IPC call, binding resolution, physical connection, and serialized resource write lane. The caller controls transaction flow by including `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `ROLLBACK TO`, and `RELEASE`; arrays are not automatically atomic, and earlier operations may commit when no explicit transaction was opened. Execution stops on failure and the host defensively rolls back a transaction left open. Named manifest operations remain one statement.

Arbitrary SQL remains a trusted-actor feature. The current Turso adapter has no proven read-only authorizer, and SQLite can report a mutating `INSERT`/`UPDATE`/`DELETE … RETURNING` statement as row-producing; therefore the `query` surface is not a hostile-code read boundary. The host still enforces declared/effective permissions, bounded actor statements/operation arrays, parameter/result/time limits, and rejects file-control/extension-loading forms such as `ATTACH`, `DETACH`, `VACUUM INTO`, and `load_extension`. These lexical guards reduce accidental host-path access but are not presented as a general SQL sandbox.

### Canvas document element

Actor-backed widgets are canvas elements with:

- `data.type = "widget"`
- `data.kind`
- `data.w`, `data.h`, window/expanded state
- `data.actorDefinitionName`
- optional `data.actorInstanceId`
- optional `data.uiProps`

## Arrow UI model

Guest UI uses `@arrow-js/core` primitives:

- `reactive()` for local state.
- `html` tagged templates for UI.
- `component()` when reusable component instances are needed.

`@arrow-js/sandbox` is a good fit because generated UI code runs in QuickJS/WASM and communicates with the host only through serialized bridge calls. The host can expose safe APIs through sandbox host bridges rather than leaking the browser window or internal services.

The current Todo widget imports `actor` from `@vibecanvas/sdk/widget`. The bridge waits for the owning `actorInstanceId`, fetches the initial actor snapshot, sends widget messages to the backend actor API, and receives live snapshot updates from actor event envelopes.

## Current SDK surface

The SDK is now split by runtime. There is intentionally no bare `@vibecanvas/sdk` public entrypoint. Guest code must import a runtime-specific subpath:

- `@vibecanvas/sdk/widget` for browser/Arrow sandbox widget code.
- `@vibecanvas/sdk/actor` for Bun-side actor function code.

Current package source files:

- `packages/sdk/src/widget.ts`
  - Small author-facing widget API.
  - Exposes the singleton `actor` and `TWidgetActor`.
  - The actor object only exposes reactive `state`, reactive `context`, and `sendMessage()`.
  - It also exposes internal setters used by the injected sandbox bootstrap: `__setActorSnapshot` and `__setSendMessage`.
- `packages/sdk/src/widget-bridge.ts`
  - Non-guest bridge helper for tests/future host integrations.
  - Exposes `connectWidgetBridge` and `IWidgetHostPortal`.
  - Models `getActorSnapshot`, `sendActorMessage`, optional `subscribeActor`, and optional long-poll `nextActorEvent`.
- `packages/sdk/src/actor.ts`
  - Actor-side types and helpers.
  - Exposes `defineActorFunctions`, `defineFn`, `defineFx`, `defineTx`.
  - Exposes short actor portal types: `TFnPortal`, `TFxPortal`, `TTxPortal`.
  - Exposes resource requirement/call types plus slot-bound `KvResource`, `SecretStoreResource`, and `DbResource` actor portals.

Current status:

- Actor authors can import types from `@vibecanvas/sdk/actor`.
- Widget authors have a small intended API from `@vibecanvas/sdk/widget`.
- The sandbox host injects the built `@vibecanvas/sdk/widget` source and a bootstrap module.
- Initial actor snapshots are fetched through `api.actors.instances.snapshot({ instanceId })` after the bridge discovers the widget's `actorInstanceId`.
- UI-to-actor send is wired through `api.actors.instances.sendMessage({ instanceId, name, payload })` and returns a backend message id.
- Host-to-sandbox actor updates are event-driven: `WidgetManagerService` listens to all actor events, routes matching `actorId` events to the mounted sandbox, and `mount-arrow-sandbox.ts` converts state/data/error system events into SDK snapshots.

## Remaining architectural gaps

The main bridge path now exists: widget UI can send input to its owning backend actor, and state/data/error changes flow back into the sandbox as snapshots. Remaining gaps:

- Actor output messages route to other actors; the public widget SDK does not yet expose output-message subscriptions.
- Actor event streaming is global at the API level and filtered in `WidgetManagerService`; per-instance stream APIs may be useful later.
- Widget SDK types are still manually authored in fixtures rather than generated from `vibecanvas.json` schemas.

## Recommended SDK shape

The public SDK should be split by runtime.

### `@vibecanvas/sdk/widget`

For Arrow sandbox code. The widget entrypoint should stay intentionally small. Widget authors should see only what they need to render and talk to their own actor.

Current intended primitives:

```ts
import { html } from '@arrow-js/core'
import { actor } from '@vibecanvas/sdk/widget'

export default html`
  <header>
    <span>${() => actor.state.value}</span>
  </header>

  <pre>${() => JSON.stringify(actor.context.value, null, 2)}</pre>

  <button @click="${() => actor.sendMessage('addTodo', { title: 'New' })}">
    Add
  </button>
`
```

Current minimum capabilities:

- `actor.state.value`
  - Arrow-reactive actor machine state, e.g. `ready`, `busy.saving`, `error.validation`.
- `actor.context.value`
  - Arrow-reactive actor context/data from the owning actor instance.
- `actor.sendMessage(name, payload)`
  - Sends an input message to this widget's own actor instance.

Deliberately not in the small widget file yet:

- Canvas element/window APIs.
- Output subscriptions.
- UI props.
- Raw actor ids/definition ids.
- ORPC, Automerge, IPC, DB, Bun, or browser-global escape hatches.

Those can be added later when there is a clear use case, but should not make `widget.ts` hard to read. Integration details belong in `widget-bridge.ts`.

Current bridge direction:

- `mount-arrow-sandbox.ts` rewrites guest imports from `@vibecanvas/sdk/widget` to `/__vibecanvas_sdk_bootstrap.js`.
- The bootstrap module imports the real injected SDK module at `/__vibecanvas_sdk.js` and private host functions from `host-bridge:vibecanvas-widget`.
- The bootstrap calls `getActorSnapshot()` once and applies it through `__setActorSnapshot`.
- The bootstrap starts a `nextActorEvent({ cursor })` loop for future serialized snapshot updates.
- Guest code never imports `host-bridge:*`; only the SDK/bootstrap does.
- Keep all messages JSON-serializable.
- Hide ORPC and canvas services from guest code.
- Generate or provide types from `vibecanvas.json` so `sendMessage()` is typed.

### `@vibecanvas/sdk/actor`

For Bun-side actor guest code. It should preserve the function split but make the API clearer.

Current exports:

- `defineActorFunctions({ fn, fx, tx })`
- `defineFn()`, `defineFx()`, `defineTx()` helpers for typing.
- `TActorFn`, `TActorFx`, `TActorTx` function types.
- `TFnPortal`, `TFxPortal`, `TTxPortal` portal types.
- Manifest preparation types for resource kinds, permission scopes, DB schemas, named operations, and named parameters.
- `portal.resources.kv(slot)`, `portal.resources.secretStore(slot)`, and `portal.resources.db(slot)` on effect-capable portals. `TFnPortal` intentionally has no `resources` field.

Potential later exports:

- `emit(type, payload)` helper to enforce output shape.
- `setData(nextData)` / `patchData(patch)` helpers.
- Type utilities generated from manifest schemas.

Actor author model:

- `fn.*` functions: deterministic pure logic, no side effects.
- `fx.*` functions: impure reads through injected portal capabilities.
- `tx.*` functions: writes through injected portal capabilities.
- Pipelines use `await portal.next()` only when composition is desired.
- Production actor function files must exist on disk at `actor.relFunctionPath` when loaded by the runtime, including compiled Vibecanvas binaries.
- External actor `.ts` or `.js` modules should be self-contained or ship any runtime dependencies beside the widget, for example in the widget folder's `node_modules`. Type-only imports are erased and do not need runtime packages.

### Manifest/type generation

For guest authors, schemas should drive TypeScript types. The SDK can provide a generated module per widget such as:

```ts
import type { ActorInput, ActorOutput, ActorData } from '@vibecanvas/sdk/generated'
```

This should be generated from:

- `actor.dataSchema`
- `actor.inputMsgSchema`
- `actor.outputMsgSchema`

The generated API lets widget code call:

```ts
actor.sendMessage('addTodo', { title: '...' })
```

and actor code emit:

```ts
await portal.emit('todosChanged', payload)
```

without hand-written stringly typed maps.

## Recommended interaction contract

The clean conceptual contract is:

```text
Widget UI --send(input message)--> Owning Actor Instance
Actor Instance --state/context snapshot--> Widget UI
Actor Instance --output message--> Actor Connections --> Target Actor Instance
```

Important boundaries:

- Widget UI talks only to its owning actor unless the SDK explicitly exposes other capabilities.
- Actor-to-actor communication remains manifest/connection driven.
- All payloads are JSON and schema-validated at host boundaries.
- Guest code never receives raw DB, Automerge, child process, Bun, browser window, or service objects.

## Suggested next implementation steps

1. Expose actor output-message subscriptions to widget SDK only if a clear UI use case appears.
2. Consider replacing the global actor event stream with an instance-scoped API, or keep global streaming with client-side routing if that remains simpler.
3. Keep injecting the real `@vibecanvas/sdk/widget` module into `@arrow-js/sandbox` and keep host bridge details hidden behind the bootstrap module.
4. Ensure guest code imports only `@vibecanvas/sdk/widget` or `@vibecanvas/sdk/actor`; do not use bare `@vibecanvas/sdk`.
5. Generate TypeScript types from `vibecanvas.json` schemas for guest projects.

## Design principle

The SDK should expose intent, not infrastructure:

- Widget authors should think: “render UI, send commands, react to actor state.”
- Actor authors should think: “validate input, transform data, emit events.”
- Vibecanvas internals should own: sandboxing, IPC, schema validation, persistence, canvas sync, actor routing, and security boundaries.
