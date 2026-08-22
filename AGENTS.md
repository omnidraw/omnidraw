# Omnidraw repository guide

Omnidraw is an OSS monorepo with two private applications and five public
packages.

```text
apps/
  backend/             Bun server, source-run CLI, authorities, persistence,
                       trusted local execution, Effect runtime, and DST
  frontend/            Solid SPA, product UI, and browser-side adapters

packages/
  canvas-contract/     @omnidraw/canvas-contract
  canvas/              @omnidraw/canvas
  sdk/                 @omnidraw/sdk
  component-ai-chat/   @omnidraw/component-ai-chat
  theme/               @omnidraw/theme
```

Private product code belongs in the owning application. Do not create another
workspace package to share private code. Small generic helpers may be
duplicated when that keeps the public surface smaller and ownership clearer.

## Architecture authorities

Read these before changing application architecture or Effect code:

- [Application architecture](docs/internal/llm.app-architecture.md) is the
  authority for core, shell, simulation, conformance, runtime ownership, and
  deterministic simulation testing.
- [Effect v4 guide](docs/external/llm.effect.md) is the local API and usage
  reference. Follow it instead of relying on Effect v3 knowledge.
- [PRD](docs/PRD.md) defines the repository surface, public contracts,
  replacement policy, and fixed product decisions.
- [Widget system](docs/internal/llm.widget-system.md) defines widget artifacts,
  host bridges, and execution behavior.

Use exact `effect@4.0.0-rc.108` across the applications and every public package
that owns complex side effects, concurrency, streaming, cancellation, retries,
or resource lifetime. Public package APIs remain Effect-free and
transport-neutral.

## Public package boundaries

### `@omnidraw/canvas-contract`

Owns the complete serialized Canvas document, commands, queries, snapshots,
events, versions, schemas, validation, and canonical codecs. It contains no
authority, reducer, storage, rendering, Cangine, Theme, Solid, Effect, or
transport implementation, including type-only dependencies on them.

### `@omnidraw/canvas`

Renders one Omnidraw Canvas. It owns the browser document client, optimistic
state, Cangine adapter, and Canvas UI. The host injects document transport,
theme, widget, media, notification, ID, timing, diagnostics, and lifecycle
capabilities. Canvas never imports an application.

Canvas owns complex asynchronous state and lifecycle, so it uses exact
`effect@4.0.0-rc.108` internally without exposing Effect types.

### `@omnidraw/sdk`

Is the only widget-authoring entrypoint. It owns the portable manifest,
artifact, guest ABI, local-state/resource/function contracts, and host bridge.
It encapsulates Capsule; widget source does not import Capsule or retired
Omnidraw packages directly.

The SDK also owns one fixed, host-neutral Omnidraw server-module ABI. The
canonical server module is neither Bun code nor a deployable Cloudflare Worker.
OSS loads those exact module bytes locally; the private managed adapter may
place the same bytes beside a generated Workers for Platforms wrapper, but it
must not rewrite or rebuild them or change their canonical artifact digest.

SDK paths that own asynchronous builds, guest channels, cancellation, or scoped
host resources use exact `effect@4.0.0-rc.108` internally.

### `@omnidraw/component-ai-chat`

Ships the reusable AI Chat component, injected contract, and narrow Canvas
extension. Authentication, persistence, provider, metering, and transport
implementations stay in applications.

AI Chat uses exact `effect@4.0.0-rc.108` internally for streaming,
cancellation, and lifecycle while its injected contract remains Effect-free.

### `@omnidraw/theme`

Owns public theme values, tokens, CSS, and theme application helpers. It does
not depend on a registry, lifecycle runtime, application, Canvas, or Effect.

### Effect rule for public packages

Pure contracts, schemas, codecs, validation, and small synchronous adapters do
not add Effect merely for uniformity. Complexity plus side effects does require
Effect: asynchronous state machines, concurrent work, streams, retries,
cancellation, scoped resources, or lifecycle orchestration use exact
`effect@4.0.0-rc.108` internally. Effect-owned types never cross a public API.

