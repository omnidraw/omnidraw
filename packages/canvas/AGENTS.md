# Canvas Package Guide (`@vibecanvas/canvas`)

## What this package is

`@vibecanvas/canvas` is a Konva-based collaborative canvas runtime with:
- a thin Solid host component
- a runtime/plugin system built on `@vibecanvas/runtime`
- Automerge-backed scene persistence through `DocHandle<TCanvasDoc>`
- service-based shared state and side effects
- feature plugins for selection, transforms, shapes, text, images, grouping, render order, overlays, and hydration

Public entrypoint:
- `packages/canvas/src/index.ts`
- `packages/canvas/src/components/Canvas.tsx`

## High-level architecture

Runtime flow:

```text
Canvas.tsx
  -> resolves Automerge DocHandle
  -> buildRuntime(config)
  -> runtime boots scene/camera/crdt services
  -> plugins register tools, serializers, creators, listeners, overlays
  -> scene-hydrator loads groups/elements from CRDT doc
  -> user actions update Konva nodes
  -> plugins serialize nodes back through CrdtService
```

The important architectural pieces are:

1. `Canvas.tsx`
2. `runtime.ts`
3. services
4. plugins
5. core `fn.* / fx.* / tx.*` helpers
6. Solid overlay components

## Keep these boundaries

### `Canvas.tsx` stays thin

`packages/canvas/src/components/Canvas.tsx` should mainly:
- resolve `canvas.automerge_url`
- create and destroy the runtime
- pass app-level dependencies and callbacks
- render loading/error shell

Do not move editor behavior into the host component.

### `runtime.ts` is the composition root

`packages/canvas/src/runtime.ts` is the package runtime entry.
It defines:
- runtime config
- shared hooks
- service registry wiring
- plugin list and order
- boot/shutdown behavior

If you need shared runtime-wide wiring, this is the place.

### Services own shared mutable/runtime state

Current stable services:
- `scene` — Konva stage and 3 layers, resize handling
- `camera` — pan/zoom and camera change hook
- `crdt` — document reads, patch/delete writes, change listening
- `editor` — tool registry, active tool, editing state, preview node, transformer, node/element registries
- `selection` — selection array, focused id, current mode
- `history` — undo/redo
- `contextMenu` — provider registry and current menu state
- `renderOrder` — z-index ordering, persisted order changes, history integration
- `logging` — logging service
- `theme` — injected `ThemeService`

WIP / ignore as architecture:
- `widget`

If state is shared across features, prefer a service over hiding it inside one plugin.

### Plugins own feature behavior

Plugins should remain the main place for feature orchestration.
They use services and hooks rather than coupling directly to each other.

### Pure logic belongs in `fn.*`, reads in `fx.*`, writes in `tx.*`

This package already follows the monorepo functional-core bias heavily.
When adding feature-local logic:
- keep orchestration in the main plugin/service file
- extract pure logic into sibling `fn.*.ts`
- extract impure reads into sibling `fx.*.ts`
- extract impure writes into sibling `tx.*.ts`
- use `CONSTANTS.ts` for shared local constants when needed

## Scene model

`SceneService` owns a stage with three layers:

1. `staticBackgroundLayer`
   - viewport-derived visuals
   - primary use: grid
   - not camera-transformed

2. `staticForegroundLayer`
   - persisted scene content
   - groups, shapes, text, images
   - camera-transformed

3. `dynamicLayer`
   - transient interaction UI
   - selection rect, transformer, previews, edit handles, group boundaries
   - camera-transformed

This layer split is intentional. Keep it.

## Current plugin stack

`buildRuntime()` currently installs plugins in this order:

1. `event-listener`
2. `grid`
3. `toolbar`
4. `selection-style-menu`
5. `context-menu`
6. `history-control`
7. `render-order`
8. `select`
9. `transform`
10. `shape1d`
11. `shape2d`
12. `pen`
13. `text`
14. `image`
15. `group`
16. `scene-hydrator`
17. `visual-debug`
18. `camera-control`
19. `hosted-component` **(WIP; ignore unless task explicitly targets it)**

In dev, `recorder` is inserted before `history-control`.

## What each stable plugin does

### `event-listener`
Bridges raw stage/container events into runtime hooks:
- pointer
- wheel
- keyboard
- element click/down/double-click

### `grid`
Draws the viewport grid into `staticBackgroundLayer`.
Uses local `fn.math.ts` and `tx.draw.ts` split.

