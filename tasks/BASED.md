# Overview

## Introduction

Building software is explorative, creative and sometimes dull and repetitive.
This document outline the how build software in a highly technical,
small and motivated team. The goal is to minimize management
and maximize throughput. The idea behind Based is that programming is 90% context loading and 10% actual solving and coding. Therefore we should batch work for context loading and minimize context switching.
Based skips the traditional agile ceremonies and focuses on the codebase and a glorified todo list.
The todo list is the heart of the project. No tickets, no boards, no sprints, no backlog.
Just a list of things to do. The list is grouped into 5 and ordered by importance within each group.
Every dev opens a branch and picks a set of items they want to work on. They open a file based on
their branch and copy the items and explain what they are doing. Once merged the items are removed
from the list the branch file is kept.

Every change in the codebase can be grouped into one of the following categories:

B ugs: Something is not working as expected.
A dditions: New features or improvements.
S ubtractions: Removing or simplifing parts of the codebase.
E xplorations: Researching new technologies or ideas.
D eployable: Important changes that are ready to be deployed.

The status are tagged:
- [ ]: open
- [x]: closed
- [-]: dropped
- [?]: unsure
- [!]: urgent
- [~]: in progress
- [/]: blocked

Remember to keep the codebase small. Small is clean, small is fast. Delete often.

## Structure

Based now lives at the repository root in `tasks/`.

- `tasks/BASED.md`: overview, active index, and conventions.
- `tasks/b/`: bug files.
- `tasks/a/`: addition files.
- `tasks/s/`: subtraction files.
- `tasks/e/`: exploration files.
- `tasks/d/`: deployable files.

Each line in the overview stays short and links to one dedicated file.
Each dedicated file stores the task context, TODOs, notes, and logs.

## Format

Overview entries use this format:

`- [x]: [B1](b/B1.md) - text: edit jumping`

Humans usually don't create leaf files. But agents do.

Leaf files use this format:

```md
# B1 - text: edit jumping
[Overview](../../BASED.md)

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
Editing `tasks/BASED.md` alone does not require a `FILES.md` bookkeeping update.

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
- [ ]: [B16](b/B16.md) - ci: `@vibecanvas/canvas` tests load Konva node entry and require native `canvas` - only fails in ci
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
- [ ]: [B28] - group with widget and rect -> delete rect must also deletes widget
- [x]: [B29] - shape2d -> edit must show vertical heigt correctly and hide konva.text while editing
- [x]: [B30] - can't delete text

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
- [ ]: [A41] - image delete from db -> use cron job if image is longer 7 days orphan
- [x]: [A42](a/A42.md) - codex hooks: reuse functional-core checks
- [ ]: [A43](a/A43.md) - db: add authz for public DB methods
- [ ]: [A44] - use to convert json schema to typescript types https://www.npmjs.com/package/json-schema-to-typescript

## S ubtractions
- [ ]: [S1](s/S1.md) - double bun run dev -> find new port
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
- [ ]: [S48](s/s48.md) - registerElement options are unclean, e.g. onMove is tranformer move only
- [x]: [S49] - TODO [S49]: add onRemove to some callback later
- [x]: [S50](s/S50.md) - remove legacy hosted file, filetree, terminal element code
- [x]: [S51](s/S51.md) - add canvas performance - tested in worktree
- [~]: [S52] - remove drizzle use turso + raw sqlite
- [x]: [S53](s/S53.md) - normalize functional-core extension into reusable core
- [~]: [S54](s/S54.md) - simplify widget system
- [ ]: [S55] - store images as blob not base64
- [ ]: [S56](s/S56.md) - check if service-filesystem filewatcher needs rework for Bun 1.3.14 fs.watch rewrite

## E xplorations
- [-]: [E1](e/E1.md) - Tauri Research
- [x]: [E5](e/E5.md) - how to implement state machine system?
- [-]: [E6](e/E6.md) - should we include a task management
- [x]: [E8](e/E8.md) - canvas CLI: query/edit surface exploration
- [ ]: [E9] - tmux for persistant pty sessions
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
- [?]: [E21] - explore ways to extend arrowjs to allow safe dom and canvas api access for codemirror and threejs
- [x]: [E22](e/E22.md) - canvas performance: widget mesh drag work
- [ ]: [E23](e/E23.md) - actor output log pruning compatibility
- [x]: [E24](e/E24.md) - canvas services/plugins rendering responsibility split
- [ ]: [E25](e/E25.md) - spawn actor IPC with same compiled binary

## D eployable
- [ ]: [D1] - Generative UI with AI assits
- [ ]: [D2] - Actor system is attachable
- [ ]: [D3] - Support pluggable filsystem architecture
- [ ]: [D4] - Support sideloadable ui elements
- [ ]: [D5] - AI Canvas Element, attachable to other elements
- [ ]: [D6] - Gateway support
- [ ]: [D7] - Auth support

## Pragmatic Code Style

Long code line for lookup / easy parts.
Short code line for complex parts.
If in doubt, use long code line.

early exit > if else

Comment on complex parts.
You change code, you change comments.

pure fn > fn > static class > class

fn with side effects should have suffix ...Fx

locality of behavior, don't make me jump around

minimize redirections

dry is bad, make longer functions

factor out logic only if repeated 5 times or more
factor out only if really same logic

move types if shared into local types.ts file

types dont contain understanding, only structure, it's boilerplate, move out of sight

2 spaces for indentation
