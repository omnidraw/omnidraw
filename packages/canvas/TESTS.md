# Canvas test migration list

Source:
- `packages/canvas/DESIGN.md`
- old tests under `packages/canvas/tests/plugins/*`
- new code only under:
  - `packages/canvas/src/new-plugins`
  - `packages/canvas/src/new-services`

Rule:
- migration judgment is based on new code paths only
- old `src/plugins/*` and old `src/services/*` do not count

Legend:
- `yes` = can migrate now
- `partial` = some tests can move now, some blocked
- `no` = blocked for now

## Current progress

Migrated and passing on new runtime:
- `tests/new-services/stateful-services.test.ts` — 5 passing
- `tests/new-services/render-and-camera-services.test.ts` — 2 passing
- `tests/new-services/crdt-service.test.ts` — 3 passing
- `tests/new-services/render-order-service.test.ts` — 3 passing
- `tests/new-plugins/camera/CameraControl.plugin.test.ts` — 3 passing
- `tests/new-plugins/text/Text.click-create.plugin.test.ts` — 3 passing
- `tests/new-plugins/text/Text.core.plugin.test.ts` — 6 passing
- `tests/new-plugins/text/Text.editing.plugin.test.ts` — 5 passing
- `tests/new-plugins/text/Text.regressions.plugin.test.ts` — 3 passing
- `tests/new-plugins/image/Image.plugin.test.ts` — 5 passing
- `tests/new-plugins/group/Group.plugin.test.ts` — 3 passing, 2 skipped
- `tests/new-plugins/selection/Selection.plugin.test.ts` — 5 passing
- `tests/new-plugins/render-order/RenderOrder.plugin.test.ts` — 3 passing, 1 skipped
- `tests/new-plugins/scene-hydrator/SceneHydrator.plugin.test.ts` — 1 passing

Last migrated-runtime run:
- `bunx vitest run tests/new-services/*.test.ts tests/new-plugins/camera/CameraControl.plugin.test.ts tests/new-plugins/text/Text.click-create.plugin.test.ts tests/new-plugins/text/Text.core.plugin.test.ts tests/new-plugins/text/Text.editing.plugin.test.ts tests/new-plugins/text/Text.regressions.plugin.test.ts tests/new-plugins/image/Image.plugin.test.ts tests/new-plugins/render-order/RenderOrder.plugin.test.ts tests/new-plugins/scene-hydrator/SceneHydrator.plugin.test.ts tests/new-plugins/group/Group.plugin.test.ts tests/new-plugins/selection/Selection.plugin.test.ts`
- result: `14 files passed, 50 tests passed, 3 skipped`

Latest focused legacy-runtime maintenance run:
- S47 stale coverage audit refreshed lower-failure folders that still had stale service assumptions
- camera and selection-style-menu tests now use `ToolService` through `services.require("tool")`
- group regression test now creates nodes through `ElementService`, not `CanvasRegistryService`
- `bunx vitest run tests/plugins/camera tests/plugins/group tests/plugins/scene-hydrator tests/plugins/selection-style-menu`
- result: `4 files passed, 12 tests passed`

Latest full legacy-runtime integration run:
- `bunx vitest run tests`
- result: `37 files passed, 3 failed, 138 tests passed, 4 failed`
- remaining blockers:
  - `tests/plugins/shape1d/Shape1d.plugin.test.ts` compile error: duplicate local `element` const
  - `tests/plugins/text/Text.click-create.plugin.test.ts` and `tests/plugins/text/Text.viewport-editing.plugin.test.ts` still assert old text edit/session state expectations

Big reality check from new runtime:
- all current `src/new-services/*` now have direct test coverage
- there is no new `shape2d` plugin yet
- there is no new `shape1d` plugin yet
- many old rect/diamond/ellipse/arrow/line based tests are not actually migratable yet
- many group/selection/render-order tests used old rect fixtures, so they need either:
  - a temporary rewrite onto migrated types like `image` / `text`, or
  - waiting for new shape plugins

## Summary by folder

This table is based on what exists in:
- `packages/canvas/src/new-plugins`
- `packages/canvas/src/new-services`

| Folder | Status | Why |
| --- | --- | --- |
| `tests/plugins/image` | yes | `src/new-plugins/image` exists and covers hydrate, picker, paste, drop, clone-drag, delete/undo paths |
| `tests/plugins/text` | partial | `src/new-plugins/text` exists, but its own comments + design say attached-text and clone-drag parity are not fully done |
| `tests/plugins/group` | partial | `src/new-plugins/group` exists, but no new `shape2d` / `shape1d` plugin exists yet; basic grouping can only be tested on migrated node types like `image` / `text` |
| `tests/plugins/camera` | yes | `src/new-plugins/camera-control` and `src/new-services/camera` exist; first migrated test file is passing |
| `tests/plugins/recorder` | no | no `src/new-plugins/recorder` found |
| `tests/plugins/render-order` | partial | `src/new-plugins/render-order` and `src/new-services/render-order` exist; migrated image-based tests pass, but old context-menu and old shape coverage do not map yet |
| `tests/plugins/scene-hydrator` | partial | `src/new-plugins/scene-hydrator` exists; live rehydrate test migrated and passing, orphan cleanup still missing |
| `tests/plugins/selection` | partial | `src/new-plugins/select` exists; some top-level and grouped-image selection behavior is now migrated, but delete and many old rect-based scenarios still depend on missing pieces |

