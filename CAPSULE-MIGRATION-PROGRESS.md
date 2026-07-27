# Capsule migration progress

Current Capsule package: `@omnidraw/capsule@0.9.3`

Source revision: `e302a6cbd00fd7932417c9b377597878db0afe25`

Vibecanvas now uses Capsule's production external-distribution API:

1. Widget drafts own `package.json`, package-lock format 3, dependencies, and
   the `npm run build` script.
2. Vibecanvas materializes one exact immutable source snapshot, runs frozen
   `npm ci`, then runs the guest-controlled build script.
3. Vibecanvas captures only a bounded regular-file `dist/`, binds its source,
   lock, build configuration, Node/npm, producer, and byte identities, and
   sends those exact bytes to Capsule.
4. Capsule closes and validates the ES2022 module/resource graph, emits the
   canonical artifact, and Vibecanvas signs it for Preview or release.
5. Browser verification, QuickJS execution, DOM membrane policy, capabilities,
   lifecycle, population limits, and teardown remain unchanged.

The former Docker/Podman OCI builder, image and engine identities, startup
probe, runner export, acceptance command, and fixed guest dependency projection
have been removed. Node/npm are now widget build prerequisites.

Vibecanvas explicitly accepts that npm lifecycle and guest build scripts run
with the server account's host authority. Capsule protects artifact admission
and runtime execution; it does not sandbox the build server.

Focused evidence:

- `bun test apps/cli/tests/WidgetNpmDistributionBuild.test.ts`
- `bun test packages/capsule-vibecanvas/tests`
- `bun test apps/cli/tests/widget-prerequisites.test.ts`
- `bun test apps/cli/tests/WidgetService.test.ts`
- `bun test apps/cli/tests/ManagedV3JoinedFlow.test.ts`
- `bun test apps/cli/tests/FunctionRuntimeComposition.test.ts`
