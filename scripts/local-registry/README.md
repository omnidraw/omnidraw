# Omnidraw local registry runtime

This manifest and lockfile pin the Verdaccio runtime used by
`scripts/local-registry.mjs`. The bootstrap copies them into the host-owned
registry state directory and runs `npm ci` there, so starting the registry does
not depend on a worktree's `node_modules`.

The host has one product-neutral registry state at
`~/.local/share/verdaccio`, shared by every worktree and project. Override it
with `LOCAL_NPM_REGISTRY_STATE_DIR`; override the canonical loopback URL with
`LOCAL_NPM_REGISTRY_URL`. Widget npm commands receive the generated `npmrc`
through `--userconfig`.

From any Omnidraw worktree:

```sh
bun run registry:bootstrap -- \
  --cangine /path/to/omnidraw-cangine-0.6.1.tgz \
  --capsule /path/to/omnidraw-capsule-0.11.0.tgz
bun run registry:publish:sdk
bun install --frozen-lockfile
```

The producer repositories remain responsible for building, verifying, and
packing those two tarballs. Bootstrap publishes them. `registry:publish:sdk`
builds, packs, and idempotently publishes the current staged Omnidraw SDK; it
rejects a name/version whose stored integrity differs. Normal `bun run dev`
does this SDK publish automatically. Lifecycle commands are `registry:start`,
`registry:ensure`, `registry:status`, and `registry:stop`. Use
`registry:start:foreground` to keep Verdaccio attached to the current terminal
and stop it with Ctrl+C.
