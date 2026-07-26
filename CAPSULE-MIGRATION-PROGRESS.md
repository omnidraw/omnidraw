# Capsule migration progress

Current milestone: 10 - Final end-to-end acceptance
Current status: Complete; all Capsule migration gates pass
Baseline Vibecanvas commit: 908217de449e6e200fb93b17be8d05e97922d7dd
Capsule package name: @omnidraw/capsule@0.9.2
Capsule source revision: 3d875629d1a7de36fa57a31ecda15ec65168875e
Capsule package/pack digest: sha256:9ac71bab6984a60d7abc3ecd99c5b3733028a312ab97095615332ec8471f8753
Capsule runtime build digest: sha256:8d6786bf0775f33724c74ea6f71841f5e61dd86d0de7c2b6c3d6c61f9d4ea146
Capsule OCI image ID: sha256:83ff7d9b53672ef765853d72f8b0f6065fbcfdf9707bb0dde9a0029b689daac3

## Completed

- Replaced the Arrow widget runtime atomically with strict manifest v3,
  canonical signed Capsule bytes, and no compatibility or dual-runtime path.
- Added `@vibecanvas/capsule-vibecanvas` with public-only contract, builder,
  build-runner, host, capability, and testkit boundaries.
- Moved all browser UI parsing, typechecking, dependency resolution, CSS/asset
  closure, and compilation into the pinned networkless Capsule OCI runner.
  The separately scoped server-function build remains trusted as required by
  section 7.8 of the migration plan.
- Added persistent, separate Ed25519 preview and release keys. Browsers receive
  only exact public verification configuration.
- Rebuilt the SDK, generated clients, scaffolds, prompts, preview, publication,
  API, database model, browser mount, and canvas lifecycle around Capsule.
- Bound server functions and collaborative state through instance-scoped
  capability providers. The browser-safe function descriptor digest is
  independently recomputed by the builder, API, preview, and mount before any
  provider is constructed; the full server descriptor digest remains separate.
- Added a shared host coordinator partitioned by exact immutable policy, key,
  schema, and capability catalogs.
- Added bounded population scheduling for 10,000 owners: at most 24 live
  handles, 16 active, 8 throttled, 8 heavy, and 2 GPU; offscreen handles freeze
  after 2 seconds and distant handles are destroyed after 30 seconds.
- Implemented active, throttled, frozen/resumed, and destroyed lifecycle with
  idempotent terminal-zero cleanup. Parking is intentionally absent.
- Replaced Node/npm startup prerequisites with the exact pinned Docker/Podman
  OCI engine prerequisite and verified it from the compiled binary.
- Removed Arrow dependencies, patches, prompts, declarations, old UI envelope,
  manifest v2, global guest transports, and the trusted browser UI validator.
- Updated public compatibility/integration documentation and permanent
  production-browser, OCI, scale, package, and binary acceptance gates.
- Supplied the two consumer-required Capsule fixes in the source checkout:
  scoped React JSX semantics (B8) and a reproducible runnable OCI worker (B9).

## In progress

- None for the Capsule migration.

## Verification evidence

- `bun install --frozen-lockfile`: pass; the required Automerge timeout patch
  remains applied by the root postinstall hook.
- `bun --filter @vibecanvas/widget-contract typecheck/test`: pass, 23 tests.
- `bun --filter @vibecanvas/capsule-vibecanvas typecheck/test`: pass, 31 tests
  and 614 assertions.
- `bunx tsc -p packages/api/tsconfig.json --noEmit` and API tests: pass,
  57 tests.
- `bun --filter @vibecanvas/sdk build/typecheck/test`: pass, 11 tests.
- `bun --filter @vibecanvas/service-agent typecheck/test`: pass, 62 tests.
- `bun --filter @vibecanvas/ui-ai-chat typecheck/test`: pass, 215 tests.
- `bun --filter @vibecanvas/cli test`: pass, 151 tests.
- `bun run test:capsule-browser`: pass in a production Vite build. One
  Playwright scenario performs 22 checks covering plain DOM, SVG, Canvas 2D,
  React, release signatures, functions, collaboration, lifecycle, authority
  negatives, and terminal-zero teardown.
- `bun run test:capsule-oci-build`: pass. Two runs produced identical 2,017
  byte artifacts at
  `sha256:ea0f4875992e89f58d8e96ac1f6f10d48a25fcd09fe95262a0ba6144b8c4619d`;
  hostile `node:fs` was denied with `SANDBOX_EXECUTION_FAILED`.