---

## `tests/plugins/image`

### `ImagePlugin.test.ts`
Status: `yes`

Migrated now:
- new file: `tests/new-plugins/image/Image.plugin.test.ts`
- passing cases:
  - hydrate document-backed image into `Konva.Image`
  - selecting image tool opens file picker
  - paste from textarea is ignored
  - paste uploads image and inserts centered element
  - alt-drag clone creates second image and undo/redo stays coherent

Can still migrate later from old file:
- deleting an image releases backend file and undo restores image

What is missing for remaining delete case:
- new image runtime takes `deleteImage` in config type, but current `src/new-plugins/image/*` path does not actually wire backend delete behavior on selection delete
- so node deletion can be tested later, but backend file release parity is not implemented yet in new path

Notes:
- new `src/new-plugins/image/Image.plugin.ts` has picker, paste, drop, hydrate, serialize, and clone-drag wiring
- still marked unchecked in design, so keep comparing behavior closely

---

## `tests/plugins/text`

### `TextPlugin.click-create.test.ts`
Status: `yes`

Migrated now:
- new file: `tests/new-plugins/text/Text.click-create.plugin.test.ts`
- passing cases:
  - click-create adds text node
  - new text opens textarea edit UI
  - non click-create mode ignores pointer-up create path

Important note:
- new runtime currently cancels an empty new text on `Escape`
- old test wording around edit-box sizing/behavior should be rechecked against new runtime before porting more exact assertions

### `TextPlugin.core.test.ts`
Status: `partial`

Migrated now:
- new file: `tests/new-plugins/text/Text.core.plugin.test.ts`
- passing cases:
  - hydrate `TElement` into `Konva.Text`
  - serialize text node back to element
  - text edit commit patches CRDT
  - multiline commit preserves newlines
  - drag undo/redo restores position
  - transformer resize scales font size and width, undo restores values
  - update-from-element restores baked dimensions and resets scale

Can still migrate later from old file:
- any exact old behavior checks not yet covered
- any assertions that depend on old runtime-specific helper surface

Do not copy old assertion blindly:
- old `Escape commits text on new node` does not match current new runtime behavior
- new runtime currently cancels empty new text on `Escape`

### `TextPlugin.editing.test.ts`
Status: `partial`

Migrated now:
- new file: `tests/new-plugins/text/Text.editing.plugin.test.ts`
- new file: `tests/new-plugins/text/Text.regressions.plugin.test.ts`
- passing cases:
  - multiline commit preserves newlines
  - textarea auto-sizes on open
  - leading/trailing whitespace preserved
  - undo/redo after multiline edit restores text
  - `Enter` inserts newline and keeps edit mode open
  - `Escape` on newly created empty text removes the node
  - `Escape` on existing text cancels edit and keeps original content
  - long single-line text expands textarea width and committed node width

Blocked for now:
- group drilling tests
  - `pointerdown on text inside group selects the group, not the text`
  - `dblclick on text while group is focused drills to text — no edit mode`
  - `second dblclick on already-focused text enters edit mode`
  - `transformer is hidden during text edit and restored after Escape commit`
- group/text interaction tests tied to grouped drill flow
  - toolbar shortcut behavior while editing grouped text
  - wrapped height / shrink tests when run through grouped drill flow
  - long single-line width expansion test when run through grouped drill flow
- clone-drag tests
  - `alt-drag on plain text creates a copied text node`
  - `alt-dragging a cloned plain text adds exactly one more text node`
  - `alt-dragging one text in a top-level multi-selection should clone both selected texts`

Why blocked:
- design says text migration still misses attached-text parity
- new text plugin comment says clone-drag parity can come later
- many remaining editing tests depend on old group drill behavior, not just free-text editing

---

## `tests/plugins/group`

### `GroupPlugin.test.ts`
Status: `partial`

Migrated now:
- new file: `tests/new-plugins/group/Group.plugin.test.ts`
- passing cases:
  - grouping preserves child absolute positions under camera pan and zoom
  - ungrouping preserves child absolute positions and clears `parentGroupId`
  - group / ungroup support undo and redo

Tried and skipped for now:
- grouping preserves grouped selection stack slot / ungroup restores child order
- dragging one selected node moves all selected roots and undo restores them

Why skipped:
- rewrite on images shows current new runtime does not preserve old stack slot behavior yet
- rewrite on images also shows multi-select drag passengers are not moving with dragged root in this scenario
- keep skipped until behavior is fixed on purpose or expected semantics are changed on purpose

