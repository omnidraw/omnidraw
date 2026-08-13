# Canvas Architecture

## Public composition boundary

The package receives one minimal descriptor (`{ id }`), one opaque stable host
scope key, and one readonly dependency bundle:

```text
OSS shell or managed-style host
  -> host scope + descriptor
  -> document transport (snapshot / query / execute / async event stream)
  -> theme, image, notification, ID, and cancelable wait ports
  -> optional host retirement registration, diagnostics owner, extensions,
     and toolbar contributions
  -> Canvas
       -> CanvasRuntimeLifecycle
       -> CanvasDocumentService
       -> Cangine
```

The host owns authentication, tenant authorization, protocol clients, browser
export effects, shell state, and product tools. Canvas has no API, oRPC,
database, frontend, AI, sidebar, or managed implementation dependency. A scope
key or canvas-ID change replaces the runtime serially.

When a host supplies the lifecycle-only host retirement port, Canvas registers
its async lifecycle disposal. A tenant-aware host awaits every
registration before disconnecting old tenant infrastructure or activating the
next scope; this is a narrow lifecycle seam, not a service locator.

The document transport contract lives in `@omnidraw/canvas-contract` so an OSS
oRPC adapter, an in-memory host, and a managed Cell adapter compile against the
same boundary. When canvas calls `AsyncIterator.return()`, an adapter must
promptly close its underlying event stream. Disposal also cancels each active
host wait; cancellation must settle the wait promise so recovery cannot remain
parked after teardown.

The package has one local-document boundary. Its asynchronous lifecycle and
event consumption run on one instance-owned Effect runtime; Effect types do not
cross the public API:

```text
pointer / keyboard / product intent
  -> Cangine plans one immutable command batch
  -> CanvasDocumentService accepts the local document change synchronously
     -> authored fallback map + optimistic runtime-node map + custom history + pending ledger
     -> exactly one Cangine scene.apply projection
     -> immediate successor-revision receipt
  -> asynchronous Canvas command
  <- ordered acknowledgement / remote event / resync
  -> accepted rows, then optimistic document, then Cangine projection
```

The browser owns current-session optimistic state. The server owns durable rows,
item revisions, and concurrency decisions. Cangine owns editor planning,
including `SelectionStyleController` target discovery, semantic style state,
atomic mutation planning, and continuous history framing. It also owns
transient interaction, resources, and rendering; its scene is a projection,
not the source of document truth.

`CanvasDocumentService` keeps these states distinct:

1. latest server-accepted item snapshots and canvas revision;
2. the optimistic authored-node map used for durable diffs and fallback paint;
3. the viewer-theme-projected runtime-node map projected to Cangine;
4. pending local transactions with command IDs, affected IDs, plans, and media
   gates;
5. bounded custom undo/redo history; and
6. adopted image Blobs and durable-resource metadata.

The pure local reducer applies public serialized command semantics before any
mutable publication and returns only affected before/after node images. The
document service converts those images to authored Canvas operations,
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

`buildRuntime` composes Cangine, its standard editor session, one headless
selection-style controller, the document service, optional extensions, and
host resize ownership. Style mutations still commit through the controlled
editor port into `CanvasDocumentService`; the controller is not a second scene
writer. Shutdown destroys it before the editor session.
Theme changes update the mounted editor selection and path appearance through
Cangine 0.6.1 setters without rebuilding that session. Cangine's creation
decorator adds resolved concrete fallback plus semantic intent for every
standard tool. Its extension-only style-mutation decorator adds or removes the
same intent after Cangine has resolved compatible leaves, so the finalized
concrete and extension changes stay in one exact batch.
`CanvasRuntimeLifecycle` ensures two runtime instances never own the same host
concurrently.

Theme variables are applied to the individual `.omnidraw-canvas-host` element from
the injected `IThemeService`. Package CSS never resets the surrounding shell,
and both CSS and Cangine resolve fonts from assets emitted with this package.
Semantic paint is resolved from an immutable theme snapshot into concrete
Cangine values. Theme reprojection updates only runtime nodes; stored concrete
fallbacks, accepted Canvas revision, pending plans, and history remain
unchanged. Literal paint bypasses this projection.
The host owns and disposes an injected diagnostics owner; canvas only installs
temporary subscriptions while its runtime is active.

Recorder output is not used for persistence or product history. Durable product
writes go through `editor.commitSceneMutation()`; outside bootstrap/resync,
`CanvasDocumentService` is the sole `engine.scene` writer. The package
intentionally contains no protocol client, transport store, feature-plugin
graph, or second editor stack.
