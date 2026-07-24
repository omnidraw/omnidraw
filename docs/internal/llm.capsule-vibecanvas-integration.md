# Capsule integration boundary for Vibecanvas widgets

**Status:** Current implementation map

The authoritative requirements and cutover rules live in
[`llm.capsule-migration.md`](./llm.capsule-migration.md). This document is a
short map from those rules to the implemented Vibecanvas packages.

## Dependency direction

```text
widget source
  -> @vibecanvas/sdk/widget
  -> @omnidraw/capsule/guest
  -> canonical Capsule artifact

Vibecanvas adapter builder/build-runner entries
  -> public Capsule build/build-runner/sign entries
Vibecanvas browser adapter -> public Capsule host/protocol/schema entries
Capsule -> no Vibecanvas dependency
```

Vibecanvas does not deep-import the Capsule repository, copy its source, or
patch its installed runtime. Browser entries cannot import build or signing
implementations.

## Ownership

| Owner | Responsibility |
| --- | --- |
| Capsule | Artifact, builder, verification, VM, DOM, generic capabilities, channels, lifecycle, scheduling, diagnostics, and testkit |
| `packages/capsule-vibecanvas` | Product policy, request mapping, signatures, schemas, host creation, provider bindings, and error mapping |
| `packages/widget-contract` | Strict manifest v3, artifact/revision metadata, builder identity, and runtime descriptors |
| `packages/sdk` | Framework-neutral props, theme, output, local-store, function, and collaboration guest APIs |
| `packages/service-agent` | Immutable source capture, validation, scaffolding, preview/publish orchestration, and authoring guidance |
| `apps/cli` | Persistent signing keys, OCI compiler composition, artifact storage, runtime host configuration, and tenant services |
| `packages/ui-ai-chat` | Shared browser-host coordination, capability composition, runtime loading, and population scheduling |
| `packages/canvas` | Portal ownership plus viewport, visibility, priority, focus, fullscreen, collapse, and removal inputs |
| Server services | Tenant authorization, short functions, Automerge collaboration, resources, persistence, and usage |

## Build and publication flow

1. Capture and validate one immutable widget source snapshot and strict v3
   manifest.
2. Materialize the exact public Capsule guest package, Vibecanvas SDK runtime
   and declaration closure, generated function client, and pinned dependency
   graph.
3. Send the complete non-server source closure to the pinned, networkless
   Capsule OCI runner, where hostile UI JavaScript, TypeScript, CSS imports,
   asset references, and dependency graphs are parsed and compiled. There is
   no trusted-process parser or in-process production fallback.
4. Independently validate returned canonical artifact bytes and hash.
5. Sign preview bytes with the preview key or publication bytes with the
   release key.
6. Store immutable content-addressed bytes and exact descriptor metadata.
7. Publish only the completed release descriptor.

Preview and published widgets use the same browser load and mount path; only
their signing purpose and selected descriptor differ.

## Browser mount flow

1. Fetch the tenant-authorized runtime descriptor and exact artifact bytes.
2. Select a shared host partition whose immutable policy, trusted-key catalog,
   schema catalog, and capability descriptor catalog exactly match.
3. Verify format, target, hash, signature purpose, key, policy, requested
   capabilities, grants, descriptor catalogs, and provider bindings. Function
   descriptors are canonicalized and re-hashed before any provider is
   constructed.
4. Bind function and collaboration providers to trusted tenant, definition,
   revision, and widget-instance context.
5. Mount one Capsule handle into the canvas-owned portal.
6. Forward props, theme, viewport, focus, and lifecycle updates.
7. On removal or terminal failure, cancel streams and pending calls, destroy
   the handle idempotently, release registrations, and remove the portal.

The host is partitioned because Capsule policies and catalogs are immutable and
must never be widened to accommodate another widget.

## Population ownership

Canvas and `packages/ui-ai-chat` retain product geometry and admission
priorities, so they decide which owners may have a live Capsule handle. Capsule
enforces the state and budgets of each admitted handle. This boundary permits a
10,000-widget canvas while retaining bounded live guests and deterministic
active, throttled, frozen, resumed, and destroyed transitions.

## Security invariants

- Private signing keys are server-only; browser configuration contains public
  verification material only.
- The guest never receives raw service objects, auth tokens, database handles,
  Automerge internals, engine credentials, or selectable authority IDs.
- Schemas are exact and bounded. Collaborative JSON is limited to depth 4, 64
  collection entries, and 4 KiB strings, with no `any`, bytes, or `undefined`.
- Production UI compilation crosses the pinned Capsule OCI boundary with
  network disabled, a read-only root, no new privileges, and explicit resource
  limits.
- Server-function source follows its separately scoped trusted server build;
  server/private files are withheld from the UI compiler and generated browser
  proxies are inserted in their place.
- Browser teardown is terminal and idempotent; no live guest, stream,
  registration, portal, or pending operation may remain.

## Removed architecture

The implementation has no Arrow dependency, sandbox patch, Arrow prompt,
manifest v2 parser, old UI envelope, global transport setter, dual-runtime
switch, or source-compilation fallback. Parking remains intentionally deferred.