- Durable product gates passed 507 tests: widget artifacts, function runtime,
  database schema/constraints/recovery, tenant isolation, resource runtime,
  external composition, architecture, manifest-v3 joined flow, packed public
  composition, and bounded 10,000-owner load.
- `bun run lint:functional-core` and
  `bun run lint:functional-core:agent`: pass.
- `bun run build`: pass for Darwin arm64, Linux arm64, Linux x64, and Linux x64
  baseline release packages.
- `bun run test:binary`: pass against the fresh build, including native addon,
  OCI prerequisite success/warning, exact database integrity, HTTP, assets,
  WebSockets, reboot, explicit data directory, and port fallback.
- Capsule source `bun run test`: pass, 558 tests and 8,384 assertions.
- Capsule source `bun run verify:package`: pass with the package digest recorded
  above.
- Capsule WebGPU construction gate: pass, 2 Playwright projects; source
  artifact
  `sha256:a91b18d89dc3709816aa20bb46f58de99fc634629a3dea23a1b598635fa8fa9f`.
- `git diff --check`: pass.
- `bun run test`, `bun run test:canvas-regression`, and therefore the aggregate
  `bun run test:final-acceptance` stop only at the pre-existing Cangine audit
  fixture recorded below. All Capsule-specific suites invoked independently
  are green.

## Decisions

- `docs/internal/llm.capsule-migration.md` wins every conflict with older
  integration notes.
- This is a clean cutover: no manifest alias, artifact conversion, source
  fallback, old-data migration, or Arrow compatibility mode.
- Use only supported public `@omnidraw/capsule` package entries.
- Preview key ID is `vibecanvas-preview-v1`; release key ID is
  `vibecanvas-release-v1`.
- Browser UI compilation has no in-process production fallback. Production
  uses the pinned OCI engine binary, exact image ID, scratch engine home,
  networkless container, read-only root, zero capabilities, `no_new_privs`,
  and explicit memory/CPU/process/file/temp/wall limits.
- The first release supports active, throttled, frozen/resumed, and destroyed.
  Parking remains disabled.
- Browser hosts are pooled by exact immutable catalog identity rather than
  widened after construction.
- Server-function capability IDs are
  `vibecanvas.widget.functions.h<full-browser-descriptor-digest>` to avoid
  Capsule 0.9 duplicate-ID collisions while preserving exact contract binding.
- Vibecanvas owns product geometry and population admission; Capsule owns each
  admitted handle, runtime enforcement, lifecycle state, and teardown.

## Deviations from llm.capsule-migration.md

- The illustrative `resourceProfile` field is omitted because Capsule 0.9
  represents resource profiles in the target's `featureProfiles`.
- “One shared host” is implemented as a shared coordinator with exact immutable
  host partitions. Capsule 0.9 cannot safely widen a constructed policy or
  register duplicate capability IDs with different hashes.
- The recommended stable server-function capability ID is namespaced by the
  full canonical browser descriptor digest because Capsule 0.9 rejects
  duplicate records for one ID.
- Population policy remains a consumer responsibility because canvas owns
  viewport geometry and product priority; Capsule still enforces every
  admitted handle and budget.
- The optional OCI boundary was adopted and made mandatory for browser UI
  source. The separate server-function build remains as specified in section
  7.8.
- The clean tracked-snapshot final-acceptance container explicitly omits the
  host browser and nested OCI gates because it has neither Chromium nor a
  nested engine. Normal local final acceptance includes both gates.

## Known problems

- An unrelated Cangine audit fixture is stale in the baseline commit:
  `packages/canvas/package.json` already selects Cangine `0.1.2`, while
  `packages/canvas/tests/canvas-engine/artifact-identity.test.ts` still expects
  `0.1.0` and its former tarball digest. Canvas reports 364 pass / 1 fail, and
  the aggregate test wrappers stop there. The Cangine source checkout contains
  uncommitted work, so this migration deliberately does not bless a new engine
  commit or artifact identity. No Capsule canvas test fails.
- Historical requirements, baselines, and closed task records retain Arrow
  terminology as history. Live dependencies, runtime source, prompts, patches,
  and current widget documentation do not.

## Next exact action

Review and commit the Vibecanvas migration together with the intentionally
dirty Capsule B8/B9 source changes. Re-audit and update the Cangine artifact
identity only after that separate engine release is finalized.
