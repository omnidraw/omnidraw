# Managed service package consumption

The private managed monorepo composes Vibecanvas through versioned public packages. It does not copy OSS source, patch application code, or add managed branches to API handlers.

## Release dependencies

Production releases pin one exact, reviewed package set:

```json
{
  "dependencies": {
    "@vibecanvas/function-runtime": "0.1.0",
    "@vibecanvas/resource-runtime": "0.1.0",
    "@vibecanvas/runtime": "0.1.0",
    "@vibecanvas/tenant-core": "0.1.0",
    "@vibecanvas/widget-contract": "0.1.0"
  }
}
```

Do not use ranges, floating Git references, or copied contract files in a managed release. Update the five pins atomically after their conformance and architecture gates pass. Pin the widget manifest schema and function `runtimeAbi` accepted by that release as part of the same change; an artifact digest is an integrity value, not read authority.

The public ownership is:

| Package | Managed implementation seam |
| --- | --- |
| `@vibecanvas/tenant-core` | `IIdentityProvider`, `IPlacementDirectory`, immutable tenant context |
| `@vibecanvas/widget-contract` | `IWidgetArtifactStore`, immutable widget/artifact contracts, neutral frame/tool metadata |
| `@vibecanvas/function-runtime` | `IFunctionDispatcher`, `IFunctionExecutor`, stores, scheduler, sandbox, and `IUsageSink` |
| `@vibecanvas/resource-runtime` | `IResourceGateway`, Resource Store/provider contracts |
| `@vibecanvas/runtime` | Service registry/plugin lifecycle, `ICollaborationService`, and `IScopedEventBus` |

Concrete local Turso, Automerge, Bun child-process, event-publisher, and actor packages are OSS adapters. They are not dependencies of the private composition root.

## Composition rule

Private identity, placement, artifact, scheduler/executor, resource, collaboration, event, and usage implementations register with `createServiceRegistry()` and are selected by the private app composition root. Consolidated OSS API handlers continue to consume the same narrow capabilities. The private repository must not import `apps/cli`, a package `src` path, an API handler module, or a concrete `service-*` implementation.

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
