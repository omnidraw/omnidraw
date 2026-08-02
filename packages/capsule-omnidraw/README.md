# @omnidraw/capsule-omnidraw

Omnidraw integration surfaces for Capsule widget builds and browser hosting.

## Public subpaths

- `@omnidraw/capsule-omnidraw/contract`: product API and budget contracts.
- `@omnidraw/capsule-omnidraw/build`: build policy and injected signing.
- `@omnidraw/capsule-omnidraw/builder`: the supported widget artifact builder.
- `@omnidraw/capsule-omnidraw/host`: browser-safe Capsule host adapters.
- `@omnidraw/capsule-omnidraw/capabilities`: browser-safe capability schemas.
- `@omnidraw/capsule-omnidraw/testkit`: supported test-only fixtures and keys.

Builder and signing operations run on a server runtime compatible with
`@omnidraw/capsule@0.10.2`. Signing keys and cryptographic operations are
injected; no key material or registry configuration is embedded in the
package. The `host` and `capabilities` entry points do not import the build
or signing implementation and are safe to bundle for browsers.

## Package build

```sh
bun run build
npm publish ./dist
```

The generated `dist/` directory is the standalone npm package. Its manifest
resolves development-only dependency references to public versions.
