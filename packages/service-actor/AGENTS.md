# @vibecanvas/service-actor

Host-side actor runtime for Vibecanvas widgets.

Treat the implementation and tests together as the source of truth. Core runtime behavior is covered by `tests/Actor.test.ts`; resource behavior is covered by `tests/ActorResourceManager.test.ts`, `tests/Actor.resource-ipc.test.ts`, `tests/DbResource.test.ts`, and `tests/ActorService.resource-migration.test.ts`.

## Current runtime model

An actor is a long-lived in-memory instance that:

- loads a widget `vibecanvas.json` (`TVibecanvasJson`)
- starts from `actor.initialState` and `actor.initialData`
- validates incoming messages with `actor.inputMsgSchema`
- finds transitions in `actor.states[currentState].on[msgName]`
- normalizes new `targetState` and legacy `allowedTargetStates` transitions to one runtime shape
- runs startup, input, timeout, and activity work through one serialized job lane
- runs `onExit` before state-changing transition functions and `onEnter` after applying the target state
- owns one optional fixed-delay, non-overlapping activity per active state
- runs phase-aware transition/activity/state error handlers and recovery
- allows guest functions to update data and emit output messages
- validates emitted messages with `actor.outputMsgSchema`
- emits revisioned final snapshots for ordered persistence beyond external input acknowledgements

`Actor` runs guest code in a child Bun process through `src/icp-client.ts`. Host code communicates with that process by IPC. Do not import or execute guest actor functions directly in host orchestration code.

## Guest function pipeline

Transition functions are named with one of these prefixes:

- `fn.*` — pure-ish guest function; can call `portal.next()` and `portal.emitMessage()`; receives no resource portal
- `fx.*` — guest read/effect function; can also call `portal.setData()` and receives read-capable resource proxies when permitted
- `tx.*` — guest write function; receives resource read/write proxies according to manifest scope and binding restrictions

The child process loads the actor function module at `actor.relFunctionPath`. That module must default-export a map shaped like:

```ts
export default {
  fn: { /* fn.name */ },
  fx: { /* fx.name */ },
  tx: { /* tx.name */ },
}
```

`icp-client.ts` resolves transition, lifecycle, activity, and error-handler names against that map, then runs them in order. A function advances to the next function only when it calls `portal.next()`. `portal.next()` returns the downstream function result.

## Message behavior

`Actor.inbox(msgName, msgPayload)` is the current public delivery API for one in-memory actor.

Expected behavior from tests:

- invalid or unknown input messages reject and emit an `error` output
- valid input messages are queued and processed one at a time
- guest `setData` updates actor data in the host
- guest `emitMessage({ type, payload })` emits a host-visible output message
- invalid output shape or payload emits an `error` message, but still acks the guest IPC request so the child process does not hang
- listeners registered with `actor.listen(cb)` receive emitted messages
- callers must call `actor.close()` to kill the child process

## Service and supervisor direction

`ActorService` is intended to be the public facade used by the rest of the app. Keep app-facing APIs here, such as:

- create actor instance
- remove actor instance
- send message to an actor instance
- read widget metadata/code
- start/stop actor runtime services

`ActorSupervisor` is intended to coordinate actor definitions, instances, inbox processing, and connections. Keep coordination logic here, such as:

- ensure widget folder exists
- discover `vibecanvas.json` files under the configured widgets directory
- sync actor definitions into the DB
- boot in-memory actors from DB actor instances
- claim queued actor inbox messages
- deliver messages to the correct actor
- persist processed/failed status
- listen to actor output messages
- route output messages through enabled actor connections

Do not put product-facing facade policy directly in `Actor`. `Actor` should remain focused on one running actor instance: validate input, run transition, hold current state/data, emit messages.

## Resource architecture

All host-side resource implementation lives under `src/resources/`:

- `ActorResourceManager.ts` — generic catalog, binding, compatibility, permission, dispatch, lifecycle, drain, and shutdown coordination
- `KvResource.ts` — resource-scoped JSON key/value operations
- `SecretStoreResource.ts` — string secret operations with value-safe list/write/error surfaces
- `DbResource.ts` — physical Turso database provisioning, handles, SQL dispatch, backup, restore, and migration primitives
- `DbResourceMigrationCoordinator.ts` — coordinates DB migration with linked actor stop/restart and durable compatibility blocks
- `ActorResourceError.ts` — stable resource errors and safe serialization
- `resource-types.ts` — provider, gateway, binding-status, and migration-preview contracts

