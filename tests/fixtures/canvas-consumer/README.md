# Canvas external consumer fixture

This is a source fixture for a clean browser host, not a workspace package.
Its manifest uses exact published versions, its TypeScript configuration does
not extend the repository configuration, and its source imports documented
package exports only.

`src/transports.ts` contains two transport compositions:

- an in-memory document transport with monotonic revisions, event replay, and
  prompt async-iterator cancellation;
- a fake managed-Cell adapter whose private request/client objects remain
  behind `TCanvasDocumentTransport`.

The permanent gate builds and packs `@omnidraw/canvas-contract`,
`@omnidraw/theme`, `@omnidraw/canvas`, and `@omnidraw/component-ai-chat`, copies this fixture into a
temporary directory, replaces only those four exact dependencies with the
new tarballs, and installs with a frozen clean lockfile. It then runs transport
tests, TypeScript, a Vite production build, and Playwright browser smokes:

```sh
bun run test:browser
```

The browser runs an in-memory/no-extension composition and a fake-Cell/host-
toolbar composition. Both load a snapshot, create and edit a rectangle,
observe document events, switch theme, load packaged CSS/fonts, and unmount
with no active subscription. The memory composition remains diagnostics-free;
the fake-Cell host constructs a diagnostics owner from the public
`createReproductionTrace` export with injected fake ports, records canvas
activity, and proves that the host disposes the owner after unmount.