## Backend architecture

`apps/backend/src` is split by responsibility:

```text
core/          domain values, pure policy, typed failures, semantic services,
               and lazy Effect programs
shell/         live Layers, database/provider/protocol adapters, server and CLI
               edges, concrete configuration, and ManagedRuntime ownership
sim/           controlled Layers, virtual time, seeded scheduling, faults,
               logical nodes, trace capture, and replay
conformance/   scenarios that run unchanged against live and simulated Layers
```

The dependency direction is `core <- shell`, `core <- sim`, and
`core <- conformance`. Core never imports shell, sim, or conformance. Shell
never imports sim. Runtime edges execute programs; core only describes them.

### Functional core file roles

- `fn.*.ts` exports deterministic, state-free policy functions. Inputs are
  explicit. It does not import Effect runtime values or touch the world.
- `fx.*.ts` exports lazy read programs. A program takes zero arguments or one
  required `args` value, is not `async`, and explicitly returns
  `Effect.Effect<A, E, R>` through semantic services.
- `tx.*.ts` has the same program shape for writes and mutations. Atomicity,
  idempotency, acknowledgement, and transaction semantics belong in the
  service contract.

Do not reintroduce `portal` parameters, fixed two-argument helper signatures,
filename-based runtime-import allowlists, or ambient-global fallbacks. These
were properties of the retired functional-core tooling, not the Effect v4
architecture.

Shell adapters own database engines, SQL, filesystems, providers, WebSocket,
frameworks, configuration, and process/browser globals. Supply world handles
explicitly when constructing adapters; never make omission fall back silently
to an ambient live dependency.

Every production/simulation pair implements the same semantic service and
passes the same conformance suite. Simulation must prevent real time, entropy,
network, host microtasks, uncontrolled driver completion, or module-global
state from choosing observable order.

## Frontend architecture

`apps/frontend` keeps deterministic UI policy separate from browser and
transport mechanics. The frontend owns product composition, navigation,
sidebars, browser clients, and adapters for Canvas and AI Chat. It does not own
durable Canvas authority and does not run the backend DST world.

One frontend connection multiplexes private typed RPC calls and streams over a
native WebSocket. Effect RPC owns physical connection retry. Domain adapters
own connection generations, resubscription, snapshot/cursor recovery,
idempotent replay decisions, stale-generation rejection, and cancellation.
Do not add PartySocket, the `ws` npm package, SSE, or EventSource.

## Persistence and authority

This refactor has zero migration and compatibility support. Replace the
pre-refactor database and initialize the redesigned schema from scratch. Do not
add old-schema readers, data converters, dual reads, dual writes, compatibility
tables, legacy fingerprints, or migration commands.

Canvas persistence is one JSONB `canvas_items` row per authored Canvas node.
The backend Canvas service is the only durable Canvas authority. Widgets have
no shared widget-instance state authority; Capsule local-store values are
mount-local and ephemeral. Browser Canvas state is optimistic and reconciles
with the Canvas authority.

Do not add repository-wide ambient declarations. Types belong in the nearest
owning module; runtime/build configuration belongs at an application shell
edge.

## Widget portability and trust

The same SDK widget source and canonical artifact must work in OSS and managed.
OSS runs widget server/function code as explicitly trusted local host code in a
disposable Bun child. Managed invokes those functions only as Workers for
Platforms user Workers. A widget function never runs in Cloudflare Sandbox, a
Container, a Durable Object, or the managed chat/build sandbox. Managed may use
Microsandbox for coding and build work, but that is a separate execution path.

Capsule is exclusively the browser UI sandbox; it never executes widget server
functions. Dispatch namespaces, generated Worker wrappers and uploads,
outbound-worker policy, Cloudflare bindings, Turso credentials, authentication,
tenant identity, metering, billing, plan enforcement, and managed usage
evidence stay in the private managed repository. OSS contains no cloud
executor, remote Turso fallback, per-user/monthly quota, billing-plan limit,
cost-model workload bound, or managed sandbox-minute allowance.

