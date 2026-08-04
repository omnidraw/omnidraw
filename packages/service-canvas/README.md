# @omnidraw/service-canvas

Portable authoritative canvas behavior for managed Omnidraw services.

`CanvasService` is the only durable canvas authority. It validates commands,
serializes mutations per canvas, publishes committed events, and reconstructs
its transient cache from the injected store.

## Installation

```sh
npm install @omnidraw/service-canvas
```

## Public API

```ts
import { CanvasService, type ICanvasStore } from '@omnidraw/service-canvas'
```

Construct the service with an `ICanvasStore` and optional history and cache
limits. The store implementation owns vendor-specific persistence and must
atomically apply mutations with the canvas revision. Canvas identity is the
complete durable scope for every read and write.

The service exposes snapshot and paged-item reads, authoritative command
execution, replayable subscriptions, per-canvas release, metrics, and
idempotent lifecycle shutdown. Calling `stop()` closes subscriptions and
drains serialized canvas work. A new service instance reconstructs state from
the store; no database or application router is bundled into this package.

## Package build

```sh
bun run build
npm publish ./dist
```

The generated `dist/` directory is the standalone npm package. Its manifest
contains exact public Omnidraw dependencies and no workspace path mappings.
