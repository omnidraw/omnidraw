# Omnidraw widget system

**Status:** Current after the filesystem-first single-user hard cut
(A108–A111, S135–S138, D6).

Omnidraw widgets are folders. The filesystem is the only widget authority:
drafts, published folders, and ephemeral Preview live under one pinned widget
root in the Omnidraw home directory. The database keeps no widget catalog, no
releases, no artifacts, no Preview records, and no function history.

## Concepts

1. **Draft** is a mutable source folder under `drafts/<slug>/` with a strict
   `omnidraw.json` (manifest v1). Editing a draft never changes a published
   widget.
2. **Published widget** is an immutable folder under `published/<slug>/`
   written by one atomic publication: the exact `omnidraw.json`, the exact
   `release.json`, and every exact runtime file (browser `dist/`, signed
   `capsule.artifact`, optional `server-dist/` and `functions.json`).
3. **Catalog** is a bounded, immutable in-memory scan generation of the
   widget root. Readers pin one generation; writers refresh it after each
   checked mutation. Generation numbers are process-local and may decrease
   after restart.
4. **Preview** is a full-stack build owned by the current process. Nothing
   about it is durable; a stopped canvas Preview frame shows
   **Preview stopped — build again.**
5. **Widget instance** is a canvas frame whose extension stores only
   `widgetKey` and a stable `instanceId` (plus concrete resource choices).
   It always follows the current healthy publication.
6. **Server function** is a declared, descriptor-driven export of a published
   (or Preview) widget. Calls are one live request and one live response with
   no durable history.

## Widget root layout

```
widgets/
  drafts/<slug>/          # mutable authoring folders
  published/<slug>/       # immutable current publications
  .staging/               # crash-safe construction before atomic rename
  .preview/               # process-owned Preview scratch
  .trash/                 # retained deleted folders
  .quarantine/            # unsafe or invalid folders isolated from scans
```

- Roots are pinned once and every path is resolved lexically inside them.
  Traversal, symlinks, special files, case collisions, and duplicate slugs
  are rejected or quarantined.
- Publication stages the complete replacement under `.staging/`, validates
  the exact file list, checksums, Capsule identity, and function descriptors,
  then atomically renames it into place. Interrupted replacements recover by
  restoring the last validated current folder or quarantining the invalid
  candidate; readers are poisoned instead of guessing.

## Manifest v1 and release.json

`omnidraw.json` is strict: unknown fields fail. Presentation fields (`name`,
`description`, `tool`) and executable fields (`ui`, `server`, `resources`)
project separately, so metadata-only edits never rebuild executable bytes.

- **Executable projection** (`schemaVersion: 1`, `ui`, `server | null`,
  `resources`) is the only manifest form the Capsule builder consumes. Its
  canonical JSON digest keys every build and reuse decision together with the
  executable-input digest (manifest + source files + build environment).
- **`release.json`** is minimal: exact file list with byte sizes and SHA-256,
  the signed Capsule identity and runtime descriptor, optional server entry
  with `runtimeAbi` and the functions digest, the executable-manifest digest,
  and the host release attestation. It is validated exactly before a folder
  counts as published.
- Exactly one manifest version exists: v1. There is no legacy reader, no
  migration, no revision ID, no pinning, and no rollback.

## Publication actions

| Action | Effect |
| --- | --- |
| Save draft Config | Digest-fenced write of presentation/manifest fields into the draft. |
| Publish metadata | Atomically replaces only `omnidraw.json` in the published folder; executable bytes are byte-identical before and after. No install, construction, Capsule generation, or signing runs. |
| Build & publish | Full distribution build, descriptor extraction, Capsule construction and release signing, exact release validation, atomic replacement. Existing canvas instances remount against the new current publication while keeping their instance state and resource choices. |

## Runtime loading

The browser mounts widgets through the filesystem catalog:

1. `widget.runtime.load` pins the canvas item identity (`canvasId`,
   `elementId`, `widgetInstanceId`, `widgetKey`), resolves the current
   catalog generation, reads the exact signed Capsule bytes listed in
   `release.json`, and revalidates the server-function descriptor digest and
   the signed capability request before returning mount inputs.
2. A missing or unhealthy publication produces a missing-widget frame. No
   durable canvas row or widget state is deleted.
