# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added
- Added `vibecanvas uninstall` with dry-run output, confirmation, and `--yes` for removing curl-installed binaries and local Vibecanvas data safely.
- Added a lightweight `web_fetch` agent tool for fetching HTTP(S) pages as raw text, normalized text, or markdown with timeout, byte-limit, and SPA/app-shell detection.

### Fixed
- Collapsed AI wizard tool-result messages by default with a five-line preview and click-to-expand behavior.
- Renamed the UI widget header menu delete action from `Delete widget` to `Delete instance` to match its instance-only behavior.
- Fixed the canvas style menu so drawing tools no longer show it without a selected element, and mounted it relative to the page body to avoid wasting canvas space.

## 0.4.2

### Fixed
- Fixed curl installer latest-release parsing for GitHub API `tag_name` JSON formatting.
- Fixed curl-installed binaries failing to start by packaging Turso native addons in GitHub release archives and installing them into `~/.vibecanvas/native`.

## 0.4.1

### Fixed
- Fixed CLI upgrade release detection for `vibecanvas-v*` GitHub release tags so `vibecanvas upgrade --check` can find newer releases.
- Fixed curl installer checksum fallback URLs to use `vibecanvas-v*` release tags.
- Made Vibecanvas npm publishing safer to retry by skipping already-published package versions and publishing platform packages before the wrapper package.

## 0.4.0

### Added
- Added Pi Harness support for AI Wizzard Widget
- Added Actor and Agent Service
- Added sdk for guest code
- Added draft Actor runtime support for AI widget generation, including actor manifests, actor/preview/tool tabs, actor state machine UI, approval handoff, tool result inspection, and compiled-binary IPC spawning.
- Added widget toolbar metadata editing with structured icon metadata, preset/custom SVG icons, and validation.
- Added widget header overflow menus plus separate instance deletion and widget definition deletion flows.
- Added sandbox-local reactive actor proxy support for the Widget SDK bridge.
- Added package/version metadata simplification for release builds.

### Changed
- Migrated BunSqlite -> Turso
- Reworked the widget system around actor-backed draft and published widget flows, including published-widget edit sessions, toolbar refresh after publish, and preview gating until an actor candidate is approved.
- Persisted actor manifest paths relative to the Vibecanvas config so cloned/worktree environments can relocate actor projects more reliably.
- Improved AI wizard layout and UX, including visible canvas sidebar behavior, settings/chat tab routing, composer overflow caps, and cleaner assistant markdown rendering.
- Centralized and hardened canvas/service/plugin architecture with functional-core checks, fn/fx/tx linting, service boundary cleanup, and broader canvas service/test coverage.
- Stored pasted/imported images as blobs instead of base64.
- Temporarily removed legacy terminal and filesystem widgets while the new widget API path is rebuilt.

### Fixed
- Fixed canvas interaction regressions including frame drag, hand/drag behavior, 1D edits, text deletion, inline shape text editing, style palette layout, pan/zoom during text edit, preview listener attachment, and initial camera movement performance.

## 0.3.1

### Added
- Added registered filesystem discovery via the filesystem API so clients can list available filesystem identities.
- Added CLI filesystem bootstrapping that persists a machine identity and ensures a local filesystem row exists on startup.

### Changed
- Threaded optional `filesystemId` through filesystem and PTY API contracts to prepare local/remote machine routing.
- Updated filesystem and PTY service interfaces so service-layer calls now operate on an explicit filesystem identity.

### Fixed
- Filetree permission errors: Now shows permission errors instead of crashing.

## 0.3.0

### Added
- Added a full canvas CLI workflow for creating, listing, querying, adding, patching, moving, reordering, grouping, ungrouping, and deleting canvas elements.
- Introduced plugin system for apps/cli
- Added PTY image upload API support for writing pasted clipboard images to remote temp storage and returning the absolute server path.
- Added shared `@vibecanvas/orpc-client` package so frontend and canvas use the same ORPC websocket client and safe API types.

### Changed
- Replaces apps/server with apps/cli
- Moved filetree ownership fully into the canvas document and removed the separate filetrees table/schema from the database.
- Replaced canvas-side handwritten ORPC safe client mirror types with the shared `@vibecanvas/orpc-client` types.
- Renamed hosted widget transport wiring from `safeClient` to `apiService` across canvas/frontend integration for clearer ownership.

### Fixed
- Fixed hosted terminal image paste on deployed/remote setups by uploading clipboard images to PTY temp storage and inserting the returned shell-escaped remote path into the terminal.
- Kept unsupported non-text terminal paste payloads on the existing Ctrl+V fallback path.
- Fixed live canvas scene updates so Automerge changes from remote/CLI/server mutations now appear without a page refresh.

## 0.2.2

### Fixed
- Fixed hosted terminal and other hosted widgets getting stuck non-interactive after resize, so focus returns normally once the transform completes.
- Made PTY terminal websocket connections more resilient by switching the canvas terminal transport to PartySocket reconnecting websockets.
- Fixed hosted terminal Ctrl+C handling by replacing the broken Bun PTY backend with `bun-pty`, so terminal interrupts now reach the foreground process instead of echoing `^C` as literal input.

## 0.2.1

### Fixed
- Persisted native canvas drag position updates for hosted widgets and iframe browser widgets so reload restores the latest location.
- Fixed selection style menu updates so dragging a stylable element or group and then changing color/width/font/curve no longer snaps it back to its pre-drag position.
- Fixed broken TypeScript typings
- Fixed filetree-to-terminal drops so dropping a file or folder onto a hosted terminal inserts the shell-escaped path, focuses the terminal, and keeps blank-canvas drops creating hosted widgets.
### Refactor
- Restructured plugins into subfolders

## 0.2.0

### Removed
- Chat widget
- OpenCode dependency

### Added
- New canvas architecture with Konva and plugins.
- Hosted widgets on the canvas, including terminal, file tree, file widgets, and iframe support.

## 0.1.8
- Added canvas file support.
- Expanded file-oriented workflows inside the canvas experience.

## 0.1.7
- Improved terminal startup reliability.
- Adjusted startup ordering so OpenCode initializes before the HTTP server.
- Added clearer startup logging.

## 0.1.6
- Introduced terminal functionality as a first-class feature.

## 0.1.5
- Refactored HTTP communication around ORPC-related flows.
- Simplified client/server API interaction.

## 0.1.4
- Refactored session handling to use OpenCode sessions more consistently.

## 0.1.3
- Added OpenCode slash commands and file commands.
- Improved agent/file interaction workflows.

## 0.1.2
- Performance improvements and optimizations.

## 0.1.1
- Text editing and text behavior bug fixes.

## 0.1.0
- Added ProseMirror-based editor support.
- Improved rich text and structured editing workflows.

## 0.0.10
- Added file tree support.

## 0.0.9
- Improved build constant/type reference handling for server-side TypeScript.

## 0.0.8
- Fixed compiled version root path handling.

## 0.0.7
- Release housekeeping and version update.

## 0.0.6
- Added onboarding-related improvements for the 0.1.0 development cycle.

## 0.0.5
- Fixed multiplayer-related issues.

## 0.0.4
- Improved install/build distribution flow and CI setup.

## 0.0.3
- Packaging and release adjustments.

## 0.0.2
- Initial public project setup.
