# OmniDraw

Run your real apps in an infinite drawing canvas.
Generate apps with ai.
Reuses your llm subscriptions.

The project is organized as a monorepo and follows a **Functional Core / Imperative Shell** architecture.

## Quick Start

OmniDraw is currently run from source. Install Bun `1.3.14`, then run:

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

Useful CLI commands during local development:

```bash
bun run apps/cli/src/main.ts --version
bun run apps/cli/src/main.ts --help
bun run apps/cli/src/main.ts canvas --help
```

## Database

- Omnidraw keeps one home at `~/.omnidraw`; its primary Turso database is `~/.omnidraw/main.db`.
- In dev mode it the databas is in `/.omnidraw/main.db` local to the current folder.
- `--data-dir <path>` selects another home and takes precedence over `OMNIDRAW_HOME`.

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

For implementation conventions and deeper subsystem docs, read:
- [`AGENTS.md`](AGENTS.md)
- [`docs/internal/llm.architecture.md`](docs/internal/llm.architecture.md)
- [`docs/internal/llm.widget-system.md`](docs/internal/llm.widget-system.md)
- [`docs/internal/screens/SCREENS.md`](docs/internal/screens/SCREENS.md)

## License

MIT. See `LICENSE`.
