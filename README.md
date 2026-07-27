# Vibecanvas

Run your agents in an infinite drawing canvas.

Runs completly local. Reuses your llm subscriptions.

![Vibecanvas screenshot](./apps/web/public/seo.png)

The project is organized as a monorepo and follows a **Functional Core / Imperative Shell** architecture.

## Features

- Infinite canvas UI for drawing, selecting, transforming, and grouping elements
- Canvas CLI for list/query/add/patch/move/group/ungroup/delete/reorder flows
- Agents can edit canvases too by calling the same CLI commands
- Real-time CRDT sync with Automerge for conflict-free collaboration
- Unified WebSocket API endpoint for app RPC (`/api`)
- Dedicated Automerge sync endpoint (`/automerge`)
- Native binary distribution for macOS, Linux, and Windows
- Auto-update checks in the CLI/server runtime

## Quick Start

### Install globally

```bash
# bun
bun add -g vibecanvas

# npm
npm i -g vibecanvas

# pnpm
pnpm add -g vibecanvas

# yarn
yarn global add vibecanvas
```

Then run:

```bash
vibecanvas
```

Open [http://localhost:7496](http://localhost:7496) to use the app.

You can edit the canvas from the UI, or from the CLI. Agents can use the same canvas CLI surface for scripted canvas changes.

The Vibecanvas skill for agents lives here:
- https://github.com/vibecanvas/skills

For common setup/runtime questions, see the FAQ:

- https://vibecanvas.dev/docs/faq

### Upgrade vibecanvas

Vibecanvas includes a built-in upgrade command from the server CLI (`apps/server/src/main.ts`).

```bash
# check for updates and install
vibecanvas upgrade

# check only (no install)
vibecanvas upgrade --check
```

Useful related commands:

```bash
vibecanvas --version
vibecanvas --help
vibecanvas canvas --help
```

### Uninstall

```bash
# bun
bun remove -g vibecanvas

# npm
npm uninstall -g vibecanvas

# pnpm
pnpm remove -g vibecanvas

# yarn
yarn global remove vibecanvas
```

To remove the curl-installed binary and local Vibecanvas config/data/state/cache:

```bash
vibecanvas uninstall --dry-run
vibecanvas uninstall --yes
```

Also remove any PATH line you added for `~/.vibecanvas/bin` in your shell profile (`~/.zshrc`, `~/.bashrc`, `~/.profile`, or fish config).

## Database

- Vibecanvas keeps one home at `~/.vibecanvas`; its primary Turso database is `~/.vibecanvas/main.db`.
- `--data-dir <path>` selects another home and takes precedence over `VIBECANVAS_HOME`.
- Relative overrides resolve once against the process working directory; `~` is not expanded in overrides.
- Legacy `VIBECANVAS_CONFIG`, `VIBECANVAS_DB`, and `XDG_*` variables no longer select application storage.
- Actor-era and unknown non-empty homes or databases are refused without mutation. Select a fresh home and archive old data manually.
- The strict baseline schema is `packages/service-db/src/migrations/000-initial.sql`.

## Debugging the live app

The canvas runtime includes a built-in debug logger that can be enabled per plugin or per service from the browser devtools console.

Debug keys use this format:

```txt
vibecanvas:debug:<plugin|service>:<name>
```

Levels:
- `0`, `false`, `off`, or empty = disabled
- `1` = important lifecycle logs
- `2` = more detailed state/layout logs
- `3` = very noisy per-frame/per-event logs

Examples:

```js
// hosted component plugin logs
localStorage.setItem("vibecanvas:debug:plugin:hosted-component", "3")

// camera service logs
localStorage.setItem("vibecanvas:debug:service:camera", "1")
```

Then reload the page and inspect the browser console.

To turn a target back off:

```js
localStorage.setItem("vibecanvas:debug:plugin:hosted-component", "0")
```

Current log output includes prefixes like:

```txt
[vibecanvas][plugin:hosted-component][L2] ...
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
- `CLAUDE.md`
- `apps/spa/CLAUDE.md`
- `apps/spa/src/features/canvas-crdt/CLAUDE.md`
- `apps/spa/src/features/canvas-crdt/canvas/CLAUDE.md`
- `apps/spa/src/features/canvas-crdt/input-commands/CLAUDE.md`
- `apps/spa/src/features/canvas-crdt/managers/CLAUDE.md`
- `apps/spa/src/features/canvas-crdt/renderables/CLAUDE.md`

## License

MIT. See `LICENSE`.
