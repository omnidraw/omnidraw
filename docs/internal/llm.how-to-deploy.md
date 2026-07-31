# How to release Omnidraw

Reference only:
- `.github/workflows/release-omnidraw.yml`
- `.github/workflows/test.yml`

Merging to `main` does not publish npm packages. The Omnidraw CLI release is
tag-driven; standalone library packages are released only from a local machine.

## Omnidraw CLI and binary packages

Publishes `omnidraw` and generated macOS/Linux `omnidraw-*` platform packages. Windows builds are not published.

### Stable
1. Update `apps/omnidraw/package.json` to `0.3.0`.
2. Add `## 0.3.0` to `CHANGELOG.md` if release notes need to be curated.
3. Commit and merge the version change.
4. Create and push an explicit tag: `git tag omnidraw-v0.3.0 && git push origin omnidraw-v0.3.0`.
5. GitHub Actions verifies no `omnidraw@0.3.0` / `omnidraw-*@0.3.0` package already exists on npm, then publishes npm `latest` and a normal GitHub release.

### Beta
1. Update `apps/omnidraw/package.json` to `0.3.0-beta.1`.
2. Commit and merge the version change.
3. Create and push an explicit tag: `git tag omnidraw-v0.3.0-beta.1 && git push origin omnidraw-v0.3.0-beta.1`.
4. GitHub Actions publishes npm `beta` and a GitHub prerelease.

### Nightly
1. Update `apps/omnidraw/package.json` to `0.3.0-nightly.20260409`.
2. Commit and merge the version change.
3. Create and push an explicit tag: `git tag omnidraw-v0.3.0-nightly.20260409 && git push origin omnidraw-v0.3.0-nightly.20260409`.
4. GitHub Actions publishes npm `nightly` and a GitHub prerelease.

## Standalone library packages

The following packages are published locally and have independent versions:

- `@omnidraw/tenant-core`
- `@omnidraw/function-runtime`
- `@omnidraw/resource-runtime`
- `@omnidraw/runtime`
- `@omnidraw/widget-contract`
- `@omnidraw/sdk`

There is no GitHub Actions release workflow and no release tag for these
packages. Authenticate with npm locally, run the package tests and a publish
dry-run, then publish from the package directory.

For a full release at `0.5.0`, publish in dependency order:

1. `packages/tenant-core`
2. `packages/runtime`
3. `packages/resource-runtime`
4. `packages/widget-contract`
5. `packages/function-runtime`
6. Build and publish `packages/sdk`

Run `npm publish --dry-run` and then `npm publish` from each package directory.
Each manifest selects public npmjs publishing and runs its tests and typecheck
automatically. SDK also builds its `dist` files automatically before publish.