### `toolbar`
Mounts the Solid toolbar UI and drives tool selection from `EditorService`.
Important rule:
- tools should be registered by feature plugins through `EditorService`
- toolbar should render from the tool registry
- do not reintroduce hardcoded toolbar feature lists

Base tools registered here:
- `hand`
- `select`

### `selection-style-menu`
Mounts a Solid style inspector for the focused selection.
Applies style changes through CRDT + history-aware helper code.

### `context-menu`
Owns right-click hit testing and menu UI mount.
Actions come from `ContextMenuService` providers.
Feature plugins should register providers instead of building their own menu systems.

### `history-control`
Keyboard wiring for undo/redo.

### `render-order`
Registers context-menu actions and uses `RenderOrderService` to persist z-order changes.
Important detail:
- z-order is persisted back into document `zIndex`
- bundle resolvers keep linked nodes ordered together when needed

### `select`
Owns selection behavior:
- click selection
- nested selection path behavior
- marquee selection
- delete keyboard handling

Selection state still stores live Konva nodes plus a focused id.
That is current reality.

### `transform`
Owns the shared `Konva.Transformer` and transform persistence.
Also provides a drag proxy for single shape1d/pen selections.
Uses selection filtering and editor registries to serialize/apply changes.

### `shape1d`
Owns line and arrow behavior:
- tool registration
- draw-create flow
- serialization and hydration
- drag/clone behavior
- point editing with anchor and insert handles
- history integration

### `shape2d`
Owns rect, diamond, and ellipse behavior:
- tool registration
- draw-create flow
- serialization and hydration
- drag/clone behavior
- inline text owned by shape2d persisted data
- runtime-only derived text nodes for inline text rendering/editing

### `pen`
Owns freehand pen behavior:
- tool registration
- draw-create flow
- path serialization/hydration
- drag/clone behavior
- theme-aware rendering

### `text`
Owns free-text behavior:
- tool registration
- click-create text
- textarea edit mode
- drag/update/serialization
- theme-aware text updates

Note:
- free text stays a standalone `text` element
- shape inline text is not owned by the text plugin anymore
- shape2d owns inline text data and editing entrypoints

### `image`
Owns image behavior:
- toolbar action tool
- file picker
- paste/drop insertion
- serialization/hydration
- drag/clone behavior
- backend image upload/clone/delete integration via runtime config

### `group`
Owns grouping behavior:
- group creation and removal
- boundary visuals
- draggability sync
- clone-drag for groups
- serialization of group subtrees
- CRDT/history integration

### `scene-hydrator`
Rebuilds the runtime scene from the CRDT document.
Current behavior:
- loads groups top-down
- loads elements after parents exist
- deletes invalid elements with missing data
- sorts by persisted order
- reloads on non-local CRDT changes
- restores selection/editor state after reload where possible

This is a real live hydrate/reload path now, not just a startup stub.

### `camera-control`
Owns wheel zoom and pan behavior through `CameraService`.

### `recorder` (dev only)
Development-only event/CRDT recorder UI.
Useful for debugging and regression capture.
Do not treat it as production architecture.

### `visual-debug`
Development/debug rendering helpers.

## Registry model

### `EditorService`

`EditorService` owns transient editor state:
- registered tools
- active tool id
- editing text id
- editing shape1d id
- preview node

Use it when:
- registering a user-facing creation tool
- switching active tools
- tracking edit mode state

### `CanvasRegistryService`

`CanvasRegistryService` is the runtime registry for persisted scene content.
It owns the mapping between runtime nodes and persisted elements/groups.

Important element hooks you can register:
- `matchesElement`
- `matchesNode`
- `toElement`
- `createNode`
- `attachListeners`
- `updateElement`
- `createDragClone`
- `getSelectionStyleMenu`
- `getTransformOptions`
- transform hooks like `onResize` / `afterResize`

Important mental model:
- `createNode(element)` creates the root runtime node for one persisted element
- `toElement(node)` serializes that runtime node back to one persisted element
- `updateElement(element)` must be able to replay persisted state onto the already-mounted runtime node
- if an element needs extra visuals, prefer runtime-only derived children or one returned root `Konva.Group`

When adding a new scene element type, the normal pattern is:
1. update the persisted schema in `packages/service-automerge/src/types/canvas-doc.zod.ts`
2. create a plugin under `src/plugins/<feature>`
3. register an element definition in `CanvasRegistryService` with at least:
   - `matchesElement`
   - `matchesNode`
   - `toElement`
   - `createNode`
   - `attachListeners`
   - `updateElement`
