# apps/cli

`apps/cli` is the runtime home for Vibecanvas CLI + server boot.

It is the app entrypoint layer.
It owns:
- CLI parsing
- runtime boot
- plugin composition
- final shutdown / exit behavior

## Core rule

- **plugins contain logic and composition**
- **services do I/O / networking / resource management**

Short:
- plugin = orchestration / wiring / command behavior
- service = stateful capability / side effect boundary

## Plugin vs service

### Plugins
Plugins:
- decide how app is assembled
- depend on services
- tap hooks
- read config
- coordinate multiple services

Plugins should contain logic like:
- command handling
- route/protocol composition
- lifecycle orchestration
- conditional behavior from config

Examples in `apps/cli`:
- `CliPlugin`
- `ServerPlugin`
- `OrpcPlugin`
- `AutomergePlugin`

### Services
Services:
- perform I/O
- manage external resources
- manage stateful runtime capabilities
- expose methods to plugins

Examples:
- automerge service
- event publisher service

## Runtime ownership

`@vibecanvas/runtime` is generic.
It provides:
- `IPlugin`
- `IPluginContext`
- `IServiceMap`
- `IServiceRegistry`
- `createServiceRegistry()`
- `createRuntime()`
- `topoSort()`

It does **not** provide CLI semantics.

`apps/cli` owns:
- `ICliConfig`
- `ICliHooks`
- `createCliHooks()`
- `bootCliRuntime()`
- `shutdownCliRuntime()`

Keep CLI semantics here.
Do not push them back into runtime package.

## Bootstrap flow

Current `src/main.ts` flow:

1. parse argv
2. build fully resolved `ICliConfig`
3. handle early `--help` / `--version`
4. set quiet env flags for canvas commands
5. create foundational services with `setupServices()`
6. create runtime
7. boot runtime
8. if command is not `serve`, shutdown runtime and exit with `process.exitCode`

Current bootstrap files:

```text
src/
  parse-argv.ts
  build-config.ts
  setup-services.ts
  setup-signals.ts
  hooks.ts
  main.ts
```

## Important: command exit behavior

For one-shot commands like:
- `canvas ...`
- `upgrade`

we do **not** call `process.exit()` deep inside command wrappers anymore.

Instead:
- wrapper prints result or error
- wrapper sets `process.exitCode`
- control returns to `main.ts`
- `main.ts` runs `await runtime.shutdown()`
- then `main.ts` does final `process.exit(process.exitCode ?? 0)`

Current pattern in `main.ts`:

```ts
if (config.command !== 'serve') {
  await runtime.shutdown();
  process.exit(process.exitCode ?? 0);
}
```

Why this matters:
- direct `process.exit()` is too blunt
- it skips runtime shutdown
- it can leave Automerge / ws resources alive
- it can return before persisted writes are durable

Rule:
- wrappers print + set exit code
- `main.ts` owns final shutdown + final exit

## Config ownership

`apps/cli` owns config.

`ICliConfig` should be fully resolved before runtime creation.

That means values like these should already be set:
- `port`
- `dbPath`
- `configPath`
- `dataPath`
- `cachePath`

## Hooks usage

CLI hooks are app-local lifecycle / transport hooks:
- `boot`
- `ready`
- `shutdown`
- `httpRequest`
- `wsUpgrade`
- `wsOpen`
- `wsMessage`
- `wsClose`
- `registerCommands`

Use hooks for runtime coordination.
Do **not** use hooks when a normal service method is clearer.

## Runtime modes

### `serve`
Long-lived mode.

Runtime stays up.
Plugins own server / ORPC / websocket behavior.
Signals trigger shutdown.

### `canvas` and `upgrade`
Short-lived mode.

These still boot runtime first.
They run through normal services.
Then they shutdown runtime and exit.

Important current fact:
- `canvas` commands do **not** bypass runtime boot anymore
- they are dispatched by `CliPlugin` from the `ready` hook

## Canvas CLI structure

Canvas CLI code lives under:

```text
src/plugins/cli/
  bootstrap.ts
  cmds/
    cmd.canvas.ts
    cmd.list.canvas.ts
    cmd.query.canvas.ts
    cmd.move.canvas.ts
    cmd.patch.canvas.ts
    cmd.group.canvas.ts
    cmd.ungroup.canvas.ts
    cmd.delete.canvas.ts
    cmd.reorder.canvas.ts
    fn.canvas-subcommand-inputs.ts
  core/
    fn.print-command-result.ts
    fn.build-rpc-link.ts
    fx.canvas.server-discovery.ts
```

This is current reality.
If older docs mention `src/plugins/cli/canvas/*`, that is stale.

## Responsibilities

### `bootstrap.ts`
Early CLI bootstrap helpers.

Important rule:
- fail **before** stateful db/automerge imports when `--db` is malformed

This keeps tests deterministic.

### `cmd.canvas.ts`
Canvas command gateway.

It:
- prints canvas help
- chooses safe-client vs local path
- routes to subcommand wrappers
- keeps dispatch centralized

### `cmd.<name>.canvas.ts`
Thin wrappers.

They should own:
- argv-to-input conversion
- help text
- text/json rendering
- stdin/file payload loading when needed
- error -> stderr mapping
- exit code setting

They should **not** own canvas semantics.

