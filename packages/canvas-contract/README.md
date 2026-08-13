# `@omnidraw/canvas-contract`

The transport-neutral, versioned Canvas document contract. It owns the
complete serialized authored-node model, commands, queries, snapshots, events,
strict validation, deterministic codecs, and shared conformance vectors.

It has no rendering engine, UI framework, Effect, theme registry, database,
authority, application, or protocol dependency.

## Document model

`TCanvasDocument` (also exported as `TCanvasSnapshot`) is the complete document
boundary and always carries `schemaVersion: "1.0.0"`. Its `canvas_items`-shaped
entries contain one authored node plus durable revision and timestamp metadata.

The authored union includes groups, rectangles, ellipses, polygons, paths,
images, connectors, widget frames, and text. Layers, backgrounds, HTML portals,
widget portal placement, and 3D viewport references are runtime or
renderer-owned and are rejected at decode time.

The types are structurally compatible with renderer adapters but this package
does not import or expose renderer-owned types. Known `omnidraw:*` extensions
are strictly validated; unknown namespaced JSON extensions remain portable.
Legacy widget bindings and unversioned documents are rejected rather than
normalized.

## Codecs

The root and `./codecs` entrypoints expose schemas and codecs for nodes,
documents, commands, queries, pages, and events. Parsing validates unknown
input, rejects non-JSON or non-finite data, and returns a detached value.
Stringification recursively sorts object keys, normalizes negative zero, and
preserves array order for stable hashing and replay.

```ts
import {
  CanvasDocumentCodec,
  type TCanvasDocument,
} from "@omnidraw/canvas-contract";

const document: TCanvasDocument = CanvasDocumentCodec.parse(jsonText);
const canonicalJson = CanvasDocumentCodec.stringify(document);
```

## Document transport

A host supplies a protocol-neutral `TCanvasDocumentTransport` with
`getSnapshot`, `query`, `execute`, and `subscribe`. Subscriptions are async
iterables whose iterator must promptly settle a pending `next()` when
`return()` is called.

The `./conformance` entrypoint exports valid authored fixtures, invalid boundary
vectors, and canonical JSON vectors for every adapter to run unchanged.

## Release verification

```sh
bun run typecheck
bun run test
bun run build
```
