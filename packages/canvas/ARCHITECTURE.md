# Canvas Package Architecture

This package renders a infinite canvas rendered by konvajs.

## Runtime
./src/runtime.ts

We have services (state and effects)
And plugins (ui, bootloaded)

The services don't see plugins or serviceRegistry.
Plugins don't see each other.

load by order: startable services and apply each plugin
Order matters here. Services can take others in constructor if depends on.

## How Element are registered

ToolService.registryTool -> Add to toolbar
ElementService.registerElement -> Add as renderable type

## How is Element are added to canvas

On load. Fetch crdt: convert TElement -> Konva.Node via scene-hydrator
Via Toolaction (draw/click) -> Preview adds to crdt -> triggers scene-hydrator again

## How Crdt works
On change you want to persist. Use crdt builder. call commit() method or rollback() if undo.

## How Widget works
Register via WidgetService
Will call internal services for you