`ActorService` is the composition root. It constructs all resource providers, injects them into `ActorResourceManager`, and exposes app-facing resource and schema-management methods. `ActorResourceManager` must remain generic: do not instantiate concrete providers inside it.

Definitions declare named resource slots; users bind each slot to a concrete resource. Bindings are definition-level, so every instance of that definition resolves the same binding. One definition may declare multiple slots, and one resource may be shared by multiple slots or definitions.

For every actor resource call, the host derives definition identity, actor/run identity, function class, binding, resource ID, lifecycle state, and effective permission. The child supplies only slot, expected kind, operation, and serializable arguments. Never expose control-database handles, physical paths, provider handles, resource selection, or effective authority to the child.

Effective access is:

```text
manifest scope ∩ binding restriction ∩ function-class ceiling
```

Resource persistence differs by kind:

- KV and secret entries currently use the resource-scoped `actor_resource_key_values` table in the Vibecanvas control database.
- Each DbResource owns a separate physical database under `<dataRoot>/actor-resources/db/<resource-id>/data.db`.
- Arbitrary `query` is single-statement. Arbitrary `execute` is always tx/write-capable and accepts either one statement or an ordered operation array. Operation arrays use one connection without interleaving; callers explicitly provide transaction/savepoint control statements, and each operation binds its own parameters.
- Named manifest DB operations remain single-statement.
- Resource catalog, bindings, DB schema metadata, and migration control state remain in `DbServiceTurso`.

Keep resource-specific helpers and types inside `src/resources/`. Prefer sibling `fn.*.ts`, `fx.*.ts`, and `tx.*.ts` files there when extracting provider-local logic. Move logic into `src/core/` only when it is genuinely shared with non-resource actor features.

## DB model

Use `@vibecanvas/service-db/src/model.ts` as the source of truth for actor persistence.

Important actor models:

- `ActorDefinition`
  - keyed by `name`
  - includes `slug`, `url`, `description`, `manifest_path`
  - mirrors discovered widget actor manifests
- `ActorInstance`
  - one actor on a canvas
  - has `canvas_id`, `element_id`, `actor_definition_name`, optional `filesystem_id`
  - stores `display_name`, lifecycle `status`, `machine_state`, and `machine_context`
- `ActorInbox`
  - durable inbound message queue for one actor instance
  - has monotonic `seq`, `msg_name`, `payload`, `idempotency_key`
  - status is `queued | processing | processed | failed`
  - stores `processed_at` and `error`
- `ActorConnection`
  - connects `source_actor_instance_id` to `target_actor_instance_id` inside a canvas
  - `enabled` controls routing
  - optional `msg_name_whitelist` filters routed output messages
  - `style` is UI metadata for the connection

The current model does not have an `actor_outputs` table. If output durability is needed, add it intentionally instead of assuming it exists.

## Connected actors

Actors can be connected via `ActorConnection`. The intended flow is:

1. API/product code creates an `ActorInbox` row or calls `ActorService.sendMessage`.
2. `ActorService` delegates delivery to `ActorSupervisor`.
3. `ActorSupervisor` claims queued inbox rows.
4. Supervisor delivers each message to the matching in-memory `Actor`.
5. The actor emits output messages while processing.
6. Supervisor receives those output messages through `actor.listen`.
7. Supervisor finds enabled connections where the emitting actor is the source.
8. If `msg_name_whitelist` allows the output message, supervisor enqueues/delivers a message to the target actor.

Prefer durable inbox rows for cross-actor delivery so message routing survives process restarts. Direct in-memory delivery may be acceptable only for tests or explicitly ephemeral behavior.

## Safety and architecture notes

- Keep guest code execution isolated to the child process path (`icp-client.ts`).
- Host service/supervisor code may inspect manifests and schemas, but must not call guest functions directly.
- Keep `ActorService` as public facade and composition root, `ActorSupervisor` as actor orchestration coordinator, and `ActorResourceManager` as generic resource coordinator.
- Keep `Actor`, `ActorService`, `ActorSupervisor`, and `icp-client.ts` at the `src/` root; keep resource providers/managers/contracts under `src/resources/`.
- Keep `Actor` small enough to represent one actor instance runtime.
- Prefer extracting pure logic into local `fn.*.ts` files and impure helpers into `fx.*.ts` / `tx.*.ts` following the repo rules.
- When editing `fn.*.ts`, `fx.*.ts`, or `tx.*.ts`, follow the package/root AGENTS rules for those file types.
