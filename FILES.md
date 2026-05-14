# FILE LIST
Every file must be added here.
This is an important book keeping files.
We need to document if file is slopfree.
Some files are more important than others.
Human review can mark file as clean/minor.
You must update this file after making any edits.
Always take clean files as base reference for edits.
Learn from clean files to produce less slop.

Rules:
- add new entry on file creation (unreviewed)
- delete entry on file deletion
- edit clean file -> MUST MARK AS r!
- edit slop -> keep s
- never add clean or minor by yourself
- entries are grouped by apps/packages
- no test files
- only packages/* and apps/* are listed

Legend
 - ❓ unreviewed
 - 🤖 ai-touched / needs re-review
 - 🫠 slop
 - ✅ clean
 - 🟡 minor

Path rule
- each section may define a `prefix`
- file rows use `filepath` values relative to that prefix
- resolve with: `fullpath = prefix + filepath`
- prefixes should end with `/`
- when a section has no prefix, filepath is already the full repo-relative path


## root

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `log-auth-permissions-task.txt` |  | Progress log for auth permissions schema/service/plugin migration task. |
| 🤖 | `tsconfig.json` |  | Root TypeScript defaults shared by package configs; keep source inclusion package-scoped for IDE sanity. |

## packages/canvas
prefix: `packages/canvas/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| 🤖 | `../.gitignore` |  | Canvas local test artifacts and perf result files ignored from commits. |
| 🤖 | `../AGENTS.md` |  | Canvas package guidance and active source folder map. |
| ❓ | `../PERFORMANCE.md` |  | Canvas performance KPIs, hot paths, measurement plan, and initial findings. |
| 🤖 | `../package.json` |  | Canvas package manifest; update when adding canvas runtime dependencies or local test scripts. |
| 🤖 | `../tsconfig.json` |  | Canvas TypeScript config for browser canvas source and package tests. |
| 🟡 | `automerge.ts` |  | Browser Automerge repo, persisted doc handles, WebSocket sync |
| 🫠 | `base.css` |  | Global theme tokens, dark mode, baseline element resets |
| ❓ | `components/Canvas.tsx` |  | Automerge-backed canvas runtime mount, loading, teardown orchestration |
| ❓ | `components/CanvasContextMenu/index.css` |  | Canvas right-click menu popover styling and item states |
| ❓ | `components/CanvasContextMenu/index.tsx` |  | Right-click canvas action menu at cursor position |
| ❓ | `components/CanvasHelp/help.data.ts` |  | Update help shortcuts, sections, and callout copy together |
| ❓ | `components/FloatingCanvasToolbar/RuntimeToolbar.tsx` |  | Floating toolbar UI: sanitize SVG icons, reflect editor tool state |
| 🤖 | `components/FloatingCanvasToolbar/styles.css` |  | Floating canvas/runtime toolbar visuals, states, tooltips, keycap hints |
| ❓ | `components/FloatingCanvasToolbar/toolbar.types.ts` |  | Toolbar tool roster and keyboard shortcut mapping source |
| 🤖 | `components/FloatingCanvasToolbar/ToolButton.tsx` |  | Floating toolbar button with shortcut label layout |
| ❓ | `components/SelectionStyleMenu/CapPicker.tsx` |  | Arrow endpoint cap style buttons for selection menu |
| ❓ | `components/SelectionStyleMenu/ColorPicker.tsx` |  | Theme token swatches for fill/stroke selection popover |
| ❓ | `components/SelectionStyleMenu/FontFamilyPicker.tsx` |  | Text styling panel font family option grid selector |
| ❓ | `components/SelectionStyleMenu/FontSizePicker.tsx` |  | Text selection font-size preset token picker |
| ❓ | `components/SelectionStyleMenu/LineTypePicker.tsx` |  | Line style selector buttons for selection formatting |
| 🤖 | `components/SelectionStyleMenu/index.tsx` |  | Selection style menu shell, focus management, and escape handling |
| ❓ | `components/SelectionStyleMenu/OpacitySlider.tsx` |  | Opacity drag math, pointer capture, percent display synchronization |
| ❓ | `components/SelectionStyleMenu/StrokeWidthPicker.tsx` |  | Stroke width option chips inside selection styling menu |
| ❓ | `components/SelectionStyleMenu/TextAlignPicker.tsx` |  | Text alignment toggle in selection style controls |
| ❓ | `components/SelectionStyleMenu/types.ts` |  | Selection toolbar option catalogs and style value unions |
| ❓ | `components/SelectionStyleMenu/VerticalAlignPicker.tsx` |  | Text box vertical alignment toggle buttons |
| 🤖 | `core/CONSTANTS.ts` |  | Image MIME whitelist and canvas node z-index/remove-callback attrs |
| ✅ | `core/fn.canvas-node-semantics.ts` |  | helper canvas node getter |
| ✅ | `core/fn.create-ordered-z-index.ts` |  | Stable lexicographic z-order keys from numeric indices |
| ✅ | `core/fn.get-node-z-index.ts` |  | Resolve persisted node stacking order attribute safely |
| 🫠 | `core/fn.image-utils.ts` | mixed pure+impure in fn file | Image upload normalization: mime validation, data URLs, dimensions, sour |
| ✅ | `core/fn.pretext.ts` |  | Canvas text font shorthand for rendering/measurement |
| 🫠 | `core/fn.selection-style-menu.ts` | too big; mixed responsibilities | Selection style menu sections, defaults, overrides for chosen elements |
| ✅ | `core/fn.shape2d.ts` |  | Shape tool drafts, bounds, type mapping, element creation |
| ✅ | `core/fn.text-style.ts` |  | Text sizing/alignment presets and proportional preset scaling |
| ✅ | `core/fn.world-position.ts` |  | Pointer/world coordinate conversion across parent transforms |
| ✅ | `core/fn.filter-selection.ts` |  | Nested canvas selection collapsing to deepest live sub-selection |
| ❓ | `core/fx.node-space.ts` |  | Konva node absolute-to-layer-local coordinate conversion |
| ❓ | `core/fx.pretext.ts` |  | Pretext line-wrapped text measurement before canvas rendering |
| ✅ | `core/fx.resolve-selection-style-elements.ts` |  | Resolve style-target elements from selection or focused node |
| ✅ | `core/fn.resolve-selection-style-text-elements.ts` |  | Selection styling: normalize direct and attached text elements |
| ✅ | `core/fx.selection-style-element-patch.ts` |  | Selection style edits: clone element, patch text/line/arrow fields |
| 🤖 | `core/GUARDS.ts` |  | Shared Konva/canvas node type guards |
| ✅ | `core/tx.apply-selection-style-change.ts` |  | Selected elements style mutation planning, preview, CRDT commit, undo/re |
| ❓ | `core/tx.finalize-owned-transform.ts` |  | Finalize owned-node transform, patch CRDT, record undo/redo history |
| ❓ | `core/tx.set-node-z-index.ts` |  | Persist custom z-layer ordering on Konva nodes |
| ❓ | `plugins/camera-control/CameraControl.plugin.ts` |  | Pan/zoom plugin |
| ✅ | `plugins/camera-control/fn.get-hand-layer-style.ts` |  | Hand tool layer visibility, interactivity, and cursor state |
| ✅ | `plugins/camera-control/fn.get-pointer-delta.ts` |  | Pointer drag delta for camera pan updates |
| ✅ | `plugins/camera-control/fn.normalize-camera-state.ts` |  | Sanitize persisted camera viewport before applying pan/zoom |
| ❓ | `plugins/camera-control/fx.read-camera-state-from-localstorage.ts` |  | Restoring persisted camera viewport per canvas startup |
| ❓ | `plugins/camera-control/tx.sync-hand-layer.ts` |  | Hand-overlay visibility, hit-testing, cursor synchronization during pann |
| ❓ | `plugins/camera-control/tx.write-camera-state-to-localstorage.ts` |  | Persist per-canvas camera viewport into localStorage safely |
| 🤖 | `plugins/context-menu/ContextMenu.plugin.ts` |  | Right-click hit-testing, selection/connection resolution, Solid canvas menu mounting |
| ❓ | `plugins/event-listener/EventListener.plugin.ts` |  | Bridge Konva stage and DOM input into runtime hooks |
| 🤖 | `plugins/filesystem/Filesystem.plugin.ts` |  | Trusted filesystem IDE widget plugin registration and creation flow. |
| ❓ | `plugins/filesystem/getLanguageExtension.ts` |  | CodeMirror language loading by file extension for filesystem editor tabs. |
| 🤖 | `plugins/filesystem/typed.ts` |  | Filesystem plugin local widget and API helper types. |
| 🤖 | `plugins/filesystem/widget.css` |  | Trusted filesystem IDE widget, embedded root picker, and VS Code dark styling. |
| 🤖 | `plugins/filesystem/widget.ts` |  | Arrow filesystem IDE widget with embedded root picker, file tree, tabs, and CodeMirror mount. |
| ✅ | `plugins/grid/fn.math.ts` |  | Grid spacing and line offsets from zoom/pan |
| ❓ | `plugins/grid/Grid.plugin.ts` |  | Registers toggleable canvas grid overlay reacting to camera theme resize |
| ❓ | `plugins/grid/tx.draw.ts` |  | Canvas viewport grid rendering: minor/major lines from pan+zoom layout |
| 🫠 | `plugins/group/fn.get-selection-bounds.ts` | brittle empty-selection edge case | Multi-node selection bounding box from transformed client rects |
| 🤖 | `plugins/group/fn.scene-node.ts` | bloated args; service-coupled guards | Konva scene node guards, group ancestry, ID lookup |
| 🫠 | `plugins/group/fn.serialize-subtree-elements.ts` | service read logic in fn file | Group subtree shape nodes to TElement serialization |
| ✅ | `plugins/group/fn.to-group-patch.ts` |  | Konva group serialization into Automerge patch payload |
| ❓ | `plugins/group/fx.create-group-boundary.ts` |  | Dashed themed group boundary overlay tracking transformed bounds |
| 🤖 | `plugins/group/Group.plugin.ts` |  | Canvas group lifecycle, boundaries, grouping shortcuts, clone-drag orche |
| ❓ | `plugins/group/tx.create-group-clone-drag.ts` |  | Group duplicate drag preview, subtree re-ID, CRDT commit on drop |
| 🤖 | `plugins/group/tx.group-selection.ts` |  | Groups selected scene nodes |
| ❓ | `plugins/group/tx.setup-group-node.ts` |  | Group drag lifecycle: selection, clone-alt-drag, CRDT/history sync, metr |
| ❓ | `plugins/group/tx.sync-draggability.ts` |  | Group nesting disables children dragging; selected nodes re-enable dragg |
| ❓ | `plugins/group/tx.sync-group-boundaries.ts` |  | Selected groups update boundary overlays and cleanup |
| 🤖 | `plugins/group/tx.ungroup-selection.ts` |  | Ungroup selected Konva group, preserve positions, sync CRDT undo/redo |
| ❓ | `plugins/history-control/HistoryControl.plugin.ts` |  | Intercepts Cmd/Ctrl+Z and Shift+Z for history undo/redo |
| ❓ | `plugins/hosted-component/HostedComponent.plugin.ts` |  | Hosted component plugin scaffold wiring required editor scene services |
| ❓ | `plugins/hosted-component/Todo.md` |  | Widget manager stores widgets; hosted component reacts/render lifecycle |
| ❓ | `plugins/hosted-component/tx.setup-tool.ts` |  | Repo guardrails: architecture, file conventions, workflow |
| ✅ | `plugins/image/fn.create-image-element.ts` |  | Center-placed image element creation from dimensions and source metadata |
| ✅ | `plugins/image/fn.fit-image-to-viewport.ts` |  | Initial viewport image fit sizing capped to half smaller viewport dimens |
| ✅ | `plugins/image/fn.to-image-element.ts` |  | Image payload → canonical canvas element |
| 🤖 | `plugins/image/Image.plugin.ts` |  | Image import, paste/drop, node sync, clone-drag orchestration |
| ❓ | `plugins/image/tx.clone-backend-file-for-element.ts` |  | Duplicate backend image asset, update node and CRDT URL |
| ❓ | `plugins/image/tx.create-image-clone-drag.ts` |  | Image clone drag finalizes preview, persistence, undo/redo, selection |
| 🤖 | `plugins/image/tx.insert-image.ts` |  | Image upload insertion |
| ❓ | `plugins/image/tx.setup-image-listeners.ts` |  | Attach image selection, clone-drag, multi-drag history listeners |
| ❓ | `plugins/image/tx.update-image-node-from-element.ts` |  | Sync Konva image node from canvas element state |
| 🤖 | `plugins/index.ts` |  | Canvas plugin barrel exports. |
| ✅ | `plugins/pen/fn.draft-element.ts` |  | Pen stroke points → draft canvas element |
| 🫠 | `plugins/pen/fn.style.ts` | sloppy details; unused strokeWidth arg | Pen style normalization, color-key selection, node-derived style cloning |
| ❓ | `plugins/pen/fx.path.ts` |  | Pen path metadata detection and element serialization helpers |
| ❓ | `plugins/pen/fx.start-draft.ts` |  | Initialize non-interactive pen draft node from first point |
| ❓ | `plugins/pen/Pen.plugin.ts` |  | Pen plugin orchestrates freehand drafting, hydration, drag, clone, trans |
| ❓ | `plugins/pen/tx.clone.ts` |  | Pen stroke duplicate preview drag, finalize CRDT-backed selectable clone |
| ❓ | `plugins/pen/tx.path.ts` |  | Konva pen node creation/update from themed element strokes |
| ❓ | `plugins/pen/tx.update-draft.ts` |  | Live pen draft stroke preview updates while drawing |
| 🫠 | `plugins/recorder/fn.recording.ts` | impure/event shaping living in fn file | Builds normalized recording steps and CRDT snapshots |
| 🤖 | `plugins/recorder/Recorder.plugin.ts` |  | Dev recorder plugin captures input/CRDT, mounts exportable replay panel |
| ❓ | `plugins/recorder/tx.file.ts` |  | JSON export save flow: picker first, anchor-download fallback |
| ❓ | `plugins/recorder/tx.mount.ts` |  | Mounts recorder overlay panel onto scene stage |
| ❓ | `plugins/render-order/RenderOrder.plugin.ts` |  | Canvas context-menu layer ordering for sibling selections |
| 🤖 | `plugins/scene-hydrator/SceneHydrator.plugin.ts` |  | Rehydrate Konva scene from CRDT via group/element services, preserving selection state |
| ✅ | `plugins/select/fn.get-selection-path.ts` |  | Ancestor canvas-node selection path from node to foreground layer |
| ❓ | `plugins/select/Select.plugin.ts` |  | Canvas selection, marquee drag, delete, drill-down interactions |
| 🤖 | `plugins/select/tx.delete-selection.ts` | group guard should me moved, needs better guard | Delete selected canvas nodes through element/group services with undo-redo |
| ❓ | `plugins/select/tx.handle-element-pointer-double-click.ts` |  | Double-click drills selection one level deeper along ancestry |
| ❓ | `plugins/select/tx.handle-element-pointer-down.ts` |  | Element click selection depth cycling, shift-toggle, focus updates |
| ❓ | `plugins/select/tx.handle-stage-pointer-move.ts` |  | Drag-select updates rect, intersects top-layer selectable nodes |
| 🤖 | `plugins/selection-style-menu/fx.mount-selection-style-menu.ts` |  | Selection styling overlay for selected elements and active tools |
| ❓ | `plugins/selection-style-menu/SelectionStyleMenu.plugin.ts` |  | Floating selection style popover wiring |
| 🤖 | `plugins/shape1d/CONSTANTS.ts` |  | Shape1d runtime constants, handle sizing, and style token defaults |
| ✅ | `plugins/shape1d/fn.draft.ts` |  | Shape1d draft and fallback preview element construction |
| ❓ | `plugins/shape1d/fn.selection-style.ts` |  | Shape1d selection-style defaults for line and arrow registry entries |
| 🤖 | `plugins/shape1d/fx.geometry.ts` |  | Shape1D coordinate transforms, insertion midpoints, anchor-drag geometry |
| 🤖 | `plugins/shape1d/fx.node.ts` |  | shape1d Konva guards, styling, world-position serialization |
| 🤖 | `plugins/shape1d/Shape1d.plugin.ts` |  | Line/arrow plugin: draft, edit handles, transform/history sync |
| 🤖 | `plugins/shape1d/tx.draft.ts` |  | Shape1d draft preview sync, cancel, and finalize helpers |
| 🤖 | `plugins/shape1d/tx.edit-mode.ts` |  | Shape1d edit-mode handles, enter/exit, and selection refresh |
| 🤖 | `plugins/shape1d/tx.element.ts` |  | Shape node sync and preview clone creation |
| 🤖 | `plugins/shape1d/tx.history.ts` |  | Shape1d undo/redo for element edits and creation |
| 🤖 | `plugins/shape1d/tx.register-shape1d-element.ts` |  | Register one full shape1d canvas element definition per tool/type |
| 🤖 | `plugins/shape1d/tx.register-shape1d-tool.ts` |  | Register one shape1d drawing tool and return cleanup |
| 🤖 | `plugins/shape1d/tx.render.ts` |  | Konva line/arrow node creation, caps, bounds, scene runtime |
| 🤖 | `plugins/shape1d/tx.runtime.ts` |  | Shape drag, clone-drag, multi-select movement, history/CRDT sync |
| 🤖 | `plugins/shape1d/tx.shape-move.ts` |  | Shape1d move session patching and drag history finalization |
| ❓ | `plugins/shape1d/typed.ts` |  | Shared local shape1d plugin state and move-session typings |
| 🤖 | `plugins/shape2d/CONSTANTS.ts` |  | Shape2d inline-text runtime attrs, ids, and derived node naming |
| 🤖 | `plugins/shape2d/fn.node.ts` |  | Konva node kind resolution via attrs plus runtime class guards |
| 🤖 | `plugins/shape2d/fn.text-host-bounds.ts` |  | Shape text layout bounds for rect, ellipse, diamond |
| 🤖 | `plugins/shape2d/fx.attached-text.ts` |  | Shape-embedded text creation, syncing, persistence, edit-mode handoff |
| 🤖 | `plugins/shape2d/fx.create-node.ts` |  | Shape2d element → themed Konva node |
| 🤖 | `plugins/shape2d/fx.to-element.ts` |  | Shape node → persisted element with inline text payload |
| 🤖 | `plugins/shape2d/Shape2d.plugin.ts` |  | Shape drawing lifecycle, preview, cloning, attached-text sync and removal cleanup |
| 🤖 | `plugins/shape2d/tx.create-clone-drag.ts` |  | Shape clone preview drag, finalize persist, history, linked duplicates |
| 🤖 | `plugins/shape2d/tx.setup-node.ts` |  | Shape node events: selection, clone-drag, multi-drag, CRDT history |
| 🤖 | `plugins/shape2d/tx.update-node-from-element.ts` |  | Syncs shape nodes from element props into Konva scene |
| ✅ | `plugins/text/fn.compute-text-height.ts` |  | Auto-resizing multiline text node bounding-box height |
| ✅ | `plugins/text/fn.create-text-element.ts` |  | Creating default persisted text elements from coordinates and timestamps |
| ❓ | `plugins/text/fx.compute-text-width.ts` |  | Konva multiline text autosize width measurement |
| ✅ | `plugins/text/fx.to-text-element.ts` |  | Konva shape node → persisted canvas element snapshot |
| 🫠 | `plugins/text/Text.plugin.ts` | reduce in size, slim apply method, no local fns  | Free-text plugin: element/group + tool/session based create, edit, transform, metadata, theme sync |
| ❓ | `plugins/text/tx.create-text-clone-drag.ts` |  | Text drag-duplicate preview committed on drag end |
| 🤖 | `plugins/text/tx.enter-edit-mode.ts` |  | Inline textarea editing for canvas text/shape labels, vertical alignment, hiding canvas text while HTML editor is active |
| ✅ | `plugins/text/tx.setup-text-node.ts` |  | Text node pointer hooks, drag sync, alt-clone history |
| 🤖 | `plugins/text/tx.update-text-node-from-element.ts` |  | Existing Konva text node visual and metadata sync from text element model |
| 🤖 | `plugins/terminal/Terminal.plugin.ts` |  | Trusted terminal widget plugin registration and creation flow. |
| 🤖 | `plugins/terminal/typed.ts` |  | Terminal plugin local widget, tab, PTY, and API helper types. |
| 🤖 | `plugins/terminal/widget.css` |  | Trusted terminal tabs, widget, context menu, and cwd picker styling. |
| 🤖 | `plugins/terminal/widget.ts` |  | Arrow multi-tab Ghostty terminal widget backed by CLI PTY APIs. |
| 🤖 | `plugins/toolbar/Toolbar.plugin.ts` |  | Runtime toolbar bootstrap: tools, hotkeys, sidebar toggle, cursor, temporary hand |
| ❓ | `plugins/transform/fx.proxy-bounds.ts` |  | Transform overlay needs layer-relative rotated shape bounds |
| ❓ | `plugins/transform/fx.proxy-drag-target.ts` |  | Single selected shape or pen path proxy-drag target |
| 🤖 | `plugins/transform/fx.selection-transform-options.ts` |  | Selection transformer anchors ratio border flip resolution |
| ❓ | `plugins/transform/Transform.plugin.ts` |  | Selection transform, drag-proxy moves, resize/rotate hooks, history |
| ❓ | `plugins/transform/tx.dispatch-selection-transform-hooks.ts` |  | Selection-transform hook fanout; aggregate cancel/crdt, track handled no |
| 🤖 | `plugins/transform/tx.sync-transformer.ts` |  | Selection or edit-mode changes sync transformer state |
| 🤖 | `plugins/visual-debug/VisualDebug.plugin.ts` |  | On-canvas debug overlay: camera, selection, focused node/connection id |
| 🤖 | `runtime.ts` |  | Canvas editor startup wiring services hooks plugins and widget history dependency |
| ❓ | `services/camera/CameraService.ts` |  | Canvas camera pan/zoom viewport state driving scene layers |
| ❓ | `services/canvas-registry/CanvasRegistryService.ts` |  | Canvas semantic registry: nodes↔elements/groups, lifecycle hooks, select |
| 🫠 | `services/canvas-registry/fn-merge-selection-style-menu-configs.ts` | weak merge semantics; convention drift | Combining layered selection-style menu configs across canvas registry |
| ✅ | `services/canvas-registry/fn.sort-by-priority.ts` |  | Deterministic registry ordering: ascending priority, stable id tiebreak |
| 🤖 | `services/context-menu/ContextMenuService.ts` |  | Right-click canvas/item/selection/connection menus from plugin-provided actions |
| ✅ | `services/crdt/CrdtService.ts` |  | Canvas CRDT service |
| ✅ | `services/crdt/fxBuilder.ts` |  | Batch canvas CRDT patches/deletes into commit+rollback ops/effects |
| ✅ | `services/crdt/tx.apply-ops.ts` |  | Replay recorded CRDT entity ops into Automerge |
| 🤖 | `services/element/types.ts` |  | Element registry lifecycle and transform option typings |
| ✅ | `services/editor/EditorService.ts` |  | Editor tool state, draft previews, CRDT commits |
| ✅ | `services/editor/fx.get-canvas-point.ts` |  | Editor tool pointer events → canvas point + pressure |
| ✅ | `services/history/HistoryService.ts` |  | Undo/redo stack service for runtime actions |
| ✅ | `services/logging/LoggingService.ts` |  | Canvas debug logs gated by per-target localStorage |
| 🤖 | `services/group/GroupService.ts` |  | Group node lifecycle, serialization, and clone-drag wiring |
| 🫠 | `services/group/fn.serialize-subtree-elements.ts` | service read logic in fn file | Group subtree canvas element nodes to TElement serialization |
| 🤖 | `services/group/tx.create-group-clone-drag.ts` |  | Group duplicate drag preview, subtree re-id, and CRDT commit on drop |
| 🤖 | `services/group/tx.setup-group-node.ts` |  | Group drag lifecycle: selection, clone-alt-drag, CRDT/history sync, metrics, widget portal sync |
| 🤖 | `services/render-order/RenderOrderService.ts` |  | Bundle-aware sibling z-order |
| ✅ | `services/scene/SceneService.ts` |  | Konva stage lifecycle, layers, container resize hook |
| ✅ | `services/scene/SessionService.ts` |  | temporary data, Edit state. |
| 🤖 | `services/selection/SelectionService.ts` |  | canvas node/connection selection state, focus, mode, change notifications |
| 🤖 | `services/tool/ToolService.ts` |  | Runtime tool registry, active tool switching, and draw-create preview commit |
| 🤖 | `services/widget/fn.create-widget-node.ts` |  | Widget host scene node creation and collapsed/expanded frame rendering |
| 🫠 | `services/widget/fn.to-element.ts` | empty file |  |
| 🤖 | `services/widget/CONSTANTS.ts` |  | Widget host frame sizing and connection node id constants |
| 🤖 | `services/widget/fx.attach-widget-listener.ts` |  | Widget host activation/buttons/cursor, connection drag creation, attached-only drag sync, and alt-clone wiring |
| ✅ | `services/widget/fx.draw-host.ts` |  | Editor draw-tool host draft creation and drag resizing |
| ✅ | `services/widget/fx.register-tool.ts` |  | Editor tool registration for drawable widget configs |
| 🤖 | `services/widget/interface.ts` |  | Widget manager service contracts: hooks, dependencies, history, and tool config |
| 🤖 | `services/widget/tx.attach-dom-portal.ts` |  | Widget DOM portal positioning, active pointer-event routing, glow, and cleanup listener wiring |
| ❓ | `services/widget/tx.mount-arrow-sandbox.ts` |  | Mount Arrow sandbox widget source with SDK import rewriting and base sizing CSS. |
| 🤖 | `services/widget/tx.create-widget-clone-drag.ts` |  | Widget host alt-drag clone preview, DOM cleanup, history, and CRDT commit |
| 🤖 | `services/widget/tx.resize-widget-host.ts` |  | Widget host transform resize normalization and min-size clamping |
| 🤖 | `services/widget/tx.sync-widget-connections.ts` |  | Render, select, hit-test, cached full/attached resync for widget connection lines and endpoint handles. |
| ❓ | `services/widget/tx.sync-widget-dom-portals.ts` |  | Sync mounted widget DOM portals for a node subtree after group movement/transform. |
| 🤖 | `services/widget/tx.update-widget-node-from-element.ts` |  | Replay persisted widget geometry/data onto an existing Konva host and DOM portal. |
| 🤖 | `services/widget/WidgetManagerService.ts` |  | Registers widget tools, clone-drag, close-delete history, canvas adapters, node-owned DOM portal cleanup, connection delete/sync hooks |

## .pi/extensions/functional-core
**SKIP** (internal pi extension tooling; intentionally untracked in this table)

## scripts
**SKIP**

## apps/cli
prefix: `apps/cli/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `AutomergePlugin.ts` |  |  |
| ❓ | `plugins/auth/AuthPlugin.ts` |  | OSS auth bootstrap plugin that ensures a default owner account and fake session identity. |
| ❓ | `bootstrap.ts` |  |  |
| ❓ | `build-config.ts` |  |  |
| ❓ | `canvas-command.docs.ts` |  |  |
| ❓ | `canvas-command.examples.ts` |  |  |
| ❓ | `check-update.ts` |  |  |
| ❓ | `CliPlugin.ts` |  |  |
| ❓ | `cmd.canvas.add.ts` |  |  |
| ❓ | `cmd.canvas.delete.ts` |  |  |
| ❓ | `cmd.canvas.group.ts` |  |  |
| ❓ | `cmd.canvas.list.ts` |  |  |
| ❓ | `cmd.canvas.move.ts` |  |  |
| ❓ | `cmd.canvas.patch.ts` |  |  |
| ❓ | `cmd.canvas.query.ts` |  |  |
| ❓ | `cmd.canvas.reorder.ts` |  |  |
| ❓ | `cmd.canvas.ts` |  |  |
| ❓ | `cmd.canvas.ungroup.ts` |  |  |
| ❓ | `cmd.upgrade.ts` |  |  |
| ❓ | `config.ts` |  |  |
| ❓ | `constants.ts` |  |  |
| ❓ | `FilesystemPlugin.ts` |  |  |
| ❓ | `fn.build-rpc-link.ts` |  |  |
| ❓ | `fn.canvas-subcommand-inputs.ts` |  |  |
| ❓ | `fn.print-command-result.ts` |  |  |
| ❓ | `fn.resolve-policy.ts` |  |  |
| ❓ | `fn.should-upgrade.ts` |  |  |
| ❓ | `fx.canvas.server-discovery.ts` |  |  |
| ❓ | `fx.dispatch-canvas-command.ts` |  |  |
| ❓ | `hooks.ts` |  |  |
| ❓ | `http.ts` |  |  |
| 🤖 | `main.ts` |  | Registers OSS auth bootstrap plugin before other runtime plugins. |
| ❓ | `orpc.base.ts` |  |  |
| 🤖 | `OrpcPlugin.ts` |  | Injects OSS fake session account id into ORPC contexts. |
| ❓ | `parse-argv.ts` |  |  |
| ❓ | `PtyPlugin.ts` |  |  |
| ❓ | `resolve-paths.ts` |  |  |
| ❓ | `router.ts` |  |  |
| ❓ | `ServerPlugin.ts` |  |  |
| 🤖 | `setup-services.ts` |  |  |
| ❓ | `setup-signals.ts` |  |  |
| ❓ | `tx.ensure-local-filesystem-row.ts` |  |  |

## apps/frontend
prefix: `apps/frontend/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| 🤖 | `../tsconfig.json` |  | Frontend TypeScript config for Solid/Vite browser source. |
| ❓ | `App.module.css` |  |  |
| 🤖 | `App.tsx` |  | App shell wiring for sidebar visibility and route content |
| ❓ | `automerge.ts` |  |  |
| ❓ | `backend.types.ts` |  |  |
| ❓ | `canvas.tsx` |  |  |
| ❓ | `CreateCanvasDialog.tsx` |  |  |
| ❓ | `DeleteCanvasDialog.tsx` |  |  |
| ❓ | `index.css` |  |  |
| ❓ | `index.ts` |  |  |
| ❓ | `index.tsx` |  |  |
| ❓ | `orpc-websocket.ts` |  |  |
| ❓ | `path-display.ts` |  |  |
| ❓ | `path-picker-dialog.module.css` |  |  |
| ❓ | `path-picker-dialog.tsx` |  |  |
| ❓ | `RenameDialog.tsx` |  |  |
| ❓ | `route-state.module.css` |  |  |
| ❓ | `scroll-area.module.css` |  |  |
| ❓ | `scroll-area.tsx` |  |  |
| 🤖 | `Sidebar.module.css` |  | Sidebar shell layout, create action, canvas list, footer controls |
| 🤖 | `Sidebar.tsx` |  | Sidebar navigation orchestration for canvases, dialogs, and theme toggle |
| 🤖 | `SidebarDialog.module.css` |  | Shared sidebar dialog layout, inputs, and action button styling |
| 🤖 | `SidebarItem.module.css` |  | Canvas navigation row styling, selected state, and item menu visuals |
| 🤖 | `SidebarItem.tsx` |  | Sidebar canvas row with navigation and rename/delete menu actions |
| ❓ | `store.ts` |  |  |
| ❓ | `theme.memory.ts` |  |  |
| ❓ | `theme.ts` |  |  |
| ❓ | `Toast.module.css` |  |  |
| ❓ | `Toast.tsx` |  |  |
| ❓ | `welcome.tsx` |  |  |

## apps/worker
prefix: `apps/worker/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `package.json` |  | Workflow worker app package metadata and commands. |
| ❓ | `tsconfig.json` |  | TypeScript config for Bun workflow worker app. |
| ❓ | `src/main.ts` |  | Durable workflow worker process with health endpoint and child-process sandbox step execution. |
| ❓ | `src/schema.ts` |  | Zod request/response schemas for worker step runner IPC. |
| ❓ | `src/step-runner.ts` |  | Child process step runner that loads workflow functions from module portal specs. |

## apps/web
**SKIP**

## packages/api-canvas
prefix: `packages/api-canvas/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| 🤖 | `api.create-canvas.ts` |  | Creates canvases through account-aware DB membership ownership. |
| 🤖 | `api.get-canvas.ts` |  | Fetches canvases through account-aware permission checks. |
| 🤖 | `api.list-canvas.ts` |  | Lists canvases visible to the request account. |
| 🤖 | `api.remove-canvas.ts` |  | Deletes canvases through owner membership checks. |
| 🤖 | `api.update-canvas.ts` |  | Renames/fetches canvases through account-aware permission checks. |
| ❓ | `contract.ts` |  |  |
| ❓ | `handlers.ts` |  |  |
| ❓ | `orpc.ts` |  |  |
| 🤖 | `types.ts` |  | Canvas API context includes optional account id for authz. |

## packages/api-canvas-cmd
prefix: `packages/api-canvas-cmd/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `api.cmd.add.ts` |  |  |
| ❓ | `api.cmd.delete.ts` |  |  |
| ❓ | `api.cmd.group.ts` |  |  |
| ❓ | `api.cmd.list.ts` |  |  |
| ❓ | `api.cmd.move.ts` |  |  |
| ❓ | `api.cmd.patch.ts` |  |  |
| ❓ | `api.cmd.query.ts` |  |  |
| ❓ | `api.cmd.reorder.ts` |  |  |
| ❓ | `api.cmd.ungroup.ts` |  |  |
| ❓ | `cmd.context.ts` |  |  |
| ❓ | `cmd.error.ts` |  |  |
| ❓ | `contract.ts` |  |  |
| ❓ | `handlers.ts` |  |  |
| ❓ | `orpc.ts` |  |  |
| ❓ | `types.ts` |  |  |

## packages/api-db
prefix: `packages/api-db/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `api.db-events.ts` |  |  |
| ❓ | `contract.ts` |  |  |
| ❓ | `handlers.ts` |  |  |
| ❓ | `orpc.ts` |  |  |
| ❓ | `types.ts` |  |  |

## packages/api-file
prefix: `packages/api-file/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `api.clone-file.ts` |  |  |
| ❓ | `api.put-file.ts` |  |  |
| ❓ | `api.remove-file.ts` |  |  |
| ❓ | `contract.ts` |  |  |
| ❓ | `fn.file-storage.ts` |  |  |
| ❓ | `fx.file-tree.ts` |  |  |
| ❓ | `handlers.ts` |  |  |
| ❓ | `orpc.ts` |  |  |
| ❓ | `types.ts` |  |  |

## packages/api-filesystem
prefix: `packages/api-filesystem/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| 🤖 | `api.files-filesystem.ts` |  | Resolves filesystem scope with account-aware DB membership filtering. |
| 🤖 | `api.home-filesystem.ts` |  | Resolves filesystem home with account-aware DB membership filtering. |
| 🤖 | `api.inspect-filesystem.ts` |  | Resolves filesystem inspect scope with account-aware DB membership filtering. |
| 🤖 | `api.keepalive-watch-filesystem.ts` |  | Resolves filesystem watch scope with account-aware DB membership filtering. |
| 🤖 | `api.list-filesystem.ts` |  | Resolves filesystem listing scope with account-aware DB membership filtering. |
| 🤖 | `api.list-registered-filesystems.ts` |  | Lists filesystems visible to the request account. |
| 🤖 | `api.move-filesystem.ts` |  | Resolves filesystem move scope with account-aware DB membership filtering. |
| 🤖 | `api.read-filesystem.ts` |  | Resolves filesystem read scope with account-aware DB membership filtering. |
| 🤖 | `api.unwatch-filesystem.ts` |  | Resolves filesystem unwatch scope with account-aware DB membership filtering. |
| 🤖 | `api.watch-filesystem.ts` |  | Resolves filesystem watch scope with account-aware DB membership filtering. |
| 🤖 | `api.write-filesystem.ts` |  | Resolves filesystem write scope with account-aware DB membership filtering. |
| ❓ | `contract.ts` |  |  |
| ❓ | `fn.create-filesystem-error.ts` |  |  |
| ❓ | `fn.detect-file-kind.ts` |  |  |
| ❓ | `fn.detect-mime.ts` |  |  |
| ❓ | `fn.to-api-filesystem-error.ts` |  |  |
| 🤖 | `fx.resolve-filesystem-id.ts` |  | Resolves default local filesystem from account-visible memberships. |
| ❓ | `handlers.ts` |  |  |
| ❓ | `orpc.ts` |  |  |
| 🤖 | `types.ts` |  | Filesystem API context includes optional account id for authz. |

## packages/api-notification
prefix: `packages/api-notification/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `api.notification-events.ts` |  |  |
| ❓ | `contract.ts` |  |  |
| ❓ | `handlers.ts` |  |  |
| ❓ | `orpc.ts` |  |  |
| ❓ | `types.ts` |  |  |

## packages/api-pty
prefix: `packages/api-pty/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| 🤖 | `api.create-pty.ts` |  | Resolves PTY filesystem scope with account-aware DB membership filtering. |
| 🤖 | `api.get-pty.ts` |  | Resolves PTY filesystem scope with account-aware DB membership filtering. |
| 🤖 | `api.list-pty.ts` |  | Resolves PTY filesystem scope with account-aware DB membership filtering. |
| 🤖 | `api.remove-pty.ts` |  | Resolves PTY filesystem scope with account-aware DB membership filtering. |
| 🤖 | `api.update-pty.ts` |  | Resolves PTY filesystem scope with account-aware DB membership filtering. |
| 🤖 | `api.upload-image.ts` |  | Resolves PTY upload filesystem scope with account-aware DB membership filtering. |
| ❓ | `contract.ts` |  |  |
| ❓ | `fn.extension-from-pty-image-format.ts` |  |  |
| 🤖 | `fx.resolve-filesystem-id.ts` |  | Resolves default local filesystem from account-visible memberships for PTY APIs. |
| ❓ | `handlers.ts` |  |  |
| ❓ | `orpc.ts` |  |  |
| 🤖 | `types.ts` |  | PTY API context includes optional account id for authz. |

## packages/canvas-cmds
prefix: `packages/canvas-cmds/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `fn.canvas-add-contract.ts` |  |  |
| ❓ | `fn.canvas.ts` |  |  |
| ❓ | `fn.conversion.ts` |  |  |
| ❓ | `fn.group.ts` |  |  |
| ❓ | `fn.guard.ts` |  |  |
| ❓ | `fx.canvas.ts` |  |  |
| ❓ | `fx.cmd.list.ts` |  |  |
| 🤖 | `fx.cmd.query.ts` |  | Canvas query target filtering, bounds, and output payloads. |
| ❓ | `tx.cmd.add.ts` |  |  |
| ❓ | `tx.cmd.delete.ts` |  |  |
| ❓ | `tx.cmd.group.ts` |  |  |
| 🤖 | `tx.cmd.move.ts` |  | Canvas move target bounds and CRDT position updates. |
| ❓ | `tx.cmd.patch.ts` |  |  |
| ❓ | `tx.cmd.reorder.ts` |  |  |
| ❓ | `tx.cmd.ungroup.ts` |  |  |
| ❓ | `types.ts` |  |  |

## packages/widget-filesystem
prefix: `packages/widget-filesystem/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `.gitignore` |  | Ignore widget package build outputs and local tooling files. |
| 🤖 | `package.json` |  | Widget filesystem package metadata, CodeMirror dependency, and esbuild sandbox bundle script. |
| 🤖 | `src/assets.d.ts` |  | SVG module typing for widget asset imports bundled by esbuild. |
| 🤖 | `src/widget.css` |  | Filesystem widget stylesheet bundled by esbuild into dist/main.css. |
| 🤖 | `src/widget.ts` |  | Arrow filesystem widget entry with bundled asset and CodeMirror state demo. |
| 🤖 | `tsconfig.json` |  | TypeScript config for widget filesystem package source. |

## packages/orpc-client
prefix: `packages/orpc-client/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `index.ts` |  |  |

## packages/runtime
prefix: `packages/runtime/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ✅ | `create-runtime.ts` |  |  |
| ✅ | `index.ts` |  |  |
| ✅ | `interface.ts` |  |  |

## packages/sdk
prefix: `packages/sdk/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| 🤖 | `dist/index.d.ts` | generated | Generated self-contained widget SDK declaration bundle for file-package consumers. |
| 🤖 | `dist/index.js` | generated | Generated widget SDK runtime bundle exporting actor functions and reactive machine helpers. |
| 🤖 | `package.json` |  | Widget SDK package metadata, dist exports, peer dependency, and declaration bundle build script. |
| 🤖 | `README.md` |  | Guest widget SDK usage guide for actor functions, config, machine states, JSON Schema, and theming. |
| 🤖 | `src/actor.ts` |  | Widget SDK actor function API and lightweight runtime placeholder. |
| ❓ | `src/arrow-core.d.ts` |  | Local Arrow reactive declaration shim for SDK declaration bundling. |
| 🤖 | `src/config.ts` |  | Widget SDK config type for vibecanvas.config.ts including actor metadata. |
| 🤖 | `src/index.ts` |  | Widget SDK barrel exporting actor functions, machine helpers, and config APIs. |
| 🤖 | `src/machine.ts` |  | Reactive widget state machine with official host-known states. |
| ❓ | `src/schema.ts` |  | Internal JSON Schema type used by actor port schemas. |
| 🤖 | `tsconfig.json` |  | SDK declaration bundler TypeScript path mapping for monorepo type imports. |

## packages/service-automerge
prefix: `packages/service-automerge/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `AutomergeServer.ts` |  |  |
| 🤖 | `types/canvas-doc.types.ts` |  | Canvas document TypeScript model derived from zod schemas. |
| 🤖 | `types/canvas-doc.zod.ts` |  | Canvas document zod schemas and element data union. |
| ❓ | `IAutomergeService.ts` |  |  |
| ❓ | `sqlite.adapter.ts` |  |  |
| ❓ | `websocket.adapter.ts` |  |  |

## packages/service-db
prefix: `packages/service-db/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| 🤖 | `../package.json` |  | Service DB package manifest and Drizzle migration scripts. |
| ❓ | `CONSTANTS.ts` |  | Default OSS account constants for local auth bootstrap. |
| ❓ | `_embedded-migrations.ts` |  |  |
| ❓ | `database/migrate.ts` |  | CLI entrypoint for running service DB migrations with Bun SQLite. |
| ❓ | `fx.get-file.ts` |  |  |
| ❓ | `fx.migrations.ts` |  |  |
| 🤖 | `IDbService.ts` |  |  |
| 🤖 | `DbServiceBunSqlite/index.ts` |  |  |
| ❓ | `database/migrate.ts` |  | Standalone database migration runner for local Vibecanvas config paths. |
| ❓ | `interface.ts` |  |  |
| 🤖 | `schema.ts` |  | Database schema including OSS accounts, memberships, and durable workflow/sandbox run tables. |
| 🤖 | `../database-migrations/0013_jazzy_sir_ram.sql` | generated | Drizzle migration creating workflow run, workflow step, and sandbox run tables. |
| 🤖 | `../database-migrations/meta/0013_snapshot.json` | generated | Drizzle schema snapshot for workflow table migration. |
| 🤖 | `../database-migrations/meta/_journal.json` | generated | Drizzle migration journal including workflow table migration. |
| ❓ | `tx.create-file.ts` |  |  |
| ❓ | `tx.migrations.ts` |  |  |
| ❓ | `tx.update-canvas.ts` |  |  |

## packages/service-event-publisher
prefix: `packages/service-event-publisher/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `EventPublisherService.ts` |  |  |
| ❓ | `IEventPublisherService.ts` |  |  |

## packages/service-workflow
prefix: `packages/service-workflow/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `package.json` |  | Durable workflow service package metadata and dependencies. |
| ❓ | `tsconfig.json` |  | TypeScript config for workflow service source/tests. |
| ❓ | `src/fn.workflow.ts` |  | Pure workflow validation, status, fingerprint, result, and error helpers. |
| ❓ | `src/index.ts` |  | Workflow service package barrel exports. |
| ❓ | `src/SqliteWorkflowDb.ts` |  | Drizzle/SQLite durable workflow database adapter independent of accounts. |
| ❓ | `src/types.ts` |  | Durable workflow row, definition, DB, and sandbox executor contracts. |
| ❓ | `src/WorkflowSuperviserService.ts` |  | System-managed workflow creation, retry, cancel, and status supervision. |
| ❓ | `src/WorkflowWorkerService.ts` |  | Leased durable workflow worker that executes each step through a sandbox executor. |

## packages/service-filesystem
prefix: `packages/service-filesystem/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `FilesystemServiceNode.test.ts` |  |  |
| ❓ | `FilesystemServiceNode.ts` |  |  |
| ❓ | `IFilesystemService.ts` |  |  |
| ❓ | `types.ts` |  |  |

## packages/service-pty
prefix: `packages/service-pty/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `IPtyService.ts` |  |  |
| ❓ | `PtyServiceBunPty.ts` |  |  |
| ❓ | `types.ts` |  |  |

## packages/service-theme
prefix: `packages/service-theme/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `builtins.ts` |  |  |
| ❓ | `dom.ts` |  |  |
| ❓ | `index.ts` |  |  |
| ❓ | `style.dark.ts` |  |  |
| ❓ | `style.graphite.ts` |  |  |
| ❓ | `style.light.ts` |  |  |
| ❓ | `style.sepia.ts` |  |  |
| ❓ | `style.shared.ts` |  |  |
| ❓ | `styles.ts` |  |  |
| ❓ | `ThemeService.test.ts` |  |  |
| ❓ | `ThemeService.ts` |  |  |
| ❓ | `types.ts` |  |  |

## packages/shared-functions
prefix: `packages/shared-functions/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ✅ | `functional/fn.compose.ts` |  | Right-to-left function composition helper |
| ✅ | `functional/fn.curry.ts` |  | Curry helper preserving this across partial calls |
| ✅ | `functional/fn.debounce.ts` |  | Debounce helper with injected timer portal |
| ✅ | `functional/fn.memoize.ts` |  | Memoize pure function results by serialized args |
| ✅ | `functional/fn.pipe.ts` |  | Left-to-right value pipeline helper |
| ✅ | `functional/fn.throttle.ts` |  | Throttle helper with injected timer portal |
| ❓ | `fn.xdg-paths.ts` |  |  |
| ❓ | `tx.config-path.ts` |  |  |

## packages/tapable
prefix: `packages/tapable/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ✅ | `AsyncParallelHook.ts` |  |  |
| ✅ | `AsyncSeriesHook.ts` |  |  |
| ✅ | `AsyncWaterfallHook.ts` |  |  |
| ✅ | `index.ts` |  |  |
| ✅ | `interfaces.ts` |  |  |
| ✅ | `SyncExitHook.ts` |  |  |
| ✅ | `SyncHook.ts` |  |  |

## packages/ui
prefix: `packages/ui/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `index.ts` |  |  |
| ❓ | `prepare-sandbox-source.ts` |  |  |

## packages/ui-example
**SKIP**