The generated user-Worker wrapper is an untrusted-realm trampoline and holds
no Turso credential, tenant secret, or write-permit authority. A separately
trusted service-bound broker owns those values. The outbound Worker denies
public egress. Cloudflare KV is not a valid implementation of the portable
revision/CAS contract; managed KV, secret, and database calls require strongly
consistent broker storage. Module evaluation lifetime is not widget ABI, so
portable functions never depend on observable module-scope mutation.

OSS qualification proves the portable SDK contract and local adapter only. A
private release gate must consume the exact SDK version named by
`public-package-set.json`, deploy the generated wrapper through a real Workers
for Platforms dispatch namespace, run the same conformance against Turso, and
prove that widget code has no outbound or host-OS authority.

Capsule owns React, React DOM, Three, and other framework compatibility
evidence. Do not duplicate those fixtures in this repository.

## Widget debugging CLI

Use the source-run `omnidraw widget` CLI to discover, validate, and inspect an
existing local widget draft through the already-running backend. From the
repository root, invoke it as
`bun run apps/backend/src/main.ts widget <list|resolve|validate|inspect>` and
pass `--port` when the server is not on the default port. Use `--help` on a
subcommand for its complete flags.

The supported repair loop is `list` or exact `resolve`, edit the returned draft,
`validate`, then `inspect`. A portable SDK `check` or `build` is useful offline
evidence, but it does not prove host acceptance. `validate` performs the
host-owned accepted-generation build. `inspect` never builds implicitly: carry
its exact draft digest, accepted generation, and build identity from the
validation result.

Use `inspect --mode artifact` for isolated accepted-artifact evidence and
`inspect --mode preview` for manifest-bound diagnostic-clone runtime evidence.
The clone is not the visible Canvas frame; optional `--canvas` correlation does
not create or mutate one. Protected or unclear writes fail closed because this
CLI has no approval coordinator. Prefer `--json` for automation, and treat an
optional verified PNG as evidence rather than the success criterion. The CLI
must remain an RPC client of the running backend; do not make it open storage or
construct another catalog, build, Preview, browser, or application runtime.

## Package publishing

The `version` field in a package's own `package.json` is its release marker.
Only the five public packages may have package-level versions or be selected by
release tooling. Applications are private and unversioned.

Workspace manifests may use `workspace:*` and `catalog:`. A public package
build must stage a standalone `dist/` package whose generated manifest resolves
internal dependencies to exact package versions and catalog dependencies to
public registry ranges. Publish only `./dist`, never the workspace root. Never
overwrite or republish an existing version.

Changes to public runtime code under `src/` require a semantic version bump and
lockfile regeneration. Tests, docs, scripts, metadata, build configuration,
and packaging-only changes do not by themselves justify a version bump.

Retired package names, including `@omnidraw/tenant-core`, must never be
reintroduced or republished.

Never change the package version yourself. If you think a version change is
needed. Ask for confirmation first.

## Repository workflow

- Use `rg` and `rg --files` for discovery. There is no generated repository
  file index.
- Use [tasks/BASED.md](tasks/BASED.md) when creating an implementation task
  plan. Consider a mockup only when visual behavior changes, and consult the
  screen atlas first.
- Keep explanations simple and direct. Lead with what changed, why it matters,
  and what the next action is.
- Preserve unrelated worktree changes. Do not overwrite user-owned edits.

## Vendored reference repositories

`repos/effect` is the vendored Effect source and documentation reference.

- Treat vendored references as read-only.
- Never modify files under `repos/` unless explicitly asked to update the
  vendored reference.
- Do not copy a reference implementation verbatim into production code.
- Use references to understand patterns, then implement the smallest solution
  that fits Omnidraw's contracts and conventions.
- When referencing vendored findings in a task or review, record the upstream
  repository and relevant path or commit.

- `repos/effect`
