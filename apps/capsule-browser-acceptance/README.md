# Capsule browser acceptance

This isolated app builds fresh source-authoritative widget artifacts, signs
their exact Capsule bytes with ephemeral Ed25519 preview and release keys, and
exercises the production Vibecanvas browser coordinator and mount port.

```sh
bun run --cwd packages/sdk build
bun run --cwd apps/capsule-browser-acceptance build
bun run --cwd apps/capsule-browser-acceptance dev
bun run test:capsule-browser
```

The generated browser fixture contains only signed artifacts and raw public
verification keys. Private signing keys exist only in the trusted generator
process and are never written to browser output. `generated/`, `.tmp/`, and
`dist/` are intentionally ignored. The root test command serves the production
Vite output rather than relying on development-module behavior.

The page publishes its machine-readable result at
`window.__VIBECANVAS_CAPSULE_BROWSER_ACCEPTANCE__` and on the
`data-capsule-acceptance` document attribute. It covers:

- plain DOM with live SDK props, theme, and bounded notification output;
- exact SVG and Canvas2D feature profiles;
- the pinned React TSX projection with native Shadow CSS, inherited host custom
  properties, modern math/layout/query/animation syntax, dynamic inline style
  parity, and a separately granted root-relative CSS image request;
- a release-signed published guest with an exact generated server-function
  capability and collaborative get/change/subscribe behavior;
- active, throttled, frozen, and resumed lifecycle states;
- wrong-key, tampered-byte, wrong-hash, wrong-target, wrong-authority,
  deployment-policy, grant, binding, and schema rejection;
- idempotent destruction and terminal zero-retention diagnostics.

Capsule testkit is intentionally not attached: the production mount port does
not expose test-only authority. Guest-observable checks use the same validated
output channel as production widgets, and lifecycle cleanup uses production
diagnostics.

`test:capsule-browser` verifies the production build, starts the acceptance
server with fresh artifacts, and uses headless Chromium to assert the complete
published result.

The Vite build intentionally uses no WASM or top-level-await transform plugin.
Capsule’s QuickJS browser distribution is self-contained, and preserving its
exact module namespace is part of the runtime bootstrap check.
