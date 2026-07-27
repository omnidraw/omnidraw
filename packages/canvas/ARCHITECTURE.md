# Canvas Architecture

The package has one narrow synchronization boundary:

```text
Cangine recorder -> CanvasDocumentService -> CanvasService transport
Cangine scene   <- CanvasDocumentService <- ordered revision events
```

The server owns committed item state and concurrency decisions. The browser
loads a complete snapshot, records optimistic Cangine edits, sends primitive
item commands with touched-path preconditions, and applies committed rows and
deletions in revision order.

`CanvasDocumentService` performs four jobs:

1. materialize snapshots beneath the runtime content layer;
2. diff authored scene nodes into set/remove patches;
3. serialize local commands and keep bounded local undo/redo entries;
4. reload on conflicts, resync requests, or revision gaps.

`buildRuntime` composes Cangine, its standard editor session, the document
service, optional extensions, and host resize ownership. Shutdown reverses
those resources. `CanvasRuntimeLifecycle` ensures two runtime instances never
own the same host concurrently.

The package intentionally contains no alternate scene model, transport store,
feature-plugin graph, or second editor stack.