3. `WidgetStateService` stays the only owner of shared widget-instance JSON
   state, keyed and compare-and-swap fenced against the exact canvas
   identity. Publication changes never touch it.
4. Resource bindings live on the canvas item. Runtime and function reads
   re-read the item so binding edits apply without a frame rebuild.

## Preview

Preview is full-stack but process-owned. The current process keeps build
status, temporary Capsule bytes, live diagnostics, selected resources,
signing work, and mounted handles; nothing survives restart.

- The sidebar renders each catalog entry as one published row (**Add**:
  places the current publication) and, only while the draft differs from the
  publication, one draft row (**Preview**: places an ephemeral Preview frame).
- A freshly placed Preview frame builds immediately: its first attach falls
  back from `widget.preview.load` to `widget.preview.open` when no live
  session exists. The stopped fallback (**Preview stopped — build again.**)
  remains only for frames that outlived their host process.
- `widget.preview.open` captures the draft, builds (or reuses the exact
  validated construction while digest and compatibility policy match),
  signs with the preview key, and returns mount inputs and diagnostics.
- `widget.preview.load` returns the live session for one canvas frame or
  fails `NOT_FOUND`.
- `widget.preview.close` disposes the session; `widget.preview.invoke`
  executes a declared server function against the session's exact server
  artifact with its selected resources.
- The canvas Preview frame persists only the draft `widgetKey` and normal
  frame data (`widget-preview` extension). Deleting the frame closes the
  session. One Preview frame per draft is kept per canvas: placing the same
  draft again focuses the existing frame.
- Publish may reuse the exact validated construction when the draft digest
  still matches; release signing wraps the same unsigned bytes.

## Direct server functions

One call resolves the current canvas item and the current published (or
Preview) folder, checks the descriptor, input schema, declared resource
effects, timeout, cancellation, disconnect, and concurrency, then executes in
one disposable child process and returns one terminal result.

- Resource writes use process-local, single-use permits. A permit is
  consumed even when the outcome is unclear to the caller, and there is no
  automatic retry after an unclear write.
- There are no queues, leases, receipts, idempotency records, attempts,
  logs, status reads, usage accounting, or invocation history — after
  restart nothing is inspectable.

## AI authoring

The agent works on the same shared draft root as every other surface:
`od_widget_create` scaffolds a strict manifest-v1 draft directly into
`widgets/drafts/<slug>/`, and each chat workspace mounts it by display name
(`workspace/widgets/<name>` symlinks resolved through the manifest). Chat
created drafts therefore appear in the catalog, the sidebar, Preview, and
Publish without any bridge. Successful create/validate results offer an
**Open Preview** action that places a live draft Preview frame beside the
originating chat. Validation runs the same build pipeline used by Preview
and Publish and reports whether the Preview build actually ran. Every draft
change invalidates the widget catalog so sidebar rows and frames refresh
without a manual reload. Durable chat metadata lives in the `chats` table;
transcripts stay files.

## Package map

| Package | Role |
| --- | --- |
| `packages/widget-contract` | Manifest v1, executable projection, release descriptor, runtime descriptor, canonical digests, Capsule identity, function descriptors. |
| `packages/capsule-omnidraw` | Omnidraw policy bridge for Capsule: capabilities, budgets, signing, guest build, and the executable-projection artifact builder. |
| `packages/function-runtime` | Direct descriptor-driven invocation, disposable child driver, schema validation, ephemeral write permits. |
| `packages/resource-runtime` | Resource gateway/store contracts and local kv/secret/db providers. |
| `packages/service-agent` | Widget root workspace, bounded catalog scans, atomic publication, ephemeral Preview orchestration, agent sessions and tools. |
| `apps/cli` | Singleton composition: catalog, build service, preview service, function service, resource store, signing keys, host configuration. |
| `packages/api` | oRPC contracts and handlers for catalog, Config, publication, placement, runtime load, preview, state, and functions. |
| `packages/ui-ai-chat` | Sidebar catalog, Config inspector, runtime and preview mounting, function bridge, placement. |

## Invariants

- The filesystem is the only widget catalog and release authority.
- The database has exactly 14 application tables; none store widgets,
  artifacts, Preview, or function history.
- Preview is ephemeral; only the draft `widgetKey` and frame data persist.
- Functions are direct and history-free.
- There is no tenant, organization, account, or membership scope anywhere.
