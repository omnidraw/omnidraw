# Overview

## Introduction

Building software is explorative, creative and sometimes dull and repetitive.
This document outline the how to build software in a highly technical,
small and motivated team. The goal is to minimize management
and maximize throughput. The idea behind `BASED` is that programming is 90% context loading and 10% actual solving and coding. Therefore we should batch work for context loading and minimize context switching.
`BASED` skips the traditional agile ceremonies and focuses on the codebase and a glorified todo list.
The todo list is the heart of the project. No tickets, no boards, no sprints, no backlog.
Just a list of things to do. The list is grouped into 5 and ordered by number (Low to High).
Every dev opens a branch and picks a set of items they want to work on. They open a file based on
their branch and copy the items and explain what they are doing. Once merged the items are checked or removed from the list the branch is kept.

Every change in the codebase can be grouped into one of the following categories:

B ugs: Something is not working as expected.
A dditions: New features or improvements.
S ubtractions: Removing or simplifing parts of the codebase.
E xplorations: Researching new technologies or ideas.
D ebt: Internal engineering work such as CI, scripts, test automation, developer tooling, maintenance, refactoring, and technical debt.

The status are tagged:
- [ ]: open
- [x]: closed
- [-]: dropped
- [?]: unsure
- [!]: urgent
- [~]: in progress
- [/]: blocked
- [R]: ready; part of a coordinated redesign group

Remember to keep the codebase small. Small is clean, small is fast. Delete often.

## Structure

`BASED.md` now lives at the repository root in `tasks/`.

- `tasks/BASED.md`: overview, active index, and conventions.
- `tasks/b/`: bug files.
- `tasks/a/`: addition files.
- `tasks/s/`: subtraction files.
- `tasks/e/`: exploration files.
- `tasks/d/`: debt task files.

Each line in the overview stays short and links to one dedicated file.
Each dedicated file stores the task context, TODOs, notes, and logs.
Once you completed a task you must update this file.

## Format

Overview entries use this format:

`- [x]: [B1](b/B1.md) - text: edit jumping`

Humans usually don't create leaf files. But agents do.
Agents may create leaf files for every category, including D debt tasks.

Leaf files use this format:

```md
# B1 - text: edit jumping
[Overview](../../`BASED`.md)

<Short summary - This is read by humans. Keep it short>

## Context
<Longer explanation of the problem. Must link all relevent files.>

## Plan
<What you plan to do. Step by step plan. Use subsections>

## TODOS
<Checklist - derived from plan>
- [ ] ...

## NOTES
<Notes - Anything non trivial you discovered or want to remember>
...

### LOGS
<Logs - log any action you take>

---
```

Use the overview for scanning.
Use the leaf files for execution history and local context.
Never put detailed plan in this file
Never put leaf notes, lane breakdowns, execution history, or detailed task plans in this file.
Editing `tasks/`BASED`.md` alone does not require a `FILES.md` bookkeeping update.

## Inline Plan Visuals

Task markdown renders images and Mermaid diagrams inline, so visuals belong in
the leaf task's `## Plan` instead of living as detached references.

- Every supplied, external, or generated image used by a task must be copied
  next to that task's markdown file and embedded inside its `## Plan` with
  normal Markdown image syntax.
- Name the first image with the exact task id: `A100.md` -> `A100.png`. Name
  additional images `A100-2.png`, `A100-3.png`, and so on. Other task types use
  the same rule, for example `B12.png` or `E5-2.png`. Do not hotlink an external
  asset when a local task-owned copy can be stored.
- Use an inline fenced `mermaid` diagram in `## Plan` for flows, ownership,
  state transitions, service relationships, or multi-step interactions.
- Substantial Addition and Exploration plans should normally include at least
  one useful inline image or Mermaid diagram. Simple one-step tasks may omit a
  visual when it would add no information.
- Visuals supplement the written plan and acceptance criteria; when they
  disagree, the written task contract is authoritative.
- When images where added from the user and they are still relevant (e.g. Bugreport) keep the images in the plan files you create / edit
- All images just be compressed in size. Use cli tools