4. register a tool in `EditorService` if users can create it directly
5. insert created roots through `RenderOrderService`
6. persist creates/updates/deletes through `CrdtService`
7. add tests using the runtime harness in `packages/canvas/tests/new-test-setup.ts`

## New element checklist

When you add a new persisted element type, make sure all of these exist:

1. **Persisted contract**
   - schema in `service-automerge`
   - inferred types compile cleanly

2. **Runtime create path**
   - `createNode(element)` returns the root runtime node
   - new nodes are added to the right parent/layer
   - insertion goes through `RenderOrderService.assignOrderOnInsert(...)`

3. **Runtime serialize path**
   - `toElement(node)` round-trips the runtime node back to persisted data
   - this must work for freshly created nodes, dragged nodes, transformed nodes, and clones

4. **Replay/update path**
   - `updateElement(element)` updates an existing mounted node from persisted state
   - hydrate/reload/undo/redo should not need special ad-hoc reconstruction outside this contract

5. **Interaction wiring**
   - `attachListeners(node)` or local `tx.setup-node.ts` wires pointer/drag/transform behavior
   - selection integrates with the shared select/transform plugins

6. **Hydration path**
   - `scene-hydrator` can rebuild it only through `canvasRegistry.createNodeFromElement(...)`
   - if your element needs derived runtime children, they must be recreated from `updateElement(element)` after the root node has been added to its parent

7. **History + CRDT path**
   - create/update/delete actions patch through `CrdtService`
   - undo/redo restores the same element through persisted data, not hidden runtime state

8. **Delete/group/ungroup path**
   - if the element uses derived runtime-only children, these must not be treated as standalone persisted elements
   - restore flows that re-add the root node should call `canvasRegistry.updateElement(element)` so derived children come back too

9. **Selection style / transform path**
   - register `getSelectionStyleMenu` if the element exposes style controls
   - register transform options/hooks if resize/rotate behavior is custom

## Clone-drag checklist

If your new element is supposed to support clone-drag, the usual missing pieces are:

1. **A registry clone handler exists**
   - register `createDragClone` on the matching `CanvasRegistryService` element definition

2. **Your listener path actually starts clone-drag**
   - `attachListeners(...)` or `tx.setup-node.ts` must detect the modifier drag path
   - current convention is Alt/Option-drag for clone-drag

3. **`toElement(...)` works for the preview clone**
   - clone finalization depends on serializing the preview/final node back into a persisted `TElement`
   - if `toElement(...)` returns `null`, clone-drag finalization is effectively broken

4. **Finalization does the full handoff**
   - move preview from `dynamicLayer` to the final parent/layer
   - attach runtime listeners/setup to the final node
   - assign order with `RenderOrderService`
   - patch the created element through `CrdtService`
   - record undo/redo in `HistoryService`

5. **Derived runtime children are handled correctly**
   - if one logical element renders extra runtime nodes, prefer them to be runtime-only derived children
   - rebuild them from `updateElement(element)`
   - call `canvasRegistry.updateElement(element)` after hydrate/redo/group/ungroup restore paths re-add the root node
   - register a `RenderOrderService` bundle resolver if the root and derived children must move together in z-order
   - make delete snapshot logic ignore runtime-only derived children

6. **Hydrate + redo can recreate the clone from persisted data alone**
   - if redo only recreates the root node but not its derived runtime children, clone-drag will look half-broken even though the CRDT write succeeded

If clone-drag is broken, check these in order:
- missing `createDragClone`
- missing modifier-drag wiring in `attachListeners`
- missing or incorrect `toElement`
- missing CRDT patch on finalize
- missing render-order insertion/bundle resolver
- missing derived-child rebuild in `updateElement`

## CRDT boundary

`CrdtService` is the write boundary for canvas docs.
Use it for document mutations instead of direct scattered `docHandle.change(...)` calls.

Current responsibilities:
- expose current doc
- patch elements/groups
- delete elements/groups by id
- emit change hook on Automerge change/delete
- distinguish pending local changes from remote/external ones

Important runtime behavior:
- scene hydrator ignores consumed local change events to avoid pointless full reloads
- non-local changes can trigger scene rebuild

## Render order model

`RenderOrderService` is the current source of truth for scene ordering behavior.
It:
- calculates ordered siblings
- applies z-index updates to runtime nodes
- persists order into CRDT
- records order changes into history
- supports bundle resolvers for linked nodes

Use it when inserting or reordering nodes.
Do not hand-roll z-index persistence in feature plugins unless there is a very specific reason.

## Overlay UI model

