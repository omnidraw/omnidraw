Monorepo Vibecanvas:

apps/frontend -> solidjs spa, renders webpage
apps/web -> github pages, marketing website
apps/server -> bun server
apps/vibecanvas -> installable binary for npm package

packages/canvas -> canvas core logic, konvajs, automerge
packages/core-contract -> orpc api design, websocket first
packages/functional-core -> shared logic, types, utils
packages/imperative-shell -> stateful services, db, crdt, pty, fs

We use @tasks/BASED.md to manage our work.
When you are tasks to generate new task plans. Think if a mockup img is useful.
When you have a skill to generate images use it. Orient yourself with what we already have in SCREENS.md

Notes:
- Root `package.json` has a `postinstall` hook for `scripts/patch-automerge-repo-throttle.mjs`.
- Script patches installed `@automerge/automerge-repo` throttle helpers under `node_modules/.bun`.
- Patch clamps negative timeout delays with `Math.max(0, wait)`.
- Reason: upstream package can emit `TimeoutNegativeWarning` in dev/runtime.
- Do not remove unless upstream fix is verified and hook is removed on purpose.

## Functional Core Directive

We want as much code as possible to be simple functions.

Goal:
- separate logic from state
- keep business rules in small boring functions
- push mutable state and side effects to edges
- make code easier to test, move, and reuse

Folder rule:
- use `/core` within a package for shared functions and shared logic-first code
- do not move everything into `/core` by default
- when logic is local to one feature or plugin, prefer sibling `fn.*.ts`, `fx.*.ts`, and `tx.*.ts` files next to the orchestrating file
- if package structure needs it, `/core` may live inside a subfolder instead
- only do nested `/core` folders when complexity is high and locality is better
- use one `CONSTANTS.md` file per folder when needed.
- use one `typed.ts` and or `interface.ts` file per folder only for reusable typings
- `CONSTANTS.ts` is allowed to be imported by local `fn.*.ts`, `fx.*.ts`, and `tx.*.ts` files
- `types.ts` and `interface.ts` are allowed to be imported by local `fn.*.ts`, `fx.*.ts`, and `tx.*.ts` files
- always put local TPortal* TArgs* types locally
- always omit suffix in TPortal* TArgs* if you have only one function to export

Local split rule:
- keep orchestration-heavy files as the main local file when that shape fits the feature, for example plugin files like `Grid.plugin.ts`
- move pure local logic into sibling `fn.*.ts` files
- move impure read helpers into sibling `fx.*.ts` files
- move impure write helpers into sibling `tx.*.ts` files
- use `CONSTANTS.ts` for local shared constants that are not themselves function files
- prefer local sibling split over creating a shared `/core` module when the logic is only used by that folder
- example: `Grid.plugin.ts` may orchestrate behavior while `fn.math.ts`, `tx.draw.ts`, and `CONSTANTS.ts` hold outsourced local pieces by role

Bias:
- prefer extracting logic out of UI, services, transport, and stateful orchestration files
- prefer local sibling `fn/fx/tx` files for feature-local logic
- prefer `/core` only when logic is shared across features or packages
- prefer simple functions over classes and hidden state
- if unsure, choose simpler split: orchestration in the local file, logic in typed function files

## File Type Rules

Print and follow these rules when working on function files.
Do not guess. Use these rules.

### fn.*.ts
- ignore `fn.*.test.ts` files
- exported functions must start with `fn`
- imports must be type-only unless imported module leaf starts with `fn.`, `fx.`, `tx.`, or is exactly `CONSTANTS`
- `CONSTANTS.ts` imports are allowed for shared local constants
- no direct use of runtime globals like `window`, `fetch`, `Bun`, `process`, `console`, `globalThis`
- do not export classes or other runtime values; only functions and types
- fn is for pure functions
- keep fn logic deterministic and state-free

### Direct runtime global blocking
- block free runtime global usage like `crypto.randomUUID()`, `window.location`, `fetch(...)`, `process.env`, `console.log(...)`
- allow type-only references like `typeof crypto`, `typeof window`, `Request`, `Response` when they are only used in type positions
- allow injected access like `portal.crypto.randomUUID()` and `portal.window.location`
- allow portal field typing like `crypto: typeof crypto` and `window: typeof window`
- rule is about direct runtime global access, not about naming a portal field or using the global in a type-only annotation

### fx.*.ts
- ignore `fx.*.test.ts` files
- exported functions must start with `fx`
- imports must be type-only unless imported module leaf starts with `fn.`, `fx.`, or is exactly `CONSTANTS`
- `CONSTANTS.ts` imports are allowed for shared local constants
- no direct use of runtime globals like `window`, `fetch`, `Bun`, `process`, `console`, `globalThis`
- do not export classes or other runtime values; only functions and types
- every `fx*` function must have exactly 2 params
- first param must be named `portal` and typed as `TPortal*`
- second param must be named `args` and typed as `TArgs*`
- `TPortal` may hold side effects and mutable services objects
- `TArgs` is usually serializable payload data
- fx is for impure reads; use brain and prefer tx for impure writes

### tx.*.ts
- ignore `tx.*.test.ts` files
- exported functions must start with `tx`
- imports must be type-only unless imported module leaf starts with `fn.`, `fx.`, `tx.`, or is exactly `CONSTANTS`
- `CONSTANTS.ts` imports are allowed for shared local constants
- no direct use of runtime globals like `window`, `fetch`, `Bun`, `process`, `console`, `globalThis`
- do not export classes or other runtime values; only functions and types
- every `tx*` function must have exactly 2 params
- first param must be named `portal` and typed as `TPortal*`
- second param must be named `args` and typed as `TArgs*`
- `TPortal` may hold side effects and mutable services objects
- `TArgs` is usually serializable payload data
- tx is for impure writes; use brain and prefer tx when code changes external world state
- tx may runtime-import `fn.*`, `fx.*`, `tx.*`, and `CONSTANTS`

## IMPORTANT
All files are indexed in `@FILES.md`. Read if you need overview.

## Refs (Only read when needed)
UI overview: docs/internal/screens/SCREENS.md

docs/internal/llm.migrate-turso.md
docs/internal/llm.widget-system.md