## B ugs
- [x]: [B1](b/B1.md) - text: edit jumping
- [x]: [B2](b/B2.md) - text: long, on select, box too small
- [x]: [B3](b/B3.md) - version update not showing
- [x]: [B4](b/B4.md) - update progress cli not moving
- [x]: [B7](b/B7.md) - iframe browser: click can latch canvas drag and trap release
- [x]: [B8](b/B8.md) - hosted widgets: transformer resize loses control when pointer crosses DOM
- [x]: [B9](b/B9.md) - hosted/iframe widgets: canvas drag not persisted on reload
- [x]: [B10](b/B10.md) - style menu: drag then style jumps selection back to old position
- [x]: [B11] - terminal after resize is not focuable anymore
- [x]: [B12](b/B12.md) - terminal: ctrl+c echoes ^C but does not interrupt process
- [x]: [B13](b/B13.md) - canvas CLI: top-level alias docs lie; `vibecanvas query ...` is rejected
- [x]: [B14](b/B14.md) - canvas CLI: `canvas group --help` falls back to global help
- [x]: [B15](b/B15.md) - canvas CLI: `--json` output is not real JSON
- [-]: [B16](b/B16.md) - ci: `@vibecanvas/canvas` tests load Konva node entry and require native `canvas` - only fails in ci
- [x]: [B17](b/B17.md) - canvas CLI: `add --schema rect` still requires an element source instead of printing schema
- [x]: [B18](b/B18.md) - terminal image paste not working in deploy version
- [x]: [B19](b/B19.md) - cli usage -> no realtime updates via automerge
- [x]: [B20](b/B20.md) - pen tool: after stroke commit, stay in pen mode instead of switching to selection
- [x]: [B21](b/B21.md) - filesystem: recursive filetree scan dies on EPERM/EACCES folders like `~/.Trash`
- [x]: [B21] - can't do 1d edits
- [x]: [B22] - style color pallet breaks layout
- [x]: [B23] - bug: pan/zoom on textedit -> text box moves with
- [x]: [B24] - bug: handtool not working -> drag
- [x]: [B25](b/B25.md) - onload -> camera can't move for first 4 sec (perf problem)
- [-]: [B26] - investigate if cli respect zIndex - check tmp/script
- [x]: [B27] - preview does not attach listeners correctly for all elements
- [-]: [B28] - group with widget and rect -> delete rect must also deletes widget
- [x]: [B29] - shape2d -> edit must show vertical heigt correctly and hide konva.text while editing
- [x]: [B30] - can't delete text
- [x]: [B31](b/B31.md) - binary: compiled app cannot find Turso native binding
- [x]: [B32](b/B32.md) - binary: bundle Turso native addon beside compiled executable
- [x]: [B33](b/B33.md) - ai wizard: chat does not reconnect after OAuth/API key login
- [x]: [B34] - ai wizard: model menu need 2 times before update
- [x]: [B35](b/B35.md) - ai wizard: image attachments are not sent to Pi
- [x]: [B36](b/B36.md) - actor timeouts only trigger in error state
- [x]: [B37](b/B37.md) - actor clone copy write burst crashes Turso DB (`cell_get`) on dev
- [x]: [B38](b/B38.md) - ai wizard: chat tab forgets selected model after tab switch
- [x]: [B39](b/B39.md) - ai wizard: actor tab stale after new actor candidate
- [x]: [B40](b/B40.md) - widgets: clone-drag creates multiple copies
- [x]: [B41](b/B41.md) - binary: Turso `UPDATE ... RETURNING` crashes on actor instance with medium HTML state
- [x]: [B42](b/B42.md) - release: macOS binary freezes after unsafe automatic upgrade
- [x]: [B43](b/B43.md) - widgets: optimize Arrow sandbox dependency chain under TypeScript 7
- [x]: [B44](b/B44.md) - ai wizard: preview loses mentioned resource after continuation prompt
- [x]: [B45](b/B45.md) - image paste: pending local preview can persist without media upload
- [x]: [B46](b/B46.md) - db resource: structured tables should default to SQLite STRICT mode
- [x]: [B47](b/B47.md) - image delete: remove media_files row
- [x]: [B48](b/B48.md) - AI widgets: pin Preview revisions and make Publish rollback complete
- [x]: [B49](b/B49.md) - AI chat: reconnect race drops approval session scope
- [x]: [B50](b/B50.md) - AI chat: keyboard navigation cannot reach or scroll long mention and slash lists
- [x]: [B51](b/B51.md) - widget reload: moved manifest conflicts with persisted actor slug
- [x]: [B52](b/B52.md) - ci: build generated SDK before package tests
- [x]: [B53](b/B53.md) - widget publish: duplicate actor identity hides new resource slots
- [x]: [B54](b/B54.md) - widget publish: retain the draft but show it only after edits
- [-]: [B55](b/B55.md) - image undo: hard delete removes the only restorable media record
- [x]: [B56](b/B56.md) - canvas input: synthesize click and double-click from valid pointer sequences
- [x]: [B57](b/B57.md) - canvas text: resolve active editing during runtime teardown
- [x]: [B58](b/B58.md) - widget portals: serialize asynchronous renderer updates
- [x]: [B59](b/B59.md) - `AuthStorage` export removed from `@earendil-works/pi-coding-agent` 0.80.10
- [-]: [B60](b/B60.md) - superseded: Cangine interaction and image integration
- [x]: [B61](b/B61.md) - widget projection: never publish a partial persisted canvas snapshot
- [x]: [B62](b/B62.md) - AI widget authoring: restore durable validation and sidebar refresh
- [x]: [B63](b/B63.md) - widgets: `npm ci` rejects draft lockfile; add widget-debug-tools lab
- [x]: [B64](b/B64.md) - widgets: restore direct drag placement after Cangine cutover
- [x]: [B65](b/B65.md) - cli: home preflight must share multiprocess WAL and report real failures
- [x]: [B66](b/B66.md) - widget portals: keep Capsule layout intrinsic while canvas zooms
- [x]: [B67](b/B67.md) - AI widget authoring: make shared construction provenance exact and headlessly testable
- [x]: [B68](b/B68.md) - db: self-heal stale Turso WAL coordination and remove actor-era startup warning
- [x]: [B69](b/B69.md) - AI widget authoring: request and diagnose Capsule WebGL authority
- [ ]: [B70](b/B70.md) - AI widgets: one authoritative exact-revision readiness state
- [x]: [B71](b/B71.md) - Preview: actionable Capsule guest runtime diagnostics
- [ ]: [B72](b/B72.md) - db resources: migration can leave calls stuck on `RESOURCE_MIGRATING`
- [x]: [B73](b/B73.md) - AI widget scaffold: resolve workspace dependency protocols before npm install
- [x]: [B74](b/B74.md) - Preview: keep generated SDK and Capsule bridge versions aligned
 - [x]: [B75](b/B75.md) - db resource tool: apply reported stuck in `preparing` though it succeeded
