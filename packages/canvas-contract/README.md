# `@omnidraw/canvas-contract`

Portable, versioned canvas data and transport contracts. This package has no
Solid, browser, database, API-router, or server-service dependency.

## Public surface

The root entrypoint exports the minimal `TCanvasDescriptor`, authored Cangine
item snapshots, commands, events, queries, `TCanvasDocumentTransport`, and
validation helpers. Deliberate `./CONSTANTS`, `./types`, and `./validation`
subpaths are also available.

`TCanvasDescriptor` contains only `id`. Product metadata belongs in the host's
own DTOs.

## Document transport

A host implements one protocol-neutral transport:

```ts
import type { TCanvasDocumentTransport } from "@omnidraw/canvas-contract";

const transport: TCanvasDocumentTransport = {
  getSnapshot: ({ canvasId }) => client.loadCanvas(canvasId),
  execute: (command) => client.executeCanvasCommand(command),
  subscribe: ({ canvasId, afterRevision }) =>
    client.canvasEvents({ canvasId, afterRevision }),
};
```

The subscription is an async iterable. Every iterator it creates must close
its underlying stream promptly when `AsyncIterator.return()` is called and
must settle a pending `next()` without waiting for another event. Canvas hosts
call `return()` when replacing or disposing a document runtime.

## Release verification

```sh
bun run typecheck
bun run test
bun run build
```

The published package contains built ESM and declarations under `dist/`.
