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
- [Redesign PRD](docs/PRD.md) defines the repository surface, public contracts,
  migration invariants, and fixed product decisions.
- [Widget system](docs/internal/llm.widget-system.md) defines widget artifacts,
  host bridges, and execution behavior.
- [Screen atlas](docs/internal/screens/SCREENS.md) defines existing product
  surfaces and visual baselines.

Use one exact Effect v4 version across the applications. Public package APIs
remain Effect-free and transport-neutral.

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

### `@omnidraw/sdk`

Is the only widget-authoring entrypoint. It owns the portable manifest,
artifact, guest ABI, widget state/resource/function contracts, and host bridge.
It encapsulates Capsule; widget source does not import Capsule or retired
Omnidraw packages directly.

### `@omnidraw/component-ai-chat`

Ships the reusable AI Chat component, injected contract, and narrow Canvas
extension. Authentication, persistence, provider, metering, and transport
implementations stay in applications.

### `@omnidraw/theme`

Owns public theme values, tokens, CSS, and theme application helpers. It does
not depend on a registry, lifecycle runtime, application, Canvas, or Effect.

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
durable Canvas or widget-state authority and does not run the backend DST
world.

One frontend connection multiplexes private typed RPC calls and streams over a
native WebSocket. Effect RPC owns physical connection retry. Domain adapters
own connection generations, resubscription, snapshot/cursor recovery,
idempotent replay decisions, stale-generation rejection, and cancellation.
Do not add PartySocket, the `ws` npm package, SSE, or EventSource.

## Persistence and authority

The OSS database schema and migration identity are fixed by the redesign. Do
not change a migration, table, index, constraint, or persisted-row layout for a
package move or Effect adoption. Raise a separate proposal only if required
behavior cannot be implemented through an adapter.

Canvas persistence is one JSONB `canvas_items` row per authored Canvas node.
The backend Canvas service is the only durable Canvas authority. The backend
widget-state service is the only widget-instance state authority. Browser
Canvas state is optimistic and reconciles with that authority.

Do not add repository-wide ambient declarations. Types belong in the nearest
owning module; runtime/build configuration belongs at an application shell
edge.

## Widget portability and trust

The same SDK widget source and canonical artifact must work in OSS and managed.
OSS runs widget server/function code as explicitly trusted local host code.
Managed runs untrusted builds, functions, and coding commands in Microsandbox
and records private usage evidence. Managed policy, billing, auth, sandbox, and
storage code never enters the public packages.

Capsule owns React, React DOM, Three, and other framework compatibility
evidence. Do not duplicate those fixtures in this repository.

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
