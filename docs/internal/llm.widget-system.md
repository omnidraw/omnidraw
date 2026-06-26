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
  - Public service facade for actor definitions, widget source loading, actor instance lifecycle.
  - Wraps `ActorSupervisor`.
  - `sendMessage()` exists but is still `TODO`.

- `packages/service-actor/src/ActorSupervisor.ts`
  - Loads widget manifests from `<configPath>/widgets/*/vibecanvas.json`.
  - Syncs actor definitions into DB.
  - Boots DB-backed actor instances into memory.
  - Creates/removes actor instances when canvas widget elements are created/deleted.
  - Routes actor output messages across actor connections.

- `packages/service-actor/src/Actor.ts`
  - In-memory runtime for one actor instance.
  - Owns current actor state/data and serializes inbox processing.
  - Validates input and output message payloads with AJV schemas from `vibecanvas.json`.
  - Spawns `icp-client.ts` as a Bun child process to run guest code.

- `packages/service-actor/src/icp-client.ts`
  - Child-process bridge that loads guest `actor/functions.ts`.
  - Receives transition runs from parent.
  - Builds the portal passed to guest functions: `next`, `setData`, `emitMessage`.
  - Supports transition pipelines such as `fn.check`, `fx.read`, `tx.write` via `portal.next()`.

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
  - ORPC contract for listing/getting actor definitions.
  - `definitions.get` returns the merged manifest/DB definition plus widget source files.

- `packages/api-actors/src/api.def-get.ts`
  - Reads the manifest from `ActorService` and widget source from disk.

- `packages/canvas/src/plugins/widget/Widget.plugin.ts`
  - On canvas init, fetches actor definitions and widget source.
  - Registers each actor-backed widget with `WidgetManagerService`.

- `packages/canvas/src/services/widget/fx.draw-host.ts`
  - Creates a canvas element with `data.type === "widget"` and `actorDefinitionName`.

- `packages/canvas/src/services/widget/tx.attach-dom-portal.ts`
  - Attaches an absolutely positioned DOM portal over the Konva widget body.
  - Mounts the Arrow sandbox if the widget config contains sandbox source.

- `packages/canvas/src/services/widget/tx.mount-arrow-sandbox.ts`
  - Wraps `@arrow-js/sandbox`.
  - Injects base CSS.
  - Rewrites `@vibecanvas/sdk` imports to `/__vibecanvas_sdk.js`.
  - Currently has a TODO for actually providing SDK source to the sandbox.

### Guest fixture

- `local-volume/config/widgets/sdk-test/vibecanvas.json`
  - Defines the Todo Actor System manifest.
  - Declares initial actor data, JSON schemas for data/input/output messages, state transitions, actor function path, and widget tool metadata.

- `local-volume/config/widgets/sdk-test/widget/main.ts`
  - Arrow UI widget.
  - Currently local-only state; it does not communicate with the actor yet.

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
2. If the widget config has `sandbox`, `txMountArrowSandbox()` mounts an `@arrow-js/sandbox` template into that portal.
3. The sandbox runs the guest Arrow `main.ts` in QuickJS/WASM.
4. The host page owns the real DOM rendered by Arrow sandbox, not guest code directly.

### 5. Actor message processing

1. Parent calls `actor.inbox(msgName, msgPayload)`.
2. `Actor` validates the payload against `actor.inputMsgSchema[msgName]`.
3. `Actor` finds the transition for current state: `actor.states[currentState].on[msgName]`.
4. Inbox items are queued and processed one at a time.
5. The transition function list is sent over IPC to the child process:
   - `func`
   - `payload`
   - current `data`
6. `icp-client.ts` maps function names to registered guest functions in `functions.ts`.
7. Guest functions receive `(portal, args)`.
8. Guest code may call:
   - `portal.next()` to continue a function pipeline.
   - `portal.setData(nextData)` to update actor data in the parent.
   - `portal.emitMessage({ type, payload })` to emit output.
9. Parent validates emitted outputs against `actor.outputMsgSchema`.
10. Valid output is sent to listeners, and supervisor can route it to connected target actors.

## Current data model

### Manifest-level definition

`vibecanvas.json` is the source of truth for guest code structure:

- `slug`, `name`, `version`, `description`
- `actor.initialState`
- `actor.initialData`
- `actor.dataSchema`
- `actor.states[state].on[msgName].func`
- `actor.inputMsgSchema`
- `actor.outputMsgSchema`
- `actor.relFunctionPath`
- `widget.relWidgetDir`
- `widget.tool`

### DB-backed runtime rows

The active model in `packages/service-db/src/model.ts` contains:

- `actor_definitions`
  - `name`, `slug`, `url`, `description`, `manifest_path`, timestamps.
- `actor_instances`
  - `id`, `canvas_id`, `element_id`, `actor_definition_name`, `status`, `machine_state`, `machine_context`.
- `actor_connections`
  - Source/target actor instance ids, `enabled`, optional message whitelist, style.

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

The current Todo widget is purely local Arrow state. It demonstrates rendering but not actor communication.

## Current SDK surface

The SDK is now split by runtime. There is intentionally no bare `@vibecanvas/sdk` public entrypoint. Guest code must import a runtime-specific subpath:

- `@vibecanvas/sdk/widget` for browser/Arrow sandbox widget code.
- `@vibecanvas/sdk/actor` for Bun-side actor function code.

Current package source files:

- `packages/sdk/src/widget.ts`
  - Small author-facing widget API.
  - Exposes `defineWidget`, `TWidgetSdk`, `TWidgetActor`.
  - The actor object only exposes reactive `state`, reactive `status`, reactive `context`, and `sendMessage()`.