- [-]: [B76](b/B76.md) - superseded by B80: widgets: focused/maximized widget keys leak into canvas shortcuts
- [x]: [B77](b/B77.md) - widget Preview never renders: template config reads missing omnidraw.json and validator rejects widget-preview frames
- [x]: [B78](b/B78.md) - Preview does not hot-reload on AI edits; initial bundle is slow
- [x]: [B79](b/B79.md) - Preview goes white and rebuilds slowly after server restart
- [x]: [B80](b/B80.md) - widgets: fullscreen widget keyboard leaks to canvas shortcuts (Backspace deletes it)
- [x]: [B81](b/B81.md) - cli: shutdown crashes with "Runtime cannot shutdown from state 'stopping'" on Ctrl+C
- [x]: [B82](b/B82.md) - ci: Linux Turso preflight changes `.tshm` mtime despite unchanged database bytes
- [R]: [B83](b/B83.md) - AI chat: resolve widget mentions to one safe authoring target (order 2/5)
- [R]: [B84](b/B84.md) - AI widgets: make omnidraw.json the concrete resource-binding authority (order 3/5)
- [x]: [B85](b/B85.md) - ci: align the canvas release marker with its public runtime changes
- [x]: [B86](b/B86.md) - ci: align the trusted Capsule build identity with 0.14.0
- [x]: [B87](b/B87.md) - ci: install Playwright Chromium before host browser acceptance
- [x]: [B88](b/B88.md) - ci: configure the Chromium sandbox for Preview inspection

