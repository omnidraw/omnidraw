# How to release Omnidraw

Reference only:
- `.github/workflows/release-omnidraw.yml`
- `.github/workflows/release-sdk.yml`
- `.github/workflows/test.yml`

Merging to `main` does not publish npm packages. Package releases are tag-driven.

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

## SDK package

Publishes only `@omnidraw/sdk`.

1. Update `packages/sdk/package.json` to the desired version.
2. Commit and merge the version change.
3. Create and push an explicit tag: `git tag sdk-v0.1.0 && git push origin sdk-v0.1.0`.
4. GitHub Actions verifies `@omnidraw/sdk@0.1.0` does not already exist on npm, then publishes the SDK to npm. No GitHub release is created for SDK for now.

If npm already contains the exact package version, the workflow fails before publishing. Bump the package version or remove that version from npm first.
