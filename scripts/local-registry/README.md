# Vibecanvas local registry runtime

This manifest and lockfile pin the Verdaccio runtime used by
`scripts/local-registry.mjs`. The bootstrap copies them into the host-owned
registry state directory and runs `npm ci` there, so starting the registry does
not depend on a worktree's `node_modules`.

The default state is `~/.local/share/vibecanvas/registry`. Override it with
`VIBECANVAS_REGISTRY_STATE_DIR`; override the canonical loopback URL with
`VIBECANVAS_REGISTRY_URL`. Widget npm commands receive the generated `npmrc`
through `--userconfig`.

From any Vibecanvas worktree:

```sh
bun run registry:bootstrap -- \
  --cangine /path/to/omnidraw-cangine-0.3.0.tgz \
  --capsule /path/to/omnidraw-capsule-0.10.1.tgz
bun install --frozen-lockfile
```

The producer repositories remain responsible for building, verifying, and
packing those two tarballs. Bootstrap publishes them, builds and packs the
Vibecanvas SDK closure, and rejects a name/version whose stored integrity
differs. Lifecycle commands are `registry:start`, `registry:ensure`,
`registry:status`, and `registry:stop`.
