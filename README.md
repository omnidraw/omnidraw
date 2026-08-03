# Omnidraw

Run your agents in an infinite drawing canvas.

Runs completly local. Reuses your llm subscriptions.

The project is organized as a monorepo and follows a **Functional Core / Imperative Shell** architecture.

## Features

- Infinite canvas UI for drawing, selecting, transforming, and grouping elements
- Canvas CLI for list/query/add/patch/move/group/ungroup/delete/reorder flows
- Agents can edit canvases too by calling the same CLI commands
- Server-authoritative real-time canvas collaboration with atomic revisions
- Unified WebSocket API endpoint for canvas events and app RPC (`/api`)

## Quick Start

Omnidraw is currently run from source. Install Bun `1.3.14`, then run:

```bash
git clone https://github.com/omnidraw/omnidraw.git
cd omnidraw
bun install
bun run dev
```

Open the frontend URL printed by the development runner (by default
[http://127.0.0.1:3002](http://127.0.0.1:3002)).

For a production-style local run, build the workspace and start the single
Bun server:

```bash
bun run server:prod
```

This builds the frontend and serves its static SPA assets, API, WebSocket, and
file routes together at [http://localhost:7496](http://localhost:7496).

You can edit the canvas from the UI, or from the CLI. Agents can use the same canvas CLI surface for scripted canvas changes.

The Omnidraw skill for agents lives here:
- https://github.com/omnidraw/skills

Useful CLI commands during local development:

```bash
bun run apps/cli/src/main.ts --version
bun run apps/cli/src/main.ts --help
bun run apps/cli/src/main.ts canvas --help
```

## Database

- Omnidraw keeps one home at `~/.omnidraw`; its primary Turso database is `~/.omnidraw/main.db`.
- `--data-dir <path>` selects another home and takes precedence over `OMNIDRAW_HOME`.
- Relative overrides resolve once against the process working directory; `~` is not expanded in overrides.
- Legacy `OMNIDRAW_CONFIG`, `OMNIDRAW_DB`, and `XDG_*` variables no longer select application storage.
- Actor-era and unknown non-empty homes or databases are refused without mutation. Select a fresh home and archive old data manually.
- The strict baseline schema is `packages/service-db/src/migrations/000-initial.sql`.

## Debugging the live app

The canvas runtime includes a built-in debug logger that can be enabled per plugin or per service from the browser devtools console.

Debug keys use this format:

```txt
omnidraw:debug:<plugin|service>:<name>
```

Levels:
- `0`, `false`, `off`, or empty = disabled
- `1` = important lifecycle logs
- `2` = more detailed state/layout logs
- `3` = very noisy per-frame/per-event logs

Examples:

```js
// hosted component plugin logs
localStorage.setItem("omnidraw:debug:plugin:hosted-component", "3")

// camera service logs
localStorage.setItem("omnidraw:debug:service:camera", "1")
```

Then reload the page and inspect the browser console.

To turn a target back off:

```js
localStorage.setItem("omnidraw:debug:plugin:hosted-component", "0")
```

Current log output includes prefixes like:

```txt
[omnidraw][plugin:hosted-component][L2] ...
```

This is especially useful for debugging live layout, overlay, hydration, transform, and mount issues inside the running app.

## Contributing

Contributions are welcome.

**By submitting a pull request, you agree to transfer ownership of your contribution to the project maintainer.** This allows the project to be re-licensed or otherwise managed without needing to contact every individual contributor.

Recommended workflow:
1. Create a branch from `main`.
2. Make focused changes with tests.
3. Run relevant checks (`bun test`, package-specific tests, and build checks if needed).
4. Open a pull request with a clear summary.

For implementation conventions and deeper subsystem docs, read:
- [`AGENTS.md`](AGENTS.md)
- [`docs/internal/llm.architecture.md`](docs/internal/llm.architecture.md)
- [`docs/internal/llm.widget-system.md`](docs/internal/llm.widget-system.md)
- [`docs/internal/screens/SCREENS.md`](docs/internal/screens/SCREENS.md)

## License

MIT. See `LICENSE`.