## A dditions
- [x]: [A1] - file: support common CodeMirror languages
- [x]: [A2] - add inline text support to diamond and ellipse
- [ ]: [A3] - copy paste elements/groups
- [x]: [A4](a/A4.md) - terminal: use PartySocket for resilient PTY connection
- [x]: [A5](a/A5.md) - canvas CLI: explicit --db path override
- [x]: [A6](a/A6.md) - canvas CLI: end-to-end test harness
- [x]: [A7](a/A7.md) - canvas CLI: `list` command
- [x]: [A8](a/A8.md) - canvas CLI: `inspect` command (removed; use `query --id`)
- [x]: [A9](a/A9.md) - canvas CLI: `query` command
- [x]: [A10](a/A10.md) - canvas CLI: `patch` command
- [x]: [A11](a/A11.md) - canvas CLI: `move` command
- [x]: [A12](a/A12.md) - canvas CLI: `group` command
- [x]: [A13](a/A13.md) - canvas CLI: `ungroup` command
- [x]: [A14](a/A14.md) - canvas CLI: `delete` command
- [x]: [A15](a/A15.md) - canvas CLI: `reorder` command
- [x]: [A17](a/A17.md) - rect dbl click -> enter edit mode (inline text)
- [x]: [A18] - lift cmds to be api to allow live changes via crdt
- [x]: [A19](a/A19.md) - canvas CLI: `add` command
- [x]: [A20](a/A20.md) - canvas CLI: agent-friendly help, discovery, and forgiving errors
- [x]: [A21](a/A21.md) - canvas CLI: add `--dry-run` for add/patch/move/group/ungroup/delete
- [-]: [A22](a/A22.md) - canvas CLI: allow JSON array payloads for multi-element add and multi-target patch
- [x]: [A23](a/A23.md) - canvas CLI: document minimal required add args per element type and default optional fields
- [x]: [A24](a/A24.md) - filetree: double click file opens preview beside tree inside camera view
- [x]: [A25](a/A25.md) - canvas: react to live Automerge doc changes without page refresh
- [x]: [A26](a/A26.md) - remember canvas position for each canvas locally
- [x]: [A27](a/A27.md) - theme: make canvas overlays and terminal fully theme-aware
- [x]: [A29](a/A29.md) - theme: remember last light and dark theme choices when toggling
- [x]: [A30](a/A30.md) - theme: remove Tailwind from @vibecanvas/canvas and ship package CSS
- [x]: [A31](a/A31.md) - theme: remove Tailwind from frontend and stop scanning canvas sources
- [-]: [A32](a/A32.md) - hosted components: sandboxed Arrow runtime + per-component official packages
- [ ]: [A33] - deeplink to canvas object
- [x]: [A34](a/A34.md) - canvas: scene hydrator incremental reconcile instead of full reload on change
- [-]: [A35] - multiselect => clone drag
- [x]: [A36](a/A36.md) - theme: centralize canvas style ownership in ThemeService
- [-]: [A37] - shape1d binding -> must safe them to TElementData
- [x]: [A38](a/A38.md) - widgets: fullscreen DOM window mode
- [x]: [A39](a/A39.md) - canvas: non-sandboxed filesystem IDE plugin
- [x]: [A40](a/A40.md) - canvas: non-sandboxed terminal widget plugin
- [?]: [A41] - image delete from db -> use cron job if image is longer 7 days orphan
- [x]: [A42](a/A42.md) - codex hooks: reuse functional-core checks
- [?]: [A43](a/A43.md) - db: add authz for public DB methods
- [-]: [A44] - use to convert json schema to typescript types https://www.npmjs.com/package/json-schema-to-typescript
- [x]: [A45](a/A45.md) - eslint functional-core rules plus Pi/Codex post-turn hooks
- [x]: [A46](a/A46.md) - add widget wizard for AI-created widgets using pi.dev SDK harness
- [x]: [A47](a/A47.md) - ai wizard: replace widget tab with prosemirror chat input
- [x]: [A48](a/A48.md) - chat-render-output: assistant markdown without boxes
- [x]: [A49](a/A49.md) - ai wizard: cancel ongoing agent run
- [x]: [A50](a/A50.md) - ai wizard: chat-driven widget generation flow
- [x]: [A51](a/A51.md) - ai wizard: chat UI actions and model-aware prompts
- [x]: [A52](a/A52.md) - ai wizard: thinking level model menu
- [x]: [A53](a/A53.md) - ai wizard: draft Actor runtime API setup
- [x]: [A54](a/A54.md) - ai wizard: Actor tab powered by draft Actor
- [x]: [A55](a/A55.md) - ai wizard: Preview tab powered by draft Actor
- [x]: [A56](a/A56.md) - ai wizard: Tool tab for widget toolbar metadata
- [x]: [A57](a/A57.md) - ai wizard: new widget vs edit published widget flow
- [x]: [A58](a/A58.md) - ai wizard: show canvas sidebar on screen
- [x]: [A59](a/A59.md) - actor-ui: SolidJS actor state machine view
- [x]: [A60](a/A60.md) - actor IPC: spawn same compiled binary
- [x]: [A61](a/A61.md) - ai wizard: approve should scaffold then prompt AI implementation
- [x]: [A62](a/A62.md) - widgets: header three-dot menu
- [x]: [A63](a/A63.md) - widgets: split instance delete from definition delete
- [x]: [A64](a/A64.md) - cli: uninstall command removes binary and data
- [x]: [A65](a/A65.md) - agent tools: self-contained web_fetch tool
- [x]: [A66](a/A66.md) - toolbar: group widget tools into hover flyouts
- [x]: [A67](a/A67.md) - actor runtime: state lifecycle hooks and single state activity
- [x]: [A68](a/A68.md) - widgets: isolate loading failures and render in-frame error states
- [x]: [A69](a/A69.md) - actor resources: prepare shared resource control plane and IPC
- [x]: [A70](a/A70.md) - actor resources: implement KvResource
- [x]: [A71](a/A71.md) - actor resources: implement SecretStoreResource
- [x]: [A72](a/A72.md) - actor resources: implement schema-agnostic local Turso DbResource
- [x]: [A73](a/A73.md) - startup: create an empty canvas when none exists
- [x]: [A74](a/A74.md) - actor resources: replace versioned DbResource migrations with coordinated drafts and applies
- [x]: [A75](a/A75.md) - DB Resource UI
- [x]: [A76](a/A76.md) - sidebar: replace Tool Groups with a version-aware Widgets catalog
- [x]: [A77](a/A77.md) - AI chat: surface assistant and widget-level errors
- [x]: [A78](a/A78.md) - startup: warn when Node.js or npm is unavailable for widgets
- [ ]: [A79](a/A79.md) - onboarding: welcome canvas with inline tutorial
- [x]: [A80](a/A80.md) - codex: prompt for a branch in fresh worktrees
- [x]: [A81](a/A81.md) - docs: comprehensive UI screen atlas
- [x]: [A82](a/A82.md) - AI chat: open draft Preview frame from widget-create result
- [x]: [A83](a/A83.md) - widgets: drag published, draft, and Preview variants onto canvas
- [ ]: [A84](a/A84.md) - AI chat: slash commands for chat actions
- [-]: [A85](a/A85.md) - superseded canvas-engine widget-host pilot
- [-]: [A86](a/A86.md) - superseded: CanvasService collaboration policy moves to A90/A92
- [x]: [A87](a/A87.md) - widgets: migrate the untrusted browser runtime to Capsule
- [x]: [A88](a/A88.md) - style menu: pin left to screen, not canvas
- [x]: [A89](a/A89.md) - shared contracts and canvas_items JSONB schema
- [x]: [A90](a/A90.md) - authoritative server CanvasService
- [x]: [A91](a/A91.md) - centralized widget state authority
- [x]: [A92](a/A92.md) - coordinated hard cutover to CanvasService
- [x]: [A93](a/A93.md) - widgets: adopt Capsule native CSS and network image profiles
- [x]: [A94](a/A94.md) - restore remaining canvas, widget, and AI product gaps
- [x]: [A95](a/A95.md) - local Verdaccio registry for Cangine, Capsule, and widget SDK
- [x]: [A96](a/A96.md) - AI widgets: live Preview, exact promotion, and diagnostic repair loop
- [x]: [A97](a/A97.md) - AI Preview: host-owned log terminal below widget content
- [x]: [A98](a/A98.md) - canvas: add line shape controls to selection styles
- [x]: [A99](a/A99.md) - qualify recovered canvas and updated Capsule Preview diagnostics
- [x]: [A100](a/A100.md) - canvas: developer reproduction trace recorder
- [x]: [A101](a/A101.md) - canvas: move selection-style logic to Cangine headless controller
- [x]: [A102](a/A102.md) - Capsule 0.10: migrate Three.js widgets to public WEBGL API groups
- [x]: [A103](a/A103.md) - AI chat: await and test the exact live Preview revision
- [x]: [A104](a/A104.md) - AI chat: configurable protected-operation approval policy
- [x]: [A105](a/A105.md) - canvas: exclusive maximized-widget shell
- [x]: [A106](a/A106.md) - theme: authoritative CSS variables and compact canvas colors
- [ ]: [A107](a/A107.md) - sidebar: no hover color on section titles, compact "+ Add" widget button
- [x]: [A108](a/A108.md) - widgets: portable manifest and pure filesystem contracts
- [x]: [A109](a/A109.md) - widgets: atomic filesystem publication, scan, and ephemeral Preview
- [x]: [A110](a/A110.md) - widget inspector: filesystem Config, metadata publish, and implicit groups
- [x]: [A111](a/A111.md) - widgets: manifest v1 rename, shared draft root, sidebar draft rows, live Preview from creation
- [x]: [A112](a/A112.md) - chat tool: auto-return to select mode after placing a chat widget
- [x]: [A113](a/A113.md) - Preview: title-bar actions for reload, rebuild, publish, and remove
- [x]: [A114](a/A114.md) - AI widgets: inspect exact draft artifact with a Preview screenshot
- [x]: [A115](a/A115.md) - AI chat: edit and resend a past user message
- [x]: [A116](a/A116.md) - Capsule: bounded authoring inspection boundary for Preview tools
- [x]: [A117](a/A117.md) - Preview inspection: packaged browser runner and image tool results
- [R]: [A118](a/A118.md) - widget projects: portable SDK-based offline check (order 4/5)
- [R]: [A119](a/A119.md) - AI Chat: inspect accepted builds and the real Preview runtime (order 5/5)