- `packages/sdk/src/widget-bridge.ts`
  - Host bridge implementation details.
  - Exposes `createWidgetSdk`, `createWidgetSdkFromPortal`, and `IWidgetHostPortal`.
  - Contains TODO markers for host bridge functions that still need real integration.
- `packages/sdk/src/actor.ts`
  - Actor-side types and helpers.
  - Exposes `defineActorFunctions`, `defineFn`, `defineFx`, `defineTx`.
  - Exposes compatibility actor types: `TFnPortal`, `TFxPortal`, `TTxPortal`, `TFnArgs`, `TFxArgs`, `TTxArgs`.

Current status:

- Actor authors can import types from `@vibecanvas/sdk/actor`.
- Widget authors have a small intended API from `@vibecanvas/sdk/widget`.
- The widget bridge shape exists, but host integration still needs to be wired.
- UI-to-actor send/subscribe is not fully wired because `ActorService.sendMessage()` is not implemented and no client API exists for it yet.

## Key architectural gap

The backend actor runtime works for direct in-process tests and actor-to-actor routing. The canvas can create actor instances and mount widget UI. However, the bidirectional UI bridge is missing:

- Widget UI cannot send an input message to its actor instance through a stable public SDK.
- Widget UI cannot subscribe to actor data snapshots or output messages.
- Actor data updates are in memory but are not currently persisted back to DB after `portal.setData()`.
- Output messages route to other actors, not to the owning widget UI.
- `allowedTargetStates` are declared but the current `Actor` does not update/check target state transitions beyond selecting the current-state transition.

## Recommended SDK shape

The public SDK should be split by runtime.

### `@vibecanvas/sdk/widget`

For Arrow sandbox code. The widget entrypoint should stay intentionally small. Widget authors should see only what they need to render and talk to their own actor.

Current intended primitives:

```ts
import { html } from '@arrow-js/core'
import { defineWidget } from '@vibecanvas/sdk/widget'

export default defineWidget(({ actor }) => {
  return html`
    <header>
      <span>${() => actor.status.value}</span>
      <span>${() => actor.state.value}</span>
    </header>

    <pre>${() => JSON.stringify(actor.context.value, null, 2)}</pre>

    <button @click="${() => actor.sendMessage('in.addTodo', { title: 'New' })}">
      Add
    </button>
  `
})
```

Current minimum capabilities:

- `actor.state.value`
  - Arrow-reactive actor machine state, e.g. `ready`, `busy.saving`, `error.validation`.
- `actor.status.value`
  - Arrow-reactive actor system status, e.g. `running`, `paused`, `error`.
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

Implementation direction:

- Use `@arrow-js/sandbox` hostBridge to expose a virtual host module.
- The bridge should supply the initial actor snapshot and push subsequent snapshots.
- Keep all messages JSON-serializable.
- Hide ORPC and canvas services from guest code.
- Generate or provide types from `vibecanvas.json` so `sendMessage()` is typed.

### `@vibecanvas/sdk/actor`

For Bun-side actor guest code. It should preserve the function split but make the API clearer.

Current exports:

- `defineActorFunctions({ fn, fx, tx })`
- `defineFn()`, `defineFx()`, `defineTx()` helpers for typing.
- `TActorFn`, `TActorFx`, `TActorTx` function types.
- `TFnPortal`, `TFxPortal`, `TTxPortal` compatibility portal types.
- `TFnArgs`, `TFxArgs`, `TTxArgs` compatibility arg types.

Potential later exports:

- `emit(type, payload)` helper to enforce output shape.
- `setData(nextData)` / `patchData(patch)` helpers.
- Type utilities generated from manifest schemas.

Actor author model:

- `fn.*` functions: deterministic pure logic, no side effects.
- `fx.*` functions: impure reads through injected portal capabilities.
- `tx.*` functions: writes through injected portal capabilities.
- Pipelines use `await portal.next()` only when composition is desired.

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
actor.sendMessage('in.addTodo', { title: '...' })
```

and actor code emit:

```ts
await portal.emit('out.todosChanged', payload)
```

without hand-written stringly typed maps.

## Recommended interaction contract

The clean conceptual contract is:

```text
Widget UI --send(input message)--> Owning Actor Instance
Actor Instance --state snapshot/output--> Widget UI
Actor Instance --output message--> Actor Connections --> Target Actor Instance
```

Important boundaries:

- Widget UI talks only to its owning actor unless the SDK explicitly exposes other capabilities.
- Actor-to-actor communication remains manifest/connection driven.
- All payloads are JSON and schema-validated at host boundaries.
- Guest code never receives raw DB, Automerge, child process, Bun, browser window, or service objects.

## Suggested next implementation steps

1. Implement `ActorService.sendMessage(instanceId, msgName, msgPayload)` by delegating to the supervisor/actor map.
2. Add an ORPC endpoint for sending messages to the current widget actor instance.
3. Implement the `widget-bridge.ts` TODOs using the Arrow sandbox host bridge.
4. Add an event stream or subscription mechanism for actor context/status/state snapshots scoped to an actor instance.
5. Persist actor machine data/state after `portal.setData()` or after each transition completes.
6. Inject the real `@vibecanvas/sdk/widget` module into `@arrow-js/sandbox` via `hostBridge` or source injection.
7. Ensure guest code imports only `@vibecanvas/sdk/widget` or `@vibecanvas/sdk/actor`; do not use bare `@vibecanvas/sdk`.
8. Generate TypeScript types from `vibecanvas.json` schemas for guest projects.

## Design principle

The SDK should expose intent, not infrastructure:

- Widget authors should think: “render UI, send commands, react to actor state.”
- Actor authors should think: “validate input, transform data, emit events.”
- Vibecanvas internals should own: sandboxing, IPC, schema validation, persistence, canvas sync, actor routing, and security boundaries.
