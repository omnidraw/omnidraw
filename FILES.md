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
| 🤖 | `package.json` |  | Use this when adding or updating root workspace scripts like the functio |
| 🤖 | `scripts/sort-filename.ts` |  | Sort FILES.md rows by filepath. |
| ❓ | `tasks/BASED.md` |  | Based task overview and active work index. |
| ❓ | `tasks/s/S43.md` |  | CloneService clone-drag normalization task plan. |
| ❓ | `tasks/s/S44.md` |  | Canvas test repair lane for services and transform tests. |
| ❓ | `tasks/s/S45.md` |  | Canvas test repair lane for text edit and session tests. |
| ❓ | `tasks/s/S46.md` |  | Canvas test repair lane for element creation and clone tests. |
| 🤖 | `tasks/s/S42.md` |  | Service refactor progress and canvas test repair integration log. |
| 🤖 | `tasks/s/S47.md` |  | Canvas test repair lane for stale coverage audit and integration. |
| 🤖 | `packages/canvas/TESTS.md` |  | Canvas test migration log and focused test run notes. |

## packages/canvas
prefix: `packages/canvas/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| 🟡 | `automerge.ts` |  | Browser Automerge repo, persisted doc handles, WebSocket sync |
| 🫠 | `base.css` |  | Global theme tokens, dark mode, baseline element resets |
| ❓ | `components/Canvas.tsx` |  | Automerge-backed canvas runtime mount, loading, teardown orchestration |
| ❓ | `components/CanvasContextMenu/index.css` |  | Canvas right-click menu popover styling and item states |
| ❓ | `components/CanvasContextMenu/index.tsx` |  | Right-click canvas action menu at cursor position |
| ❓ | `components/CanvasHelp/help.data.ts` |  | Update help shortcuts, sections, and callout copy together |
| ❓ | `components/file/file.css` |  | File widget layout, centered loading/empty/error state styling |
| ❓ | `components/file/FileHostedWidget.tsx` |  | Hosted file widget wrapper |
| ❓ | `components/file/FileWidget.tsx` |  | Hosted file widget: watch, preview, edit, autosize, conflict state |
| ❓ | `components/file/getLanguageExtension.ts` |  | CodeMirror language loading by file extension |
| ❓ | `components/file/index.ts` |  | file widgets, hosted rendering, content hooks, shared helpers |
| ❓ | `components/file/useFileContent.ts` |  | Solid signals for file read/save, dirty/loading/error state |
| ❓ | `components/file/utils.ts` |  | File previews: infer renderer, basename, binary-to-data URL |
| ❓ | `components/file/viewers/CodeEditor.css` |  | Code editor layout, surface flexing, truncated banner styling |
| ❓ | `components/file/viewers/CodeEditor.tsx` |  | Debounced CodeMirror editor, auto-language, truncation locks editing |
| ❓ | `components/file/viewers/ImageViewer.css` |  | Centered contained image viewer |
| ❓ | `components/file/viewers/ImageViewer.tsx` |  | Renders image previews |
| ❓ | `components/file/viewers/PdfViewer.css` |  | PDF viewer layout, header controls, canvas overlay styling |
| ❓ | `components/file/viewers/PdfViewer.tsx` |  | Responsive PDF canvas viewer |
| ❓ | `components/file/viewers/PlaceholderViewer.tsx` |  | Missing binary preview |
| ❓ | `components/file/viewers/shared.css` |  | Shared empty/error viewer state styling across file preview components |
| ❓ | `components/filetree/createFiletreeContextLogic.ts` |  | Solid filetree state, drag-move, lazy folders, live watch |
| ❓ | `components/filetree/FiletreeHostedWidget.tsx` |  | Hosted filetree shell |
| ❓ | `components/filetree/FiletreeWidget.tsx` |  | Interactive filetree panel |
| ❓ | `components/filetree/path-display.ts` |  | Home-relative path display |
| ❓ | `components/filetree/PathPickerDialog.tsx` |  | Browse folders and confirm directory selection |
| ❓ | `components/FloatingCanvasToolbar/RuntimeToolbar.tsx` |  | Floating toolbar UI: sanitize SVG icons, reflect editor tool state |
| ❓ | `components/FloatingCanvasToolbar/styles.css` |  | Floating canvas/runtime toolbar visuals, states, tooltips, keycap hints |
| ❓ | `components/FloatingCanvasToolbar/toolbar.types.ts` |  | Toolbar tool roster and keyboard shortcut mapping source |
| ❓ | `components/FloatingCanvasToolbar/ToolButton.tsx` |  | Floating toolbar button |
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
| ❓ | `components/terminal/createTerminalContextLogic.ts` |  | Solid terminal lifecycle: mount, reconnect, resize, persisted PTY state |
| ❓ | `components/terminal/GhosttyTerminalMount.css` |  | Ghostty terminal container sizing inside flex layouts |
| ❓ | `components/terminal/GhosttyTerminalMount.tsx` |  | Solid Ghostty terminal mount |
| ❓ | `components/terminal/TerminalHostedWidget.tsx` |  | Hosted terminal wrapper bridging canvas widget lifecycle hooks |
| ❓ | `components/terminal/TerminalWidget.css` |  | Terminal widget chrome, header, status, unavailable, and error styling |
| ❓ | `components/terminal/TerminalWidget.tsx` |  | Embeds hosted terminal, focus/reload wiring, clipboard image upload |
| 🟡 | `core/CONSTANTS.ts` |  | Image MIME whitelist and canvas node z-index attribute |
| ✅ | `core/fn.canvas-node-semantics.ts` |  | helper canvas node getter |
| ✅ | `core/fn.create-ordered-z-index.ts` |  | Stable lexicographic z-order keys from numeric indices |
| ✅ | `core/fn.get-node-z-index.ts` |  | Resolve persisted node stacking order attribute safely |
| 🫠 | `core/fn.image-utils.ts` | mixed pure+impure in fn file | Image upload normalization: mime validation, data URLs, dimensions, sour |
| ✅ | `core/fn.pretext.ts` |  | Canvas text font shorthand for rendering/measurement |
| 🫠 | `core/fn.selection-style-menu.ts` | too big; mixed responsibilities | Selection style menu sections, defaults, overrides for chosen elements |
| ✅ | `core/fn.shape2d.ts` |  | Shape tool drafts, bounds, type mapping, element creation |
| ✅ | `core/fn.text-style.ts` |  | Text sizing/alignment presets and proportional preset scaling |
| ✅ | `core/fn.world-position.ts` |  | Pointer/world coordinate conversion across parent transforms |
| ❓ | `core/fx.canvas-node-semantics.ts` |  | Konva semantic node typing: group/element checks, parent ancestry |
| ✅ | `core/fn.filter-selection.ts` |  | Nested canvas selection collapsing to deepest live sub-selection |
| ❓ | `core/fx.node-space.ts` |  | Konva node absolute-to-layer-local coordinate conversion |
| ❓ | `core/fx.pretext.ts` |  | Pretext line-wrapped text measurement before canvas rendering |
| ✅ | `core/fx.resolve-selection-style-elements.ts` |  | Resolve style-target elements from selection or focused node |
| ✅ | `core/fn.resolve-selection-style-text-elements.ts` |  | Selection styling: normalize direct and attached text elements |
| ✅ | `core/fx.selection-style-element-patch.ts` |  | Selection style edits: clone element, patch text/line/arrow fields |
| ❓ | `core/GUARDS.ts` |  |  |
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
| ❓ | `plugins/context-menu/ContextMenu.plugin.ts` |  | Right-click hit-testing, selection resolution, Solid canvas menu mountin |
| ❓ | `plugins/event-listener/EventListener.plugin.ts` |  | Bridge Konva stage and DOM input into runtime hooks |
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
| 🤖 | `plugins/select/tx.delete-selection.ts` | group guard should me moved, needs better guard | Delete selected canvas nodes |
| ❓ | `plugins/select/tx.handle-element-pointer-double-click.ts` |  | Double-click drills selection one level deeper along ancestry |
| ❓ | `plugins/select/tx.handle-element-pointer-down.ts` |  | Element click selection depth cycling, shift-toggle, focus updates |
| ❓ | `plugins/select/tx.handle-stage-pointer-move.ts` |  | Drag-select updates rectangle, intersects top-layer selectable nodes |
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
| 🤖 | `plugins/shape2d/Shape2d.plugin.ts` |  | Shape drawing lifecycle, preview, cloning, attached-text sync |
| 🤖 | `plugins/shape2d/tx.create-clone-drag.ts` |  | Shape clone preview drag, finalize persist, history, linked duplicates |
| 🤖 | `plugins/shape2d/tx.setup-node.ts` |  | Shape node events: selection, clone-drag, multi-drag, CRDT history |
| 🤖 | `plugins/shape2d/tx.update-node-from-element.ts` |  | Syncs shape nodes from element props into Konva scene |
| ✅ | `plugins/text/fn.compute-text-height.ts` |  | Auto-resizing multiline text node bounding-box height |
| ✅ | `plugins/text/fn.create-text-element.ts` |  | Creating default persisted text elements from coordinates and timestamps |
| ❓ | `plugins/text/fx.compute-text-width.ts` |  | Konva multiline text autosize width measurement |
| ✅ | `plugins/text/fx.to-text-element.ts` |  | Konva shape node → persisted canvas element snapshot |
| 🫠 | `plugins/text/Text.plugin.ts` | reduce in size, slim apply method, no local fns  | Free-text plugin: element/group + tool/session based create, edit, transform, theme sync |
| ❓ | `plugins/text/tx.create-text-clone-drag.ts` |  | Text drag-duplicate preview committed on drag end |
| ✅ | `plugins/text/tx.enter-edit-mode.ts` |  | Inline textarea editing for canvas text/shape labels |
| ✅ | `plugins/text/tx.setup-text-node.ts` |  | Text node pointer hooks, drag sync, alt-clone history |
| 🤖 | `plugins/text/tx.update-text-node-from-element.ts` |  | Existing Konva text node visual sync from text element model |
| ❓ | `plugins/toolbar/Toolbar.plugin.ts` |  | Runtime toolbar bootstrap: tools, hotkeys, cursor, temporary hand |
| ❓ | `plugins/transform/fx.proxy-bounds.ts` |  | Transform overlay needs layer-relative rotated shape bounds |
| ❓ | `plugins/transform/fx.proxy-drag-target.ts` |  | Single selected shape or pen path proxy-drag target |
| ❓ | `plugins/transform/fx.selection-transform-options.ts` |  | Selection transformer anchors ratio border flip resolution |
| ❓ | `plugins/transform/Transform.plugin.ts` |  | Selection transform, drag-proxy moves, resize/rotate hooks, history |
| ❓ | `plugins/transform/tx.dispatch-selection-transform-hooks.ts` |  | Selection-transform hook fanout; aggregate cancel/crdt, track handled no |
| ❓ | `plugins/transform/tx.sync-transformer.ts` |  | Selection or edit-mode changes sync transformer state |
| ❓ | `plugins/visual-debug/VisualDebug.plugin.ts` |  | On-canvas debug overlay: camera, selection, focused node |
| ✅ | `runtime.ts` |  | Canvas editor startup wiring services hooks plugins |
| ❓ | `services/camera/CameraService.ts` |  | Canvas camera pan/zoom viewport state driving scene layers |
| ❓ | `services/canvas-registry/CanvasRegistryService.ts` |  | Canvas semantic registry: nodes↔elements/groups, lifecycle hooks, select |
| 🫠 | `services/canvas-registry/fn-merge-selection-style-menu-configs.ts` | weak merge semantics; convention drift | Combining layered selection-style menu configs across canvas registry |
| ✅ | `services/canvas-registry/fn.sort-by-priority.ts` |  | Deterministic registry ordering: ascending priority, stable id tiebreak |
| ❓ | `services/context-menu/ContextMenuService.ts` |  | Right-click canvas/item/selection menus from plugin-provided actions |
| ❓ | `services/crdt/CrdtService.ts` |  | Canvas CRDT service |
| ✅ | `services/crdt/fxBuilder.ts` |  | Batch canvas CRDT patches/deletes into commit+rollback ops |
| ✅ | `services/crdt/tx.apply-ops.ts` |  | Replay recorded CRDT entity ops into Automerge |
| ✅ | `services/editor/EditorService.ts` |  | Editor tool state, draft previews, CRDT commits |
| ✅ | `services/editor/fx.get-canvas-point.ts` |  | Editor tool pointer events → canvas point + pressure |
| ✅ | `services/history/HistoryService.ts` |  | Undo/redo stack service for runtime actions |
| ✅ | `services/logging/LoggingService.ts` |  | Canvas debug logs gated by per-target localStorage |
| 🤖 | `services/group/GroupService.ts` |  | Group node lifecycle, serialization, and clone-drag wiring |
| 🤖 | `services/group/tx.create-group-clone-drag.ts` |  | Group duplicate drag preview, subtree re-id, and CRDT commit on drop |
| 🤖 | `services/render-order/RenderOrderService.ts` |  | Bundle-aware sibling z-order |
| ✅ | `services/scene/SceneService.ts` |  | Konva stage lifecycle, layers, container resize hook |
| ✅ | `services/scene/SessionService.ts` |  | temporary data, Edit state. |
| ❓ | `services/selection/SelectionService.ts` |  | canvas selection state, focus, mode, change notifications |
| 🤖 | `services/tool/ToolService.ts` |  | Runtime tool registry, active tool switching, and draw-create preview commit |
| ❓ | `services/widget/fn.create-widget-node.ts` |  | Widget host scene node creation and collapsed/expanded frame rendering |
| 🫠 | `services/widget/fn.to-element.ts` | empty file |  |
| 🤖 | `services/widget/fx.attach-widget-listener.ts` |  | Widget host header/button hover and cursor interaction wiring |
| ✅ | `services/widget/fx.draw-host.ts` |  | Editor draw-tool host draft creation and drag resizing |
| ✅ | `services/widget/fx.register-tool.ts` |  | Editor tool registration for drawable widget configs |
| ✅ | `services/widget/interface.ts` |  | Widget manager service contracts: hooks, dependencies, tool config |
| ✅ | `services/widget/WidgetManagerService.ts` |  | Registers widget tools canvas adapters example widget |

## .pi/extensions/functional-core
**SKIP** (internal pi extension tooling; intentionally untracked in this table)

## scripts
**SKIP**

## apps/cli
prefix: `apps/cli/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| 🤖 | `../tests/plugins/cli/harness.ts` |  |  |
| ❓ | `AutomergePlugin.ts` |  |  |
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
| ❓ | `main.ts` |  |  |
| ❓ | `orpc.base.ts` |  |  |
| ❓ | `OrpcPlugin.ts` |  |  |
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
| ❓ | `App.module.css` |  |  |
| ❓ | `App.tsx` |  |  |
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
| ❓ | `Sidebar.module.css` |  |  |
| ❓ | `Sidebar.tsx` |  |  |
| ❓ | `SidebarDialog.module.css` |  |  |
| ❓ | `SidebarItem.module.css` |  |  |
| ❓ | `SidebarItem.tsx` |  |  |
| ❓ | `store.ts` |  |  |
| ❓ | `theme.memory.test.ts` |  |  |
| ❓ | `theme.memory.ts` |  |  |
| ❓ | `theme.ts` |  |  |
| ❓ | `Toast.module.css` |  |  |
| ❓ | `Toast.tsx` |  |  |
| ❓ | `welcome.tsx` |  |  |