## S ubtractions
- [x]: [S1](s/S1.md) - double bun run dev -> find new port
- [x]: [S2](s/S2.md) - rename CLAUDE.md -> AGENTS.md
- [x]: [S3](s/S3.md) - ci: introduce release branches, from main to deploy
- [x]: [S4](s/S4.md) - when hand tool (space pressed) must allow to move over chat too
- [x]: [S5](s/S5.md) - remove agent_logs table and just rely on opencode sessions
- [x]: [S6](s/S6.md) - remove chat.title
- [x]: [S7](s/S7.md) - use http in orpc
- [x]: [S9](s/S9.md) - fix seo image of web
- [x]: [S10](s/S10.md) - reverse websocket to orpc
- [x]: [S12](s/S12.md) - refactor: konvajs
- [x]: [S13](s/S13.md) - canvas plugins: folder-per-plugin refactor plan
- [x]: [S14](s/S14.md) - canvas: keep recorder plugin in development only
- [x]: [S15] - inline text support -> fix position (use pretext lib?)
- [x]: [S16](s/S16.md) - canvas: fix broken TypeScript typings in packages/canvas
- [x]: [S17](s/S17.md) - extract apps/server into apps/cli + shared packages
- [x]: [S18](s/S18.md) - cli server: migrate http file/static/spa serving from apps/server
- [x]: [S19](s/S19.md) - cli orpc: expose db events stream and remove apps/server api.db
- [x]: [S20](s/S20.md) - cli server: restore compiled-mode port fallback when preferred port is busy
- [x]: [S21] remove apps/server and packages/functional-core and shell
- [x]: [S22] fix build and ci tests to use new apps/cli
- [x]: [S23] Use global costs for dev and prod ports
- [x]: [S24] rename @vibecanvas/service-db -> @vibecanvas/service.db and co
- [x]: [S25](s/S25.md) - db: remove filetrees table/schema; canvas-doc fully owns filetree state
- [x]: [S26](s/S26.md) - db: add filesystems db table for local/remote machine identity
- [x]: [S27](s/S27.md) - canvas CLI: remove unimplemented `render` command and help traces
- [x]: [S28](s/S28.md) - use runtime package in canvas, like cli does
- [x]: [S29](s/S29.md) - canvas: add debug config via localstorage for each plugin and service
- [x]: [S30](s/S30.md) - canvas: remove remaining Tailwind-style classes from component TSX
- [x]: [S31](s/S31.md) - frontend: remove remaining Tailwind-pattern source from app UI
- [x]: [S31] - how to deal with /Users/omarezzat/Workspace/vibecanvas/vibecanvas/packages/canvas/src/core/pretext.ts
- [x]: [S32] - show stylemenu already in create mode when tool like rect,pen is pressed. ux -> user knows where to draw
- [x]: [S33] - canvas architecture: rename SceneService -> SceneService and split EditorService so editor keeps only edit/transform state while scene registries/mapping move to SceneService
- [x]: [S34] - test canvas/core if all fn fx file function are correct
- [x]: [S35](s/S35.md) - canvas/core: align fn fx tx file boundaries, injected portals, and callers
- [x]: [S36](s/S36.md) - transform ownership: plugin only renders/dispatches; element plugins own drag + crdt
- [x]: [S37](s/S37.md) - Refactor canvas service/plugin --> simplification written by hand
- [x]: [S38] - make fn,fx,tx files extension also lint script
- [x]: [S39] - add TGroup and TElement types for canvas (human leaf file)
- [x]: [S40](s/S40.md) - canvas: move inline shape text ownership into shape2d
- [x]: [S41](s/S41.md) - canvas: introduce CloneService and centralize clone lifecycle
- [x]: [S41] - remove fnCreateLegacyShape2dInlineTextMigrationPlan in next version
- [x]: [S42] - service refactor
- [x]: [S43](s/S43.md) - canvas: normalize clone-drag through CloneService
- [x]: [S44](s/S44.md) - canvas tests: services and transform lane
- [x]: [S45](s/S45.md) - canvas tests: text edit/session lane
- [x]: [S46](s/S46.md) - canvas tests: element creation and clone lane
- [x]: [S47](s/S47.md) - canvas tests: stale coverage audit and integration lane
- [-]: [S48](s/s48.md) - registerElement options are unclean, e.g. onMove is tranformer move only
- [x]: [S49] - TODO [S49]: add onRemove to some callback later
- [x]: [S50](s/S50.md) - remove legacy hosted file, filetree, terminal element code
- [x]: [S51](s/S51.md) - add canvas performance - tested in worktree
- [x]: [S52] - remove drizzle use turso + raw sqlite
- [x]: [S53](s/S53.md) - normalize functional-core extension into reusable core
- [x]: [S54](s/S54.md) - simplify widget system
- [x]: [S55](s/S55.md) - store images as blob not base64
- [x]: [S56](s/S56.md) - superseded by S104 filesystem stack removal
- [x]: [S57] - superseded by S104 filesystem stack removal
- [x]: [S58](s/S58.md) - widget SDK bridge: sandbox-local reactive actor proxy
- [x]: [S59](s/S59.md) - cleanup functional-core eslint-disable exceptions
- [x]: [S60](s/S60.md) - remove terminal widget (comment out only)
- [x]: [S61](s/S61.md) - remove filesystem widget (comment out only)
- [x]: [S62](s/S62.md) - superseded by S103 PTY stack removal
- [x]: [S63](s/S63.md) - superseded by S104 filesystem stack removal
- [x]: [S64](s/S64.md) - db: store actor manifest paths relative to config
- [x]: [S65](s/S65.md) - widget tool icon metadata object and validation
- [x]: [S66](s/S66.md) - ai wizard: cap chat input height
- [x]: [S67](s/S67.md) - floating menu only when element is selected
- [x]: [S68](s/S68.md) - ai wizard chat running indicator
- [x]: [S69](s/S69.md) - ai wizard: save tool before phase2 updates candidate
- [x]: [S70](s/S70.md) - ai wizard: remove default slash and mention values
- [x]: [S71](s/S71.md) - image paste: render local preview while uploading to remote server
- [x]: [S72](s/S72.md) - canvas: allow zoom from 0.1 to 6.0
- [x]: [S73](s/S73.md) - cli upgrade: replace fixed download marker with streamed progress
- [x]: [S74](s/S74.md) - update workspace dependencies in safe coordinated batches
- [x]: [S75](s/S75.md) - migrate canvas and frontend to Konva 10
- [x]: [S76](s/S76.md) - remove unused PDF.js dependency
- [x]: [S77](s/S77.md) - migrate marketing site to Astro 7
- [x]: [S78](s/S78.md) - migrate workspace builds to Vite 8
- [x]: [S79](s/S79.md) - migrate DOM tests to jsdom 29
- [x]: [S80](s/S80.md) - migrate workspace to TypeScript 7
- [-]: [S81](s/S81.md) - assess pre-1.0 dependency upgrades
- [-]: [S82](s/S82.md) - replace the session-bound AI wizard with a shared multi-resource agent
- [x]: [S83](s/S83.md) - isolated AI Chat workspaces over shared widget folders
- [x]: [S84](s/S84.md) - simplify canvas AI frontend to chat, user preview, and user publish
- [x]: [S85](s/S85.md) - agent tools: name-addressed resources, visible results, and Pi Bash
- [x]: [S86](s/S86.md) - human-readable dated AI chat storage and stable chat identity
- [x]: [S87](s/S87.md) - simplify vc_widget_create to one runnable construction scaffold
- [x]: [S88](s/S88.md) - extract AI Chat, widgets, and sidebar from canvas
- [x]: [S89](s/S89.md) - actor resources: add independent key-value file persistence
- [x]: [S90](s/S90.md) - actor resources: move KvResource out of the control database
- [x]: [S91](s/S91.md) - actor resources: move SecretStoreResource out of the control database
- [-]: [S92](s/S92.md) - dropped: preserve or upgrade pre-cutover databases
- [x]: [S93](s/S93.md) - secret stores: reveal values and encrypt Turso files at rest
- [?]: [S94](s/S94.md) - widget detail: context-mounted edit chat
- [x]: [S95](s/S95.md) - sidebar: unify selected widget highlight
- [x]: [S96](s/S96.md) - AI mentions: live resource and widget catalog
- [x]: [S97](s/S97.md) - compress task reference images
- [x]: [S98](s/S98.md) - widgets: replace fullscreen header with SolidJS host chrome
- [x]: [S99](s/S99.md) - widget publish: explicit confirmation from Preview and draft detail
- [x]: [S100](s/S100.md) - sidebar: toggle tool groups from the whole row
- [x]: [S101](s/S101.md) - relax home directory validation
- [x]: [S102](s/S102.md) - dev server uses local .vibecanvas
- [x]: [S103](s/S103.md) - remove PTY service, API, canvas terminal, and SQL metadata
- [x]: [S104](s/S104.md) - remove filesystem service, API, canvas plugin, and SQL table
- [x]: [S105](s/S105.md) - remove scoped_events table and related code
- [x]: [S106](s/S106.md) - widgets: remove published source folders and use source artifacts only
- [x]: [S107](s/S107.md) - widgets: remove the actor system completely
- [x]: [S108](s/S108.md) - widgets: historical UI-only Preview subtraction (superseded by E40/A96)
- [x]: [S109] - remove uuid check in db sql files.
- [x]: [S110] - use Turso types and domains where they improve schema constraints
- [x]: [S111](s/S111.md) - canvas: replace Konva with canvas-engine
- [x]: [S112](s/S112.md) - canvas: adopt engine resource, publication, transient-clone, and click primitives
- [x]: [S113](s/S113.md) - canvas: adopt Cangine 0.2 editor and fixed widget frames
- [x]: [S114](s/S114.md) - widgets: remove OCI builds after Capsule host-native npm release
- [x]: [S115](s/S115.md) - canvas: adopt Cangine PathInteractionController for lines/arrows
- [x]: [S116](s/S116.md) - delete retired persistence/projection architecture
- [x]: [S117](s/S117.md) - resource runtime: remove cross-process Resource Store ownership locks
- [x]: [S118](s/S118.md) - canvas: remove generic widget catalog toolbar plumbing
- [x]: [S119](s/S119.md) - canvas: toolbar should be smaller in size and go 2 row when height small.
- [x]: [S120](s/S120.md) - db: adopt Turso JSONB for canvas and widget-state payloads
- [x]: [S121](s/S121.md) - canvas: replace recorder persistence with Cangine controlled transactions
- [x]: [S122](s/S122.md) - agent: restore host-authority Bash with Bun PTY
- [x]: [S123](s/S123.md) - Preview: move actions into one Manage dropdown
- [x]: [S124](s/S124.md) - packages: remove deleted-package residue and stale docs
- [x]: [S125](s/S125.md) - canvas: remove duplicate host resize observer
- [x]: [S126](s/S126.md) - canvas: delete the CSS grid and use Cangine background rendering
- [x]: [S127](s/S127.md) - canvas: delete the local command reducer after Cangine 0.4.0
- [x]: [S128](s/S128.md) - canvas: migrate the surface background and grid to Cangine 0.5 projections
- [/]: [S129](s/S129.md) - rename: vibecanvas → omnidraw for 0.5.0 (hard reset)
- [x]: [S130](s/S130.md) - remove marketing/docs website and GitHub Pages publishing
- [x]: [S131](s/S131.md) - canvas: use Cangine 0.5.3 and own the Capsule portal bridge
- [x]: [S132](s/S132.md) - packages: make the canvas kernel workspace-split ready
- [x]: [S133](s/S133.md) - widget publish: auto-heal changed drafts; Publish builds current source and promotes that exact build
- [x]: [S134](s/S134.md) - release 0.5.0: remove binary distribution, normal build, docs and CI cleanup
- [x]: [S135](s/S135.md) - db: rewrite the single-user Turso baseline and remove identity scope
- [x]: [S136](s/S136.md) - widgets: switch runtime authority to files and delete widget control tables
- [x]: [S137](s/S137.md) - functions: delete durable invocation and usage, keep direct calls
- [x]: [S138](s/S138.md) - widgets: remove obsolete revision, Preview, artifact, group, Runs, and Logs surfaces

