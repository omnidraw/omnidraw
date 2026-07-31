# Capsule migration progress

Current Capsule package: `@omnidraw/capsule@0.9.4`

Source revision: `fd2e4eddf1f4d07b2e9e9e473f7c95cb5496f64d`

Package digest:
`sha256:0d39b40a978fc0ce483c64c40f83eb25fd77f6f970d361feb5a4875de6758189`

Omnidraw now uses Capsule's production external-distribution API:

1. Widget drafts own `package.json`, package-lock format 3, dependencies, and
   the `npm run build` script.
2. Omnidraw materializes one exact immutable source snapshot, runs frozen
   `npm ci`, then runs the guest-controlled build script.
3. Omnidraw captures only a bounded regular-file `dist/`, binds its source,
   lock, build configuration, Node/npm, producer, and byte identities, and
   sends those exact bytes to Capsule.
4. Capsule closes and validates the ES2022 module/resource graph, emits the
   canonical artifact, and Omnidraw signs it for Preview or release.
5. Browser verification, QuickJS execution, DOM membrane policy, capabilities,
   lifecycle, population limits, and teardown remain unchanged.
6. New widget manifests request Capsule's native Shadow CSS profile and its
   separate CSS network-image authority; older manifests retain conservative
   CSS behavior.

The former Docker/Podman OCI builder, image and engine identities, startup
probe, runner export, acceptance command, and fixed guest dependency projection
have been removed. Node/npm are now widget build prerequisites.

Omnidraw explicitly accepts that npm lifecycle and guest build scripts run
with the server account's host authority. Capsule protects artifact admission
and runtime execution; it does not sandbox the build server.

Focused evidence:

- `bun test apps/cli/tests/WidgetNpmDistributionBuild.test.ts`
- `bun test packages/capsule-omnidraw/tests`
- `bun test apps/cli/tests/widget-prerequisites.test.ts`
- `bun test apps/cli/tests/WidgetService.test.ts`
- `bun test apps/cli/tests/ManagedV3JoinedFlow.test.ts`
- `bun test apps/cli/tests/FunctionRuntimeComposition.test.ts`
