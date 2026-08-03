# How to publish Omnidraw libraries

Reference only:

- `.github/workflows/test.yml`
- `tasks/d/D5.md`

Merging to `main` does not publish npm packages. Versioned `@omnidraw/*`
libraries are built and published manually from a maintainer machine. The app
is not published, and CI verifies releases without publishing them.

## Library packages

### Source manifests versus public packages

The `package.json` in each workspace package is the development manifest. It
may contain `workspace:*` and `catalog:` references so packages link correctly
while several packages are edited together.

Never publish the workspace package root.

Each versioned package's `build` script creates its standalone npm package in
the ignored `dist/` directory. The root `bun run build` runs the canvas-kernel
build first and then builds every workspace package that provides a build
script. Each generated `dist/package.json`:

- retains the package name and release version;
- converts internal dependencies to exact package versions;
- resolves catalog dependencies to public registry ranges;
- points every export at built JavaScript, declarations, CSS, or assets inside
  the staged package;
- contains no workspace protocol, filesystem link, source path, or repository
  path reference.

The supported publication target is always `./dist`:

```sh
cd packages/<package>
bun run typecheck
bun run test
bun run build
npm publish ./dist --dry-run --access public
npm publish ./dist --access public
```

Do not edit generated `dist` files by hand. Change the source manifest, build
configuration, or source files and rebuild instead.

### Release set

The workspace package version is the release marker. Unversioned packages and
all apps are private and must not be published. Read each package manifest and
run `bun run deploy:packages:list` immediately before a release; never rely on
a copied version table. If an exact version already exists on npm, verify it
and skip it. Never overwrite or republish a version.

### Prerequisites

Before publishing the Omnidraw closure, exact external dependencies must be
available from the public npm registry:

- `@omnidraw/cangine@0.6.1`, published from its owning repository;
- `@omnidraw/capsule@0.12.0`.

Local Verdaccio packages and the repository lockfile do not satisfy this gate.
Check the public registry explicitly:

```sh
npm view @omnidraw/cangine@0.6.1 version dist.integrity --registry=https://registry.npmjs.org/
npm view @omnidraw/capsule@0.12.0 version dist.integrity --registry=https://registry.npmjs.org/
```

Stop if either exact version cannot be resolved publicly.

### Dependency-first publication order

Publish one wave completely and verify it on npm before starting the next.
Packages within one wave have no dependency edge between them and may still be
published sequentially for a simpler manual release.

1. Foundation contracts:
   `tenant-core`, `runtime`, and `theme-contract`.
2. First dependents:
   `resource-runtime`, `canvas-contract`, and `service-theme`.
3. Product boundaries:
   `widget-contract`, `service-canvas`, and `canvas`.
4. Final dependents:
   `function-runtime`, `sdk`, and `capsule-omnidraw`.

After each publication, query the exact version rather than `latest`:

```sh
npm view @omnidraw/tenant-core@0.5.0 version dist.integrity time --registry=https://registry.npmjs.org/
```

Do not advance to a dependent package until npm returns the exact dependency
version.

### Ask what needs deployment

After a long-running change, run this from the repository root:

```sh
bun run deploy:packages:list
```

The command is read-only. It scans versioned packages under `packages/` and
never selects apps or unversioned workspace packages. For every library it
checks the public npm registry and reports:

- `CURRENT` when the intended tag already matches the local exact version;
- `DEPLOY` when npm returns 404 or the local version is newer and unpublished;
- `TAG` when the exact version already exists but the intended dist-tag points
  elsewhere, so the version must not be republished;
- `CATALOG MISMATCH` when the staged `dist/package.json` dependency fields
  differ from that exact version's package manifest on npm. The report names
  the next patch version to use after approval and tells you to build again;
- `BLOCK` when public `latest` is newer than the local version.

It also checks exact external Omnidraw prerequisites, propagates missing
dependencies through the local package graph, and prints:

- individual build, dry-run, and publish commands;
- the packages safe to publish now in dependency order.

Exit code `0` means the registry check found no blocking mismatch. Exit code
`2` means the report contains a missing prerequisite or local version problem;
read the printed actions, fix them, and rerun the command. A registry or network
failure exits with code `1` and never prints a deployment command.

### Required verification

Before publishing any package, run the complete staged-distribution gate from
the repository root:

```sh
bun install --frozen-lockfile
bun run build
bun run verify:package-dists
bun run test:packed-public-composition
bun run test:packed-canvas-kernel
```

`verify:package-dists` discovers every versioned workspace library, orders the
build by its dependency graph, builds and inspects every `dist` package, runs
npm's dry-run pack, creates isolated tarballs, installs the complete closure in
a clean temporary consumer, and runs Bun and portable Node ESM import smokes.
It does not publish anything.

The canvas-kernel gate additionally performs the production browser build and
browser smokes required for the browser-only canvas entry points, CSS, fonts,
and single-Solid-runtime contract.

### Version changes

Only changes to a versioned package's public/runtime code under `src/` require
and permit a semantic version bump in that package's workspace manifest.
Changes only to scripts, tests, documentation, package metadata, build
configuration, export staging, or repository tooling keep the existing
version. If that version is already public, the deployment report marks it
current and it must not be republished; the packaging improvement ships with a
future `src/` release.

For a real `src/` change, never reuse a published version. Rebuild all
dependents so their generated public manifests pin the new exact internal
version, then regenerate `bun.lock`.

The deployment report can also expose an older, already-published package whose
staged dependency pins have drifted because a workspace or catalog dependency
advanced. This is an exceptional dependency-only release: do not bump or
publish it automatically. Obtain explicit publication approval for the named
package, assign a new patch version, rebuild its dependents, and rerun the
report.

### Recovery from a partial manual release

Do not unpublish or replace an existing version. Stop the release wave, fix the
problem, increment the affected package, update and rebuild its dependents, and
resume dependency-first. Do not move a stable dist-tag to a partial or broken
closure.
