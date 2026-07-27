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
- The recorded Capsule consumer package is `@omnidraw/capsule@0.9.4`, source
  revision `fd2e4eddf1f4d07b2e9e9e473f7c95cb5496f64d`, package digest
  `sha256:0d39b40a978fc0ce483c64c40f83eb25fd77f6f970d361feb5a4875de6758189`,
  build API `0.1.0`, and runtime build digest
  `sha256:8d6786bf0775f33724c74ea6f71841f5e61dd86d0de7c2b6c3d6c61f9d4ea146`.

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
| Modern CSS | `shadow-browser-css-v1` in Capsule's closed ShadowRoot |
| CSS network images | Literal HTTPS/root-relative URLs under separately declared and granted `css-network-images-v1` |

Guest code may use a UI library only when its complete pinned dependency graph
can be built into the supported Capsule target. Runtime dynamic imports, Node
built-ins, ambient host objects, and arbitrary browser compatibility are not
part of this profile.

Native Shadow CSS keeps ordinary selector specificity and maps only the virtual
`html`, `body`, and `:root` aliases to Capsule's managed guest root. Custom
properties, math functions, gradients, modern layout/typography, transitions,
animations, media/container queries, and `@supports` are admitted by the
pinned grammar. Host/projection/document-global CSS remains denied.

CSS network images are ambient browser dependencies: the signed artifact
covers their literal URL text, not future response bytes, browser cache
entries, credentials, redirects, tracking, CSP behavior, or decoded memory.
URL-bearing custom properties and `var()` substitution in image sinks remain
denied so inherited or dynamically assigned values cannot bypass the grant.

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

## Host source build boundary

Vibecanvas runs frozen `npm ci` and the guest-controlled `npm run build` as the
server account, captures a bounded regular-file `dist/`, and gives only those
bytes to Capsule's external-distribution validator. Package lifecycle and build
scripts therefore have the server account's host authority; this risk is
accepted and is not covered by Capsule's runtime isolation. Server-function
source retains its separate trusted server build.

## Permanent evidence

- `bun run test:capsule-browser` runs real Chromium against a production Vite
  build. Its 22 checks cover plain DOM, SVG, Canvas 2D, React, signed release
  mounting, functions, collaboration, lifecycle, authority negatives, and
  terminal-zero teardown.
- `bun test apps/cli/tests/WidgetNpmDistributionBuild.test.ts` covers frozen
  install/build orchestration, provenance, bounded distribution capture, and
  cleanup. Adapter boundary tests exercise Capsule external-distribution
  admission and resource closure.
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