## E xplorations
- [-]: [E1](e/E1.md) - Tauri Research
- [x]: [E5](e/E5.md) - how to implement state machine system?
- [-]: [E6](e/E6.md) - should we include a task management
- [x]: [E8](e/E8.md) - canvas CLI: query/edit surface exploration
- [x]: [E9] - superseded by S103 PTY stack removal
- [ ]: [E10] - headless chrome to stream to canvas
- [ ]: [E11] - https://github.com/cr0hn/dockerscan
- [ ]: [E12] - https://github.com/superradcompany/microsandbox
- [x]: [E13](e/E13.md) - Research Pluginsystem for server
- [x]: [E14] - do we need packages/functional-core
- [x]: [E15](e/E15.md) - canvas UI extensions: sideloadable community widgets and ArrowJS exploration
- [x]: [E16] - filewatch performance. -> on big folders are slow
- [x]: [E17](e/E17.md) - automerge authority: optimistic local writes with server validation/reject path
- [?]: [E18] - replace iframe with bun.webview??
- [-]: [E19](e/E19.md) - canvas performance longterm: worker automerge + incremental notifications
- [x]: [E20](e/E20.md) - improvement crdt updates
- [-]: [E21] - explore ways to extend arrowjs to allow safe dom and canvas api access for codemirror and threejs
- [x]: [E22](e/E22.md) - canvas performance: widget mesh drag work
- [ ]: [E23](e/E23.md) - actor output log pruning compatibility
- [x]: [E24](e/E24.md) - canvas services/plugins rendering responsibility split
- [x]: [E25](e/E25.md) - spawn actor IPC with same compiled binary
- [x]: [E26](e/E26.md) - widget ideas: fun actor/widget examples
- [?]: [E27](e/E27.md) - reuse sidebar for canvas detail page
- [x]: [E28](e/E28.md) - codex workspace copy: local-volume and actor manifest path rewrite
- [x]: [E29](e/E29.md) - create minimal repro repo at /Users/omarezzat/Workspace/vibecanvas/vibecanvas/.tmp/turso-actor-write-race to validate actor/widget clone DB concurrency hypothesis: scaffold minimal CLI+Turso service, run actor insert/update/delete write bursts, reproduce Turso pager `cell_get` panic, capture lock/error behavior, and compare serialized-write baseline
- [x]: [E30](e/E30.md) - actor resources: evaluate independent files for KV and secret stores
- [ ]: [E31](e/E31.md) - Turso schema to TypeScript type generation
- [x]: [E32](e/E32.md) - Capsule migration: compiled, actor-native widget sandbox
- [ ]: [E33](e/E33.md) - widget drafts: clarify when edits take effect
- [ ]: [E34](e/E34.md) - Capsule-only Vibecanvas manifest v1 and artifact boundary
- [ ]: [E35] - Markdown Notes support
- [x]: [E36](e/E36.md) - managed multi-tenant architecture and scale-to-zero widget functions
- [x]: [E37](e/E37.md) - canvas-engine compatibility audit and executable migration contract
- [ ]: [E38](e/E38.md) - canvas: terminal engine recreation and bounded recovery policy
- [x]: [E39](e/E39.md) - canvas: collapse the collaborative document onto Automerge and Cangine
- [x]: [E40](e/E40.md) - AI widget live Preview: architecture and product decision ledger
- [x]: [E41](e/E41.md) - widgets: filesystem-first publication and database hard cut
- [x]: [E42](e/E42.md) - widgets: server-function mounts reject builder-signed capability digest (a04fb57b regression)

