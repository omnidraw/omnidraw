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
bun run registry:publish:widgets
bun install --frozen-lockfile
```

The producer repositories remain responsible for building, verifying, and
packing those two tarballs. Bootstrap publishes them.
`registry:publish:widgets` discovers the current SDK's versioned workspace
dependency closure, then makes each exact version available in dependency
order. Today that is `tenant-core`, `resource-runtime`, `widget-contract`, then
`sdk`. A version already available from npmjs is left on the proxy path; an
unpublished workspace version is built, packed, and published locally.
Verdaccio therefore serves local-only versions first and proxies npmjs for
everything else. A locally occupied name/version whose stored integrity
differs is rejected; bump the package version or use a development prerelease
instead of changing bytes behind an existing widget lockfile. Normal
`bun run dev` synchronizes this closure at startup and again immediately before
widget dependency installation or trusted construction needs npm resolution.
Concurrent development processes serialize publication through the shared
registry state directory.
`registry:publish:sdk` remains as a compatibility alias. Lifecycle commands
are `registry:start`, `registry:ensure`, `registry:status`, and `registry:stop`. Use
`registry:start:foreground` to keep Verdaccio attached to the current terminal
and stop it with Ctrl+C.
