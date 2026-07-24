# Capsule widget compatibility profile

**Status:** Implemented and verified

**Authoritative migration requirements:**
[`llm.capsule-migration.md`](./llm.capsule-migration.md)

This document records the widget surface Vibecanvas supports after the
Capsule-only cutover. It is a product compatibility profile, not a claim that
Capsule implements every browser or npm API.

## Supported artifact model

- Widget manifests use only version `3`.
- UI artifacts are canonical Capsule artifact bytes; there is no Vibecanvas UI
  envelope around them.
- Preview and release artifacts are signed over the exact artifact bytes with
  separate persistent Ed25519 keys.
- The browser receives only the selected artifact descriptor, trusted public
  keys, exact target policy, and instance-bound grants.
- Browser code imports only supported public `@omnidraw/capsule` entries
  through `@vibecanvas/capsule-vibecanvas`.
- The recorded Capsule consumer package is `@omnidraw/capsule@0.9.1`, source
  revision `7a3df22c5fdd841c9baad84ea24088ca17d773e7`, with package digest
  `sha256:373b7dd1293b280d193683f4455d7420d62d8cb188ae32524da860199a52b727`.

## Verified guest surfaces

| Surface | Support |
| --- | --- |
| Plain DOM | Production-browser verified |
| SVG DOM | Production-browser verified |
| Canvas 2D | Production-browser verified |
| React | Production-browser verified with a closed pinned graph |
| Props and theme | Capsule channels |
| Guest output | Capsule output channel |
| Local widget store | Capsule guest bridge |
| Short server functions | Instance-bound Capsule capability |
| Collaborative get/change/subscribe | Instance-bound Capsule capability and stream |
| WebGL/WebGPU | Available only through the selected Capsule profiles and budgets |

Guest code may use a UI library only when its complete pinned dependency graph
can be built into the supported Capsule target. Runtime dynamic imports, Node
built-ins, ambient host objects, and arbitrary browser compatibility are not
part of this profile.

## Browser authority and lifecycle

The host rejects mismatched target, hash, signature, key, schema, descriptor,
grant, provider binding, or instance authority. Capability providers derive
tenant, definition, revision, and instance authority from the trusted mount
context; guest input cannot select those identities.

The first release supports:

- active;
- throttled;
- frozen and resumable;
- destroyed with idempotent terminal cleanup.

Parking is deliberately not supported. Vibecanvas owns viewport geometry and
population admission, while Capsule owns each mounted guest handle and its
runtime enforcement. The population policy admits at most 24 live handles,
including at most 16 active, 8 throttled, 8 heavy, and 2 GPU handles. Offscreen
owners freeze after 2 seconds and distant owners are destroyed after 30
seconds; 10,000 owners therefore do not imply 10,000 live guests.

## Hostile source build boundary

Untrusted browser UI source is parsed, typechecked, graph-resolved, and
compiled only through the public Capsule OCI build runner. The trusted process
does not parse UI JavaScript, TypeScript, CSS imports, or asset references.
Server-function source retains the separate trusted server build required by
the migration contract. The production UI compiler port uses:

- network-disabled Linux container execution;
- read-only root filesystem and no new privileges;
- zero added capabilities;
- 32 MiB input and 16 MiB output ceilings;
- 2 GiB memory, 2 CPUs, 120 CPU seconds, and 180 seconds wall time;
- 64 processes, 256 open files, 16 MiB per file, and 128 MiB temporary space;
- a pinned engine binary identity and exact image ID
  `sha256:83ff7d9b53672ef765853d72f8b0f6065fbcfdf9707bb0dde9a0029b689daac3`;
- a scratch engine home rather than ambient credential/config files.

The build is deterministic. Vibecanvas independently verifies returned
artifact bytes and hash before signing or storing them.

## Permanent evidence

- `bun run test:capsule-browser` runs real Chromium against a production Vite
  build. Its 22 checks cover plain DOM, SVG, Canvas 2D, React, signed release
  mounting, functions, collaboration, lifecycle, authority negatives, and
  terminal-zero teardown.
- `bun run test:capsule-oci-build` runs the production Vibecanvas compiler port
  twice, checks deterministic bytes, and proves a hostile `node:fs` import is
  denied. Adapter boundary tests also prove hostile UI bytes reach only the
  injected Capsule compiler and that CSS imports and URL assets close inside
  that boundary.
- `bun run test:widget-artifacts`, `bun run test:widget-host`, and
  `bun run test:m10:load` cover artifact recovery, host integration, population
  ceilings, and cleanup.
- `bun run test:packed-public-composition` proves the public packages install,
  typecheck, test, and execute from packed tarballs in a clean consumer.

## Explicitly unsupported

- Arrow packages or Arrow sandbox patches;
- manifest v2 or aliases for it;
- the old custom browser UI artifact envelope;
- dual runtimes, source-compilation fallback, or automatic artifact conversion;
- guest-selected tenant, revision, instance, provider, resource, or filesystem
  authority;
- snapshot parking in the first release.
