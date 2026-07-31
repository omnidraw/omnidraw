# apps/cli

`apps/cli` is the composition root for the Omnidraw CLI and Bun server.

It owns:

- argument parsing and fully resolved configuration;
- runtime and plugin composition;
- stateful server-service construction;
- final shutdown and process exit behavior.

Plugins orchestrate commands and protocols. Services own I/O, mutable runtime
state, and external resources.

## Canvas authority

The server registers `CanvasService` and `WidgetStateService`.

- `CanvasService` is the only durable and semantic canvas authority.
- `canvas_items` contains one JSONB row per authored Cangine node.
- `WidgetStateService` owns versioned JSON state for active widget instances.
- the oRPC WebSocket endpoint is the only live canvas and widget-state
  transport.
- canvas CLI commands are remote clients of that same endpoint; they never
  open the application database directly.

Canvas writes must use stable command IDs, item/path preconditions, and the
shared `@omnidraw/canvas-contract` command vocabulary. A successful command
commits exactly one canvas revision before it is published.

## Bootstrap and shutdown

The main flow is:

1. parse arguments;
2. build a resolved `ICliConfig`;
3. handle early help/version output;
4. construct server services when serving;
5. create and boot the runtime;
6. shut down all services before a one-shot command exits.

Command wrappers print their result and set `process.exitCode`. They must not
call `process.exit()` before runtime shutdown.

## Configuration

Validate paths and configuration before importing or creating stateful
services. The CLI owns values such as `port`, `dbPath`, `configPath`,
`dataPath`, and `cachePath`.

## Testing

Use process-level tests for boot, signals, server lifecycle, database
persistence, and remote CLI behavior. Use in-process tests for pure parsing,
command compilation, and plugin orchestration.

High-value integration coverage includes:

- empty-database boot and schema verification;
- canvas create/query/command/delete over oRPC;
- a CLI mutation observed by an already-subscribed client;
- revision conflict and precondition behavior;
- exact widget-instance authorization and centralized state CAS;
- orderly subscriber, service, database, and process cleanup.
