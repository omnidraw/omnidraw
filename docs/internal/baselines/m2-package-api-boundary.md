# M2 package and API boundary evidence

> Historical snapshot: this file records the M2 architecture when captured.
> The later S107 and S116 subtractions removed `service-actor`,
> `ui-actor-legacy`, and Automerge. References below are evidence of that
> earlier milestone, not the current package map.

M2 replaces the nine transport packages with one consolidated API boundary, gives both UI packages architecture-accurate names, extracts reusable widget-host logic into the canvas package, and establishes the small versioned contracts consumed by later managed-service milestones.

## Consolidated API contract

- `@vibecanvas/api` owns the aggregate context, contract, handlers, router, and domain exports.
- The compatibility contract retains the exact ordered route keys `actors`, `agent`, `canvas`, `db`, `file`, `filesystem`, `notification`, `pty`, and `tool`.
- A direct route fingerprint proves all 131 existing method/path pairs remain implemented.
- Target-layout `collaboration` and `media` exports alias the current `db` and `file` compatibility domains; `function` is an explicit no-route placeholder until M6.
- Context declarations use narrow structural capabilities. They contain no `ActorService`, `AgentService`, or `DbServiceTurso` types, and a fake-only composition test boots the complete router and executes a handler without constructing Turso or an actor.
- `orpc-client`, CLI, frontend, tests, workspace dependencies, root filters, and live repository instructions now consume only `@vibecanvas/api` and its subpaths.
- The nine `packages/api-*` directories were removed only after the required live-reference search returned empty.

## UI and host boundary

- `packages/actor-ui` is now `packages/ui-actor-legacy` / `@vibecanvas/ui-actor-legacy`.
- `packages/ai-chat` is now `packages/ui-ai-chat` / `@vibecanvas/ui-ai-chat`.
- Twelve backend-neutral widget-host files (1,521 lines) moved to `packages/canvas/src/widget-host`; the former UI import paths are one- or two-line compatibility re-exports.
- The widget-host boundary test rejects API, actor-service, and UI dependencies from the extracted host.
- The four actor-view screenshot files retain byte-identical SHA-256 digests across the rename.

## Public contracts and dependency direction

Four versioned `0.1.0` public packages now define implementation-neutral seams:

| Package | Boundary established in M2 |
| --- | --- |
| `tenant-core` | Immutable tenant/placement types, scoped keys, context-provider and placement-directory interfaces |
| `resource-runtime` | Logical resource requirements, gateway/provider/binding/use capabilities, write-fence helpers |
| `widget-contract` | Manifest v2, immutable revision/artifact descriptors and reader capabilities |
| `function-runtime` | Function/invocation/attempt/lease/usage types and registry, store, scheduler, sandbox, resource, and usage interfaces |

`service-event-publisher` now owns its transport-neutral event contracts. No service package, `function-runtime`, or `resource-runtime` imports any API package.

## Verification

| Check | Result |
| --- | --- |
| Old API package/import search | Empty across `apps`, `packages`, root package manifest, and `bun.lock` |
| Service-to-API import search | Empty reviewed allowlist |
| Consolidated API | 30 tests passed, 134 assertions; exact 9-route/131-procedure equivalence and fake composition |
| Public contract packages and event publisher | 13 tests passed, 30 assertions; all five typechecks passed |
| Preserved UI/renderer behavior | `ui-ai-chat` 184 tests, `ui-actor-legacy` 16 tests, canvas 200 tests, frontend 29 tests |
| Type boundary | API, ORPC client, CLI, frontend, canvas, both UI packages, public contracts, event publisher, and affected service packages typecheck |
| Common repository gate | `git diff --check`, functional-core lint, and full root test suite passed |
| Release build | Four executable targets and SPA assets built successfully |
| Compiled binary | Native addon, actor IPC, old-home refusal, prerequisites, HTTP assets, API/Automerge WebSockets, managed schema, data-root precedence, fallback port, and shutdown all passed |

The Automerge throttle postinstall patch remains installed and was reported already patched by `bun install`.
