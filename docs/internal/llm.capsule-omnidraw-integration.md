# Capsule integration boundary for Omnidraw widgets

**Status:** Current implementation map

The authoritative requirements and cutover rules live in
[`llm.capsule-migration.md`](./llm.capsule-migration.md). This document is a
short map from those rules to the implemented Omnidraw packages.

## Dependency direction

```text
widget source
  -> @omnidraw/sdk/widget
  -> @omnidraw/capsule/guest
  -> canonical Capsule artifact

Omnidraw adapter build entry
  -> public Capsule build/protocol/sign entries
Omnidraw browser adapter -> public Capsule host/protocol/schema entries
Capsule -> no Omnidraw dependency
```

Omnidraw does not deep-import the Capsule repository, copy its source, or
patch its installed runtime. Browser entries cannot import build or signing
implementations.

## Ownership

| Owner | Responsibility |
| --- | --- |
| Capsule | Artifact, builder, verification, VM, DOM, generic capabilities, channels, lifecycle, scheduling, diagnostics, and testkit |
| `packages/capsule-omnidraw` | Product policy, request mapping, signatures, schemas, host creation, provider bindings, and error mapping |
| `packages/widget-contract` | Strict manifest v3, artifact/revision metadata, builder identity, and runtime descriptors |
| `packages/sdk` | Framework-neutral props, theme, output, local-store, function, and collaboration guest APIs |
| `packages/service-agent` | Immutable source capture, validation, scaffolding, preview/publish orchestration, and authoring guidance |
| `apps/cli` | Host npm distribution builds, persistent signing keys, artifact storage, runtime host configuration, and tenant services |
| `packages/ui-ai-chat` | Shared browser-host coordination, capability composition, runtime loading, and population scheduling |
| `@omnidraw/cangine` | Fixed widget frame, local canvas-maximized presentation, and atomic portal-shell transform, clip, z-index, visibility, and input gating |
| `packages/canvas` | Automerge projection plus viewport, visibility, priority, focus, durable collapse, local canvas-maximized, and removal inputs |
| Server services | Tenant authorization, short functions, Automerge collaboration, resources, persistence, and usage |

## Build and publication flow

1. Capture and validate one immutable widget source snapshot and strict v3
   manifest.
2. Materialize the exact project and run frozen `npm ci`, then the
   guest-controlled `npm run build`, using its package-lock-v3 dependency graph.
3. Capture only bounded regular files from `dist/` and send their exact bytes,
   roots, and provenance through Capsule's public external-distribution API.
4. Capsule closes and validates the ES2022 module/resource graph and returns
   canonical artifact bytes and hash.
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
   Native CSS and CSS network images require their exact signed
   `shadow-browser-css-v1` and `css-network-images-v1` declarations, host
   allowlist entries, and per-mount feature grants.
4. Bind function and collaboration providers to trusted tenant, definition,
   revision, and widget-instance context.
5. Mount one Capsule handle into the application content slot inside Cangine's
   atomic widget portal shell.
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
- Dependency lifecycle and build scripts run with the server account's host
  authority. This accepted build-server risk is separate from Capsule's
  artifact validation and runtime isolation.
- Server-function source follows its separately scoped trusted server build;
  server/private files are withheld from the UI compiler and generated browser
  proxies are inserted in their place.
- Native CSS remains confined by Capsule's closed ShadowRoot. CSS network
  images are separate ambient browser authority; their external response bytes
  are not part of the signed artifact or Capsule byte ledgers.
- Browser teardown is terminal and idempotent; no live guest, stream,
  registration, portal, or pending operation may remain.

## Removed architecture

The implementation has no Arrow dependency, sandbox patch, Arrow prompt,
manifest v2 parser, old UI envelope, global transport setter, dual-runtime
switch, or source-compilation fallback. Parking remains intentionally deferred.
