# Managed service package consumption

The private managed monorepo composes Omnidraw through versioned public packages. It does not copy OSS source, patch application code, or add managed branches to API handlers.

## Release dependencies

Production releases pin one exact, reviewed package set:

```json
{
  "dependencies": {
    "@omnidraw/function-runtime": "0.1.0",
    "@omnidraw/canvas-contract": "0.1.0",
    "@omnidraw/resource-runtime": "0.1.0",
    "@omnidraw/runtime": "0.1.0",
    "@omnidraw/tenant-core": "0.1.0",
    "@omnidraw/widget-contract": "0.1.0"
  }
}
```

Do not use ranges, floating Git references, or copied contract files in a managed release. Update the pins atomically after their conformance and architecture gates pass. Pin the widget manifest schema and function `runtimeAbi` accepted by that release as part of the same change; an artifact digest is an integrity value, not read authority.

The public ownership is:

| Package | Managed implementation seam |
| --- | --- |
| `@omnidraw/canvas-contract` | Cangine canvas items, commands, queries, and revision events |
| `@omnidraw/tenant-core` | `IIdentityProvider`, `IPlacementDirectory`, immutable tenant context |
| `@omnidraw/widget-contract` | `IWidgetArtifactStore`, immutable widget/artifact contracts, neutral frame/tool metadata |
| `@omnidraw/function-runtime` | `IFunctionDispatcher`, `IFunctionExecutor`, stores, scheduler, sandbox, and `IUsageSink` |
| `@omnidraw/resource-runtime` | `IResourceGateway`, Resource Store/provider contracts |
| `@omnidraw/runtime` | Service registry and plugin lifecycle |

Concrete local Turso, canvas authority, widget-state, Bun child-process,
event-publisher, and actor packages are OSS adapters. They are not dependencies
of the private composition root.

## Composition rule

Private identity, placement, artifact, scheduler/executor, resource, canvas,
widget-state, and usage implementations register with `createServiceRegistry()`
and are selected by the private app composition root. Consolidated OSS API
handlers continue to consume the same narrow capabilities. The private
repository must not import `apps/cli`, a package `src` path, an API handler
module, or a concrete `service-*` implementation.

The executable proof is [`scripts/fixtures/external-composition`](../../scripts/fixtures/external-composition). It is intentionally outside `apps/cli`, declares exact release dependencies, and imports package export maps only.

The fixture remains API-agnostic. The OSS-side `scripts/external-composition-api-integration.test.ts` conformance harness supplies a thin API capability adapter, invokes the unchanged function router, and verifies that the server-derived tenant and target reach the fixture's public `IFunctionDispatcher`. This test-only bridge proves handler compatibility without making the private composition depend on API internals or adding managed branches to OSS handlers.

## Local development and release verification

In this monorepo, Bun links the fixture’s exact versions to matching workspaces. A separate managed checkout may use a temporary workspace or `file:` override for development, but its committed release manifest keeps the exact package pins above. Never vendor or patch the OSS package source.

Before updating the managed pin set:

```bash
bun run test:external-composition
bun run test:architecture
```

Release CI should additionally install the packed public artifacts in a clean environment, verify the lockfile resolves those exact versions, and run the private composition/conformance suite before deployment.
