# Omnidraw local registry runtime

This manifest and lockfile pin the Verdaccio runtime used by
`scripts/local-registry.mjs`. The bootstrap copies them into the host-owned
registry state directory and runs `npm ci` there, so starting the registry does
not depend on a worktree's `node_modules`.

The host has one product-neutral registry state at
`~/.local/share/verdaccio`, shared by every worktree and project. Override it
with `LOCAL_NPM_REGISTRY_STATE_DIR`; override the canonical loopback URL with
`LOCAL_NPM_REGISTRY_URL`. Widget npm commands receive the generated `npmrc`
through `--userconfig`. The loopback registry grants anonymous read/publish
access to `@omnidraw/*`. npm nevertheless refuses to run `npm publish` unless
its configuration has an auth-shaped entry, so the generated publish-only
userconfig contains the fixed, non-secret `omnidraw-local-development`
sentinel. Verdaccio does not use it as a credential. Repository and widget
consumer npm configuration remains token-free.

From any Omnidraw worktree:

```sh
bun run registry:bootstrap -- \
  --cangine /path/to/omnidraw-cangine-0.7.0.tgz \
  --capsule /path/to/omnidraw-capsule-0.16.0.tgz
bun run registry:publish:sdk
bun install --frozen-lockfile
```

The producer repositories remain responsible for building, verifying, and
packing those two tarballs. Bootstrap publishes them. If you'd rather build
and publish current source from sibling checkouts instead of a hand-produced
tarball, use `bun run link:local -- capsule cangine` (see "Opt-in cross-repo
local linking" below) — `bootstrap` and `link:local` both end up publishing
into the same registry, they just differ in where the bytes come from.

`registry:publish:sdk` discovers the current SDK's qualified workspace
dependency closure, then makes each exact version available in dependency
order. Today that closure is only `sdk`; Capsule is an exact registry dependency. A
version already available from npmjs is left on the proxy path; an unpublished
workspace version is built, packed, and published locally. Verdaccio therefore
serves local-only versions first and proxies npmjs for everything else.

**`bun run dev` does not run this on its own (D9).** Every in-workspace
consumer (`apps/backend` or `apps/frontend`)
resolves `@omnidraw/*` via plain `workspace:*` linking, never through the
local registry — the only real consumer is a widget-author's isolated
`npm ci`, and the backend's `LocalWidgetPackageRegistrySync` already syncs this
closure lazily, exactly once, the first time that's actually requested during
a dev session. Run `bun run registry:publish:sdk` yourself to warm the
registry ahead of time if you want to.

A locally occupied name/version whose stored bytes differ from what a fresh
`registry:publish:sdk` would produce is **not** rejected: this sync path
always publishes with `allowOverwrite: true` (see `publishTarball` /
`publishDecision` in `../local-registry.mjs`), so it unpublishes and replaces
the conflicting local version automatically. Editing a workspace package's
source is never a reason to hand-edit its `package.json` version just to keep
local dev working — that check only exists for real releases (see
`../../.changeset/README.md` for the deliberate, batched "bump once" flow) and
for the explicit `publish`/`bootstrap` commands below, which still enforce
strict immutability because they install externally-produced, known-good
artifacts rather than this checkout's own in-flux source.

Because the registry is shared by worktrees, synchronizing an exact workspace
version does not take the `latest` tag from a different version. The sync uses
the development-only `omnidraw-workspace` tag in that case; isolated widget
installs request the manifest's exact SDK version and do not depend on either
tag.

Concurrent development processes serialize publication through the shared
registry state directory. Lifecycle commands are `registry:start`, `registry:ensure`,
`registry:status`, and `registry:stop`. Use `registry:start:foreground` to
keep Verdaccio attached to the current terminal and stop it with Ctrl+C.

## Opt-in cross-repo local linking

`bun install`/`bun run dev` always resolve `@omnidraw/capsule` and
`@omnidraw/cangine` from real npm at the pinned `catalog`/devDependency
versions by default — nothing below changes that until you explicitly opt in.

To develop across repos (edit capsule or cangine locally and see the effect
here without a real npm release):

```sh
bun run link:local -- capsule cangine   # or: OMNIDRAW_LINK_LOCAL=capsule,cangine bun run link:local
bun install
```

This builds and publishes the sibling checkout(s) into this checkout's local
registry (via each producer repo's own `package:publish:local`-shaped script —
see `../link-local-packages.mjs`) and writes a repo-root `.npmrc` (gitignored)
scoping `@omnidraw:registry` to it. Sibling checkouts default to `../capsule`
and `../cangine` next to this repository; override with
`OMNIDRAW_CAPSULE_LOCAL_PATH`/`OMNIDRAW_CANGINE_LOCAL_PATH` if yours live
elsewhere.

The next `bun install` may record those tarballs as `http://127.0.0.1:4873/...`
in `bun.lock`. Keep using the local registry for this machine. Commit and push
as usual: a git hook strips those loopback URLs from the committed lockfile.
CI still installs only published npm versions.
