# @vibecanvas/service-actor

Host-side actor runtime for Vibecanvas widgets.

This package is currently WIP. Treat the code in `src/Actor.ts` and the behavior covered by `tests/Actor.test.ts` as the most accurate description of the current runtime. `ActorService` and `ActorSupervisor` are facade/orchestration work in progress.

## Current runtime model

An actor is a long-lived in-memory instance that:

- loads a widget `vibecanvas.json` (`TVibecanvasJson`)
- starts from `actor.initialState` and `actor.initialData`
- validates incoming messages with `actor.inputMsgSchema`
- finds transitions in `actor.states[currentState].on[msgName]`
- runs transition functions listed in `transition.func`
- allows guest functions to update data and emit output messages
- validates emitted messages with `actor.outputMsgSchema`
- processes inbox messages sequentially, even when callers enqueue concurrently

`Actor` runs guest code in a child Bun process through `src/icp-client.ts`. Host code communicates with that process by IPC. Do not import or execute guest actor functions directly in host orchestration code.

## Guest function pipeline

Transition functions are named with one of these prefixes:

- `fn.*` — pure-ish guest function; can call `portal.next()` and `portal.emitMessage()`
- `fx.*` — guest read/effect function; can also call `portal.setData()`
- `tx.*` — guest write function; same portal shape as `fx` for now

The child process loads the actor function module at `actor.relFunctionPath`. That module must default-export a map shaped like:

```ts
export default {
  fn: { /* fn.name */ },
  fx: { /* fx.name */ },
  tx: { /* tx.name */ },
}
```

`icp-client.ts` resolves transition names against that map, then runs them in order. A function advances to the next transition function only when it calls `portal.next()`. `portal.next()` returns the downstream function result.

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
- Keep `ActorService` as public facade and `ActorSupervisor` as orchestration coordinator.
- Keep `Actor` small enough to represent one actor instance runtime.
- Prefer extracting pure logic into local `fn.*.ts` files and impure helpers into `fx.*.ts` / `tx.*.ts` following the repo rules.
- When editing `fn.*.ts`, `fx.*.ts`, or `tx.*.ts`, follow the package/root AGENTS rules for those file types.
