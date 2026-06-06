# @vibecanvas/service-actor

Host-side actor runtime for Vibecanvas.

## High-level shape

`ActorService` is the safe host entrypoint. It owns:

- an `ActorSupervisor` running in the host process
- actor lifecycle polling, workflow scheduling, and result reconciliation

A host application must inject a sandbox runner that starts the generic durable workflow worker in the background.

Important boundary:

- `packages/service-workflow` must not know about actors
- `apps/worker` must not know about actors
- actor-specific planning/reconciliation lives in `packages/service-actor`
- untrusted guest `fn.*`, `fx.*`, and `tx.*` actor functions must run only inside the sandboxed worker path

## DB model

Actor state is stored in `@vibecanvas/service-db` tables:

- `actor_definitions` — stable actor identity/name/slug
- `actor_revisions` — versioned machine config, contracts, and bundle manifest
- `actor_instances` — one actor on a canvas; stores machine state/context and active workflow id
- `actor_connections` — routes outputs from one actor instance to another
- `actor_inbox` — queued/claimed/processed input messages
- `actor_outputs` — committed outputs produced by actor workflows

Workflows are still stored in workflow tables (`workflow_runs`, `workflow_steps`, `sandbox_runs`). Actor rows reference workflow rows, but workflow code does not reference actor rows.

## How to use

Create the service with a Drizzle DB from `DbServiceBunSqlite`:

```ts
import { ActorService } from '@vibecanvas/service-actor';
import { DbServiceBunSqlite } from '@vibecanvas/service-db/DbServiceBunSqlite/index';

const dbService = new DbServiceBunSqlite(config);
await dbService.start();

const actorService = new ActorService({
  db: dbService.drizzle,
  sandboxRunner: hostProvidedSandboxRunner,
  // optional in tests/dev:
  // startSandbox: false,
  // autoStart: false,
});

await actorService.start();
```

In production, `ActorService.start()` should:

1. start/load the host supervisor
2. start the injected sandbox runner
3. let the worker poll durable workflow jobs
4. let the supervisor poll actor inbox/reconciliation work

To shut down:

```ts
await actorService.stop();
```

## Message flow

1. Product/API code inserts an `actor_inbox` row with `status = 'queued'`.
2. `ActorSupervisor` claims the inbox row.
3. Supervisor reads the actor instance + revision machine config.
4. Supervisor creates a durable workflow run for transition effects.
5. Sandboxed worker polls workflow tables and executes each step.
6. Supervisor reconciles completed workflow results back into `actor_instances`.
7. Supervisor commits `actor_outputs` and routes connected outputs into target actor inboxes.

## Testing/development

```ts
const service = new ActorService({
  db,
  workflowDb,
  startSandbox: false,
  autoStart: false,
});

await service.start();
await service.supervisor.runOnce();
```

Use an injected `sandboxRunner` to test sandbox startup without executing guest code on the host.

## Safety notes

- Do not import guest bundles directly into `ActorService` or `ActorSupervisor`.
- Host code may inspect manifests and machine config, but must not execute actor `fn/fx/tx` functions.
- The only path for guest function execution is the worker running inside the sandbox.
- Keep workflow and worker packages actor-agnostic.