Solid UI overlays are mounted into `stage.container()`.
Current overlays include:
- toolbar
- context menu
- help data consumers
- recorder
- selection style menu

Preferred pattern:
- create a DOM mount node
- append it to `stage.container()`
- render Solid into it
- remove it on destroy

## Tests

Current tests live under:
- `packages/canvas/tests/plugins`
- `packages/canvas/tests/services`
- `packages/canvas/tests/components`
- `packages/canvas/tests/scenarios`

Useful harness files:
- `packages/canvas/tests/new-test-setup.ts` — current runtime harness via `buildRuntime()`
- `packages/canvas/tests/test-setup.ts` — older harness around `CanvasService`; mostly historical/reference now

When adding coverage for current behavior, prefer the runtime-based harness.

## Recommended extension paths

### Add a new tool-backed feature

Preferred path:
1. create a plugin under `src/plugins/<feature>`
2. register a tool in `EditorService`
3. use selection/editor/scene/crdt/history services
4. register serializers/creators/updaters in `CanvasRegistryService`
5. mount overlay UI only if needed
6. add runtime-based tests under `tests/plugins`

### Add shared state or shared runtime capability

Preferred path:
1. add or extend a service under `src/services`
2. register it in `runtime.ts`
3. keep plugin logic thin around that service

### Add a new persisted node type

Preferred path:
1. define runtime node creation from `TElement`
2. define node serialization back to `TElement`
3. register create/serialize/listener/update hooks in `CanvasRegistryService`
4. insert through `RenderOrderService`
5. persist through `CrdtService`
6. make sure hydrate/reload/undo/redo works from persisted data only
7. if clone-drag is expected, implement `createDragClone`
8. add tests

## Package folder map

### Core entry and runtime
- `packages/canvas/src/index.ts`
- `packages/canvas/src/components/Canvas.tsx`
- `packages/canvas/src/runtime.ts`

### Services
- `packages/canvas/src/services/camera`
- `packages/canvas/src/services/context-menu`
- `packages/canvas/src/services/crdt`
- `packages/canvas/src/services/editor`
- `packages/canvas/src/services/history`
- `packages/canvas/src/services/logging`
- `packages/canvas/src/services/render-order`
- `packages/canvas/src/services/scene`
- `packages/canvas/src/services/selection`
- `packages/canvas/src/services/widget` **WIP / ignore**

### Plugins
- `packages/canvas/src/plugins/camera-control`
- `packages/canvas/src/plugins/context-menu`
- `packages/canvas/src/plugins/event-listener`
- `packages/canvas/src/plugins/grid`
- `packages/canvas/src/plugins/group`
- `packages/canvas/src/plugins/history-control`
- `packages/canvas/src/plugins/hosted-component` **WIP / ignore**
- `packages/canvas/src/plugins/image`
- `packages/canvas/src/plugins/pen`
- `packages/canvas/src/plugins/recorder`
- `packages/canvas/src/plugins/render-order`
- `packages/canvas/src/plugins/scene-hydrator`
- `packages/canvas/src/plugins/select`
- `packages/canvas/src/plugins/selection-style-menu`
- `packages/canvas/src/plugins/shape1d`
- `packages/canvas/src/plugins/shape2d`
- `packages/canvas/src/plugins/text`
- `packages/canvas/src/plugins/toolbar`
- `packages/canvas/src/plugins/transform`
- `packages/canvas/src/plugins/visual-debug`

### Shared logic
- `packages/canvas/src/core`

### UI components
- `packages/canvas/src/components/FloatingCanvasToolbar`
- `packages/canvas/src/components/CanvasContextMenu`
- `packages/canvas/src/components/CanvasHelp`
- `packages/canvas/src/components/CanvasRecorder`
- `packages/canvas/src/components/SelectionStyleMenu`
- `packages/canvas/src/components/file`
- `packages/canvas/src/components/filetree`
- `packages/canvas/src/components/terminal`

## Working rules for this package

When changing canvas code:
- prefer current services/plugins/runtime architecture
- prefer service + plugin composition over giant files
- prefer feature-local `fn/fx/tx` extraction
- prefer `EditorService` registries over hardcoded shape/tool branching in unrelated files
- prefer `RenderOrderService` for insertion/reordering
- prefer `CrdtService` for document writes
- keep `Canvas.tsx` thin
- keep overlay UI in DOM/Solid, not Konva, unless it is truly canvas geometry

And specifically:
- do not reintroduce old migration language into docs
- do not describe `src/services/widget` as stable
- do not describe `src/plugins/hosted-component` as stable
