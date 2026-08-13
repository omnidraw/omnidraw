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

## Test runners

The repository intentionally uses two runners. `bun test` owns backend,
contract, SDK, theme, transport, architecture, database, conformance, and pure
frontend tests. Vitest owns Solid component and browser-like DOM suites because
those packages use the same Vite transforms and jsdom setup as their builds:
`apps/frontend`, `packages/canvas`, and `packages/component-ai-chat` invoke it
from their package scripts.

Use the owning package's `bun run test` script instead of invoking a runner
against an arbitrary repository path. The root `bun run test` command composes
both runner families with type, package, database, and live-browser gates. The
runner split is about environment ownership, not two levels of correctness;
moving a test requires moving its environment setup and package script in the
same change.

The order-7 performance workloads are separate from correctness gates so timing
variance cannot make CI flaky. Run them explicitly with:

```bash
bun run benchmark:order-7
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