### `fn.canvas-subcommand-inputs.ts`
Typed argv normalization layer.

Keep it:
- explicit
- local
- boring

No clever parsing maze.

### `fn.print-command-result.ts`
Print helpers.

Important current rule:
- do **not** call `process.exit()` here
- print
- set `process.exitCode`
- return

Reason:
- graceful shutdown must still happen later in `main.ts`

## Shared command rule

`apps/cli` should not reimplement canvas logic.

Shared behavior belongs in:
- `packages/canvas-cmds`

CLI wrappers should mostly own:
- argv parsing
- help text
- stdout/stderr rendering
- file/stdin payload loading
- client vs local dispatch

If changing semantics for:
- selection
- query
- move
- patch
- delete
- reorder
- group
- ungroup

prefer updating `packages/canvas-cmds`.
Keep `apps/cli` thin.

## Safe-client vs local execution

Canvas commands can run two ways.

### Local path
Used when `--db` is passed.

Wrapper calls shared implementation directly with local:
- db service
- automerge service

This path is deterministic.
Tests mostly use this.

### Safe-client path
Used when `--db` is omitted and a local Vibecanvas server is discovered.

Wrapper:
- probes local server health
- builds ORPC safe client
- calls server command API

Rule:
- wrapper behavior should match local path
- output contract must stay stable

## Command output rule

For canvas CLI commands:
- human output goes to `stdout`
- machine-readable success goes to `stdout` as JSON with `--json`
- errors go to `stderr`
- failures set non-zero `process.exitCode`

Current state:
- `list` has stable text + JSON output
- `query` has stable text + JSON output
- mutation commands mainly use JSON contract in tests

Keep this stable.
Tests depend on exact shape.

## Persistence rule for mutating canvas commands

Mutating commands in `packages/canvas-cmds` must flush Automerge before returning success.

Current pattern after `handle.change(...)`:

```ts
await portal.automergeService.repo.flush([handle.documentId])
```

Why:
- CLI tests read persisted doc state in a fresh subprocess after command exits
- without flush, command may report success before sqlite-backed Automerge storage is durable

If adding a new mutating command:
1. mutate with `handle.change(...)`
2. flush
3. return success

## DB path rule

Important boundary:
- `dbPath` is CLI/bootstrap concern
- `dbPath` should not leak into `packages/canvas-cmds`

That means:
- CLI may print resolved db path where useful
- shared command package should stay unaware of CLI storage resolution details

## Deep import policy

Prefer deep imports for extracted packages.

Examples:
- `@vibecanvas/service-db/IDbService`
- `@vibecanvas/service-db/DbServiceBunSqlite`
- `@vibecanvas/canvas-cmds/cmds/tx.cmd.move`

Avoid introducing root barrels when package is meant to stay deep-import-only.

## Testing strategy

Active CLI test home:

```text
apps/cli/tests/cli/
```

Key files:

```text
harness.ts
harness.worker.ts
db-path.test.ts
list/cmd.list.test.ts
query/cmd.query.test.ts
query/cmd.query.filters.test.ts
move/cmd.move.test.ts
patch/cmd.patch.test.ts
delete/cmd.delete.test.ts
group/cmd.group.test.ts
ungroup/cmd.ungroup.test.ts
reorder/cmd.reorder.test.ts
```

### `harness.ts`
Creates isolated temp sandboxes.

It provides helpers to:
- create temp config/data/cache dirs
- initialize fresh sqlite db
- run real CLI entrypoint
- seed canvases and docs
- read persisted automerge docs back out

### `harness.worker.ts`
Does low-level sqlite/automerge fixture work in subprocesses.

Use this when tests need to:
- seed canvas rows
- seed persisted docs
- inspect persisted docs after command runs

### What to assert

Prefer end-to-end assertions on:
- exit code
- stdout
- stderr
- JSON payload stability
- persisted sqlite/automerge side effects

This catches real regressions.
It already caught shutdown / flush problems.

## When adding a new canvas command

Follow this order:

1. add shared execution in `packages/canvas-cmds`
2. add typed input builder in `fn.canvas-subcommand-inputs.ts` if needed
3. add `cmd.<name>.canvas.ts`
4. route it from `cmd.canvas.ts`
5. add subprocess tests in `apps/cli/tests/cli/<name>/`
6. make text output and JSON contract explicit
7. flush Automerge on mutation before success return

## Practical rules

1. If it manages a resource, it is probably a service.
2. If it coordinates behavior, it is probably a plugin.
3. Plugins may depend on services.
4. Services should not depend on plugins.
5. `main.ts` owns final shutdown and final exit.
6. Canvas semantics belong in `packages/canvas-cmds`.
7. Mutating commands must flush before returning.
8. Keep package boundaries explicit with deep imports.

## Good vs bad

### Good
- `main.ts` owns final shutdown and process exit
- `CliPlugin` dispatches commands from runtime
- `cmds/*` parse args and print
- `canvas-cmds` executes shared semantics
- subprocess tests verify real persisted behavior

### Bad
- calling `process.exit()` deep inside command wrappers
- duplicating canvas semantics in `apps/cli`
- skipping `repo.flush()` in mutating shared commands
- leaking db bootstrap details into shared command package
- testing helpers only and skipping subprocess assertions
