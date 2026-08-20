# Solid 2.0 RFCs

Local copy of [solidjs/solid `documentation/solid-2.0` on `next`](https://github.com/solidjs/solid/tree/next/documentation/solid-2.0). Filenames are prefixed `llm.` for this repo. `_template.md` is omitted. The cheatsheet is copied from `packages/solid/CHEATSHEET.md` on the same branch.

Temporary prerelease documentation for Solid 2.0. Treat **`llm.MIGRATION.md`** as the primary entrypoint for migrating apps; the RFCs below are deeper, topic-focused docs that may be folded into the main documentation over time.

**Overview:** [Solid 2.0 Proposed API Changes (HackMD)](https://hackmd.io/@0u1u3zEAQAO0iYWVAStEvw/SyXYy2swbg)

**Start here (migration guide):** [MIGRATION.md](llm.MIGRATION.md)

**Quick API reference:** [`llm.CHEATSHEET.md`](llm.CHEATSHEET.md) (lives inside `packages/solid/` so it ships with the `solid-js` npm package).

The RFCs below are **deep dives** on specific topic areas. Over time, it’s expected that the most important bits will be folded into the main docs; these are intentionally detailed and “proposal-shaped”.

---

## RFC index (12)

| #   | RFC                                                                                    | One-line summary                                                                                 |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 01  | [Reactivity, batching, and effects](llm.01-reactivity-batching-effects.md)                 | ownedWrite, strict top-level reads, flush, split effects, lazy memos, unobserved, onSettled      |
| 02  | [Signals, derived primitives, ownership, and context](llm.02-signals-derived-ownership.md) | Derived signal/store, createRoot dispose-by-parent, Context as Provider                          |
| 03  | [Control flow](llm.03-control-flow.md)                                                     | For/Repeat/Reveal, Show/Switch, Loading, Errored, dynamic, clientOnly                            |
| 04  | [Stores](llm.04-stores.md)                                                                 | draft-first setters, merge/omit, reconcile, projections (createProjection/createStore(fn)), deep |
| 05  | [Async data](llm.05-async-data.md)                                                         | Async in computations, isPending, latest, Loading `on` prop, transitions, ssrSource/deferStream  |
| 06  | [Actions and optimistic](llm.06-actions-optimistic.md)                                     | action (generator), createOptimistic / createOptimisticStore                                     |
| 07  | [DOM](llm.07-dom.md)                                                                       | HTML standards, class, booleans                                                                  |
| 08  | [Dev-mode diagnostics](llm.08-dev-diagnostics.md)                                          | All dev warnings/errors, diagnostic codes, programmatic API                                      |
| 09  | [TypeScript and JSX ownership](llm.09-typescript-jsx.md)                                   | Renderer-owned JSX namespaces, `jsxImportSource`, and core renderable types                      |
| 10  | [Server functions](llm.10-server-functions.md)                                             | `"use server"` runtime, response helpers, single-flight, GET/metadata/prepareRequest, validation |
| 11  | [Server components (experimental)](llm.11-server-components.md)                           | Functions returned from server functions; `dynamic` is the API; single-copy frame streams        |
| 12  | [SSR and the HTTP exchange](llm.12-ssr-http.md)                                            | Render entry points, streaming (`pipe`/`pipeTo`/`readable`), request event, httpStatus/httpHeader |