## apps/web
**SKIP**

## packages/api-canvas
prefix: `packages/api-canvas/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `api.create-canvas.ts` |  |  |
| ❓ | `api.get-canvas.ts` |  |  |
| ❓ | `api.list-canvas.ts` |  |  |
| ❓ | `api.remove-canvas.ts` |  |  |
| ❓ | `api.update-canvas.ts` |  |  |
| ❓ | `contract.ts` |  |  |
| ❓ | `handlers.ts` |  |  |
| ❓ | `orpc.ts` |  |  |
| ❓ | `types.ts` |  |  |

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
| ❓ | `api.files-filesystem.test.ts` |  |  |
| ❓ | `api.files-filesystem.ts` |  |  |
| ❓ | `api.home-filesystem.ts` |  |  |
| ❓ | `api.inspect-filesystem.ts` |  |  |
| ❓ | `api.keepalive-watch-filesystem.ts` |  |  |
| ❓ | `api.list-filesystem.ts` |  |  |
| ❓ | `api.list-registered-filesystems.ts` |  |  |
| ❓ | `api.move-filesystem.ts` |  |  |
| ❓ | `api.read-filesystem.ts` |  |  |
| ❓ | `api.unwatch-filesystem.ts` |  |  |
| ❓ | `api.watch-filesystem.ts` |  |  |
| ❓ | `api.write-filesystem.ts` |  |  |
| ❓ | `contract.ts` |  |  |
| ❓ | `fn.create-filesystem-error.ts` |  |  |
| ❓ | `fn.detect-file-kind.ts` |  |  |
| ❓ | `fn.detect-mime.ts` |  |  |
| ❓ | `fn.to-api-filesystem-error.ts` |  |  |
| ❓ | `fx.resolve-filesystem-id.ts` |  |  |
| ❓ | `handlers.ts` |  |  |
| ❓ | `orpc.ts` |  |  |
| ❓ | `types.ts` |  |  |

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
| ❓ | `api.create-pty.ts` |  |  |
| ❓ | `api.get-pty.ts` |  |  |
| ❓ | `api.list-pty.ts` |  |  |
| ❓ | `api.remove-pty.ts` |  |  |
| ❓ | `api.update-pty.ts` |  |  |
| ❓ | `api.upload-image.test.ts` |  |  |
| ❓ | `api.upload-image.ts` |  |  |
| ❓ | `contract.ts` |  |  |
| ❓ | `fn.extension-from-pty-image-format.ts` |  |  |
| ❓ | `fx.resolve-filesystem-id.ts` |  |  |
| ❓ | `handlers.ts` |  |  |
| ❓ | `orpc.ts` |  |  |
| ❓ | `types.ts` |  |  |

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
| ❓ | `fx.cmd.query.ts` |  |  |
| ❓ | `tx.cmd.add.ts` |  |  |
| ❓ | `tx.cmd.delete.ts` |  |  |
| ❓ | `tx.cmd.group.ts` |  |  |
| ❓ | `tx.cmd.move.ts` |  |  |
| ❓ | `tx.cmd.patch.ts` |  |  |
| ❓ | `tx.cmd.reorder.ts` |  |  |
| ❓ | `tx.cmd.ungroup.ts` |  |  |
| ❓ | `types.ts` |  |  |

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

## packages/service-automerge
prefix: `packages/service-automerge/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `AutomergeServer.ts` |  |  |
| ❓ | `canvas-doc.types.ts` |  |  |
| ❓ | `canvas-doc.zod.ts` |  |  |
| ❓ | `IAutomergeService.ts` |  |  |
| ❓ | `sqlite.adapter.ts` |  |  |
| ❓ | `websocket.adapter.ts` |  |  |

## packages/service-db
prefix: `packages/service-db/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `_embedded-migrations.ts` |  |  |
| ❓ | `fx.get-file.ts` |  |  |
| ❓ | `fx.migrations.test.ts` |  |  |
| ❓ | `fx.migrations.ts` |  |  |
| 🤖 | `IDbService.ts` |  |  |
| 🤖 | `DbServiceBunSqlite/index.ts` |  |  |
| ❓ | `interface.ts` |  |  |
| ❓ | `schema.ts` |  |  |
| ❓ | `tx.create-file.ts` |  |  |
| ❓ | `tx.migrations.test.ts` |  |  |
| ❓ | `tx.migrations.ts` |  |  |
| ❓ | `tx.update-canvas.ts` |  |  |

## packages/service-event-publisher
prefix: `packages/service-event-publisher/src/`

| status | filepath | human comment | oneliner when to use |
|---|---|---|---|
| ❓ | `EventPublisherService.ts` |  |  |
| ❓ | `IEventPublisherService.ts` |  |  |

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