## D ebt
- [x]: [D1](d/D1.md) - managed-service OSS rewrite and scale-to-zero functions
- [-]: [D2](d/D2.md) - canvas-engine integrated projector and product performance qualification
- [x]: [D3](d/D3.md) - canvas projection: remove remaining scale cliffs
- [ ]: [D4](d/D4.md) - canvas: audit and remove unused `@chenglou/pretext` code paths
- [ ]: [D5](d/D5.md) - packages: publish the managed-service dependency set
- [x]: [D6](d/D6.md) - widgets: qualify the filesystem-first single-user hard cut
- [?]: [D7](d/D7.md) - undecided: per-canvas revision is a coarse optimistic concurrency counter
- [ ]: [D8](d/D8.md) - widgets: headless mount-catalog dry-run in od_widget_validate
- [~]: [D9](d/D9.md) - local registry: decouple dev boot from publish, automate the dev-prerelease escape hatch, stop version-bump churn
- [R]: [D10](d/D10.md) - widget repos: portable build receipts and smart Preview refresh (order 1/5)

## Pragmatic Code Style

Long code line for lookup / easy parts.
Short code line for complex parts.
If in doubt, use long code line.

early exit > if else

Comment on complex parts.
You change code, you change comments.

locality of behavior, don't make me jump around

minimize redirections

factor out logic only if repeated 3 times or more
factor out only if really same logic

move types if shared into local types.ts file

types dont contain understanding, only structure, it's boilerplate, move out of sight

2 spaces for indentation
