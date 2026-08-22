# Omnidraw

Run your real apps in an infinite drawing canvas, and generate apps with AI
using your existing code plan subscriptions.


## Quick start

The supported release workflow runs on Linux and macOS and requires:

- Bun `1.4.0` (the exact version declared by `packageManager`)

Clone, install from the committed public-npm lockfile, build once, and start the
already-built application:

```bash
git clone https://github.com/omnidraw/omnidraw.git
cd omnidraw
bun install --frozen-lockfile
bun run build
bun run start
```

When startup is ready, Omnidraw prints:

```text
Omnidraw is ready at http://127.0.0.1:7496/
```

Open that URL in a browser. The one Bun server serves the built SPA, HTTP API,
files, and WebSocket transport. Stop it gracefully with `Ctrl+C`.

`bun run start` never installs, compiles, stages packages, or invokes Vite. It
validates the existing build and fails with an instruction to run
`bun run build` when the build is missing or stale. Run `bun run build` again
after pulling updates or changing frontend/public-package source.

### Port and data overrides

The release server binds only to `127.0.0.1`. Override its port after the
script separator:

```bash
bun run start -- --port 8080
```

Omnidraw stores its database, configuration, widgets, and local resources in
`~/.omnidraw` by default. `OMNIDRAW_HOME` selects another home, and
`--data-dir` has higher precedence than the environment:

```bash
OMNIDRAW_HOME=/srv/omnidraw bun run start
bun run start -- --data-dir ./local-omnidraw-home
OMNIDRAW_HOME=/srv/omnidraw bun run start -- --data-dir ./preferred-home
```

Relative paths resolve from the repository root when invoked through the root
`start` script.

## Contributor workflow

Development is separate from the release workflow. After a frozen install,
run the development orchestrator:

```bash
bun install --frozen-lockfile
bun run dev
```

It watches source, uses the Vite frontend URL printed by the runner (normally
[http://127.0.0.1:3002](http://127.0.0.1:3002)), and stores development data at
`./.omnidraw/main.db`. The development backend normally uses port `3000`.

Useful source CLI commands are:

```bash
bun run apps/backend/src/main.ts --version
bun run apps/backend/src/main.ts --help
bun run apps/backend/src/main.ts canvas --help
bun run apps/backend/src/main.ts widget --help
```

Widget server and function code is trusted local code. Omnidraw may execute it
in disposable Bun children; this is not a hostile-code sandbox, so review and
trust widget code before running it.

## Repository layout

```text
apps/
  backend/             Bun source-run server, CLI, authorities, persistence,
                       trusted local widget execution, and simulation
  frontend/            Solid SPA, product UI, and browser adapters

packages/
  canvas-contract/     Serialized Canvas contract
  canvas/              Embeddable Canvas renderer
  sdk/                 Widget authoring and host bridge
  component-ai-chat/   Reusable AI Chat and Canvas extension
  theme/               Tokens, CSS, and theme helpers
```

## Test runners

The repository intentionally uses two runners. `bun test` owns backend,
contract, SDK, theme, transport, architecture, database, conformance, and pure
frontend tests. Vitest owns Solid component and browser-like DOM suites because
those packages use the same Vite transforms and jsdom setup as their builds.

Use the owning package's `bun run test` script instead of invoking a runner
against an arbitrary repository path. The root `bun run test` command composes
both runner families with type, package, database, and live-browser gates.

The order-7 performance workloads are separate from correctness gates:

```bash
bun run benchmark:order-7
```

For implementation conventions and deeper subsystem documentation, read:

- [`AGENTS.md`](AGENTS.md)
- [`docs/internal/llm.app-architecture.md`](docs/internal/llm.app-architecture.md)
- [`docs/internal/llm.widget-system.md`](docs/internal/llm.widget-system.md)
- [`docs/internal/screens/SCREENS.md`](docs/internal/screens/SCREENS.md)

## License

MIT. See [`LICENSE`](LICENSE).