Blocked from direct old port:
- old file is rect-based
- new runtime has no `src/new-plugins/shape2d`
- no rect serializer/hydrator exists in new runtime yet

Still blocked or unverified:
- clone-drag tests
  - `alt-dragging a cloned group adds exactly one more group`
  - `dragging a cloned group updates its boundary box during dragmove`
  - `alt-dragging one node in a mixed top-level multi-selection should clone all selected roots`

Why blocked / later:
- no migrated `shape2d` plugin yet
- clone-drag exists in code, but old scenarios are rect-heavy and need rewrite onto migrated node types before trusting parity

### `GroupPlugin.text.test.ts`
Status: `partial`

Can migrate now:
- `free text node inside a group preserves absolute position on group/ungroup`

Blocked for now:
- `grouping a rect automatically includes its attached text and preserves container linkage`

Why blocked:
- design says text attached-text parity still missing

### `GroupPlugin.zoom-rehydrate.test.ts`
Status: `partial`

Can likely migrate after rewriting fixture onto images or text:
- `dragging a group after zooming should rehydrate its children at the same world coordinates`

Blocked from direct port:
- old file is rect-based
- new runtime has no migrated `shape2d` plugin yet

---

## `tests/plugins/camera`

### `CameraControlPlugin.hand.test.ts`
Status: `yes`

Migrated now:
- new file: `tests/new-plugins/camera/CameraControl.plugin.test.ts`
- passing cases:
  - hand drag pans camera and resets drag state on release
  - hand layer blocks selection and shape drag interactions
  - leaving hand mode mid-drag clears drag state

---

## `tests/plugins/recorder`

### `RecorderPlugin.test.ts`
Status: `no`

Blocked for now:
- whole file

Why blocked:
- `RecorderPlugin` is unchecked in design
- no new recorder plugin found under `src/new-plugins/`

---

## `tests/plugins/render-order`

### `RenderOrderPlugin.test.ts`
Status: `partial`

Migrated now:
- new file: `tests/new-plugins/render-order/RenderOrder.plugin.test.ts`
- passing cases:
  - hydrates mixed top-level groups and elements in zIndex order
  - render-order service brings selected image to front
  - reordering does not mutate `createdAt` or `updatedAt`

Tried and skipped for now:
- `context menu opens item actions on right click`

Why skipped:
- no migrated context-menu plugin path in `src/new-plugins`
- old test belongs to old `ContextMenuPlugin` behavior, not render-order service itself

Still blocked:
- old rect-specific coverage that depends on non-migrated `shape2d`

---

## `tests/plugins/scene-hydrator`

### `SceneHydratorPlugin.test.ts`
Status: `partial`

Migrated now:
- new file: `tests/new-plugins/scene-hydrator/SceneHydrator.plugin.test.ts`
- passing case:
  - rehydrates scene on doc change and keeps selection on surviving nodes

Blocked for now:
- `hydrates valid hierarchy root-to-leaf and deletes orphan groups and elements from crdt`

Why blocked:
- new scene hydrator rebuilds scene and restores selection
- new code does not do old orphan-group / orphan-element CRDT cleanup

---

## `tests/plugins/selection`

### `SelectionPlugin.test.ts`
Status: `partial`

Migrated now:
- new file: `tests/new-plugins/selection/Selection.plugin.test.ts`
- passing cases:
  - shift pointerdown adds and removes top-level nodes from selection
  - pointerdown focuses clicked node and empty stage clears focus
  - pointerdown on grouped image selects outer group
  - double click on nested image drills from outer group to inner group to leaf
  - after drilling to leaf, pointerdown on sibling under outer group switches focus to sibling

Still blocked for now:
- delete cases still depend on attached-text parity and grouped subtree delete behavior
- many old scenarios are rect-based, while current rewrite uses images

What is missing before fuller migration:
- migrated `shape2d` plugin for direct rect-based fixture parity
- attached-text parity in new text/runtime path
- confidence that grouped delete behavior matches old owner-selection semantics

---

## Suggested migration order

Done now:
1. `tests/new-plugins/camera/CameraControl.plugin.test.ts`
2. `tests/new-plugins/text/Text.click-create.plugin.test.ts`
3. `tests/new-plugins/image/Image.plugin.test.ts`
4. `tests/new-plugins/render-order/RenderOrder.plugin.test.ts`
5. `tests/new-plugins/scene-hydrator/SceneHydrator.plugin.test.ts`

Best next batch:
1. maybe grouped text drill tests after group rewrite exists
2. more selection tests rewritten onto migrated node types
3. maybe pure delete tests for image node removal, but not backend file release, unless new delete wiring is added
4. maybe revisit skipped group tests after behavior fixes
5. maybe revisit blocked delete selection tests once parity exists

Leave for later:
- recorder
- attached-text cases
- clone-drag text/group parity checks
- context-menu render-order case
- orphan cleanup scene-hydrator case
- any direct old rect/shape tests until new `shape2d` exists
