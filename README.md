# OmniDraw

Run your real apps in an infinite drawing canvas.
Generate apps with ai.
Reuses your llm subscriptions.

The project is organized as a monorepo with a deterministic functional core
and Effect-owned application shells.

```text
apps/
  backend/             Bun source-run server and CLI, authorities, persistence,
                       trusted local widget execution, and simulation
  frontend/            Solid SPA, product UI, and browser adapters

packages/
  canvas-contract/     Serialized Canvas contract
  canvas/              Embeddable Canvas renderer
  sdk/                 Widget authoring and host bridge
  component-ai-chat/   Reusable AI Chat and Canvas extension
  theme/               Tokens, CSS, and theme helpers
```

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

You can edit the canvas from the UI or CLI. Agents can use the same Canvas CLI
surface for scripted changes.

Useful CLI commands during local development:

```bash
bun run apps/backend/src/main.ts --version
bun run apps/backend/src/main.ts --help
bun run apps/backend/src/main.ts canvas --help
```

## Database

- Omnidraw keeps one home at `~/.omnidraw`; its primary Turso database is `~/.omnidraw/main.db`.
- `bun run dev` uses `./.omnidraw/main.db` in the repository checkout.
- `--data-dir <path>` selects another home and takes precedence over `OMNIDRAW_HOME`.

For implementation conventions and deeper subsystem docs, read:

- [`AGENTS.md`](AGENTS.md)
- [`docs/internal/llm.app-architecture.md`](docs/internal/llm.app-architecture.md)
- [`docs/internal/llm.widget-system.md`](docs/internal/llm.widget-system.md)
- [`docs/internal/screens/SCREENS.md`](docs/internal/screens/SCREENS.md)

## License

MIT. See `LICENSE`.
