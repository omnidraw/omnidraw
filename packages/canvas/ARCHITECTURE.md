# Canvas Architecture

The package has one local-document boundary:

```text
pointer / keyboard / product intent
  -> Cangine plans one immutable command batch
  -> CanvasDocumentService accepts the local document change synchronously
     -> optimistic runtime-node map + custom history + pending ledger
     -> exactly one Cangine scene.apply projection
     -> immediate successor-revision receipt
  -> asynchronous CanvasService command
  <- ordered acknowledgement / remote event / resync
  -> accepted rows, then optimistic document, then Cangine projection
```

The browser owns current-session optimistic state. The server owns durable rows,
item revisions, and concurrency decisions. Cangine owns editor planning,
transient interaction, resources, and rendering; its scene is a projection,
not the source of document truth.

`CanvasDocumentService` keeps these states distinct:

1. latest server-accepted item snapshots and canvas revision;
2. the optimistic runtime-node map projected to Cangine;
3. pending local transactions with command IDs, affected IDs, plans, and media
   gates;
4. bounded custom undo/redo history; and
5. adopted image Blobs and durable-resource metadata.

The pure local reducer applies public serialized command semantics before any
mutable publication and returns only affected before/after node images. The
document service converts those images to authored `CanvasService` operations,
installs the optimistic state and pending record, projects the exact editor
commands once, and schedules persistence without waiting.

An own acknowledgement advances accepted state and retires its pending record;
an equal optimistic echo is not rendered again. Disjoint remote events update
accepted state, then unprotected optimistic nodes, then Cangine. Rejection,
overlap, revision gaps, and `resync-required` invalidate incompatible pending
work and history and reload one authoritative snapshot.

Prepared images use the same boundary. The document adopts and retains the
prepared Blob immediately, blocks its pending server command on upload, then
promotes the stable resource ID with a validated durable URL extension before
releasing the media gate. A source-less image row must never reach the server.

`buildRuntime` composes Cangine, its standard editor session, the document
service, optional extensions, and host resize ownership. Shutdown reverses
those resources. `CanvasRuntimeLifecycle` ensures two runtime instances never
own the same host concurrently.

Recorder output is not used for persistence or product history. Durable product
writes go through `editor.commitSceneMutation()`; outside bootstrap/resync,
`CanvasDocumentService` is the sole `engine.scene` writer. The package
intentionally contains no transport store, feature-plugin graph, or second
editor stack.
