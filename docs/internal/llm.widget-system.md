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
   `capsule.artifact`, optional `server-dist/` and `functions.json`). Build and
   Publish also retains the build's immutable source artifact at the reserved,
   release-attested `dist/.omnidraw-authoring-source.artifact` path. Runtime
   loading never returns that artifact; only the widget authority may decode it
   to create a new draft after an explicit edit/load request.
3. **Catalog** is a bounded, immutable in-memory scan generation of the
   widget root. Readers pin one generation; writers refresh it after each
   checked mutation. Generation numbers are process-local and may decrease
   after restart.
4. **Accepted build generation** is the only draft output Preview or Publish
   may consume. A portable repository-local build writes `dist/` and
   `dist/omnidraw.build.json` atomically; the host independently validates the
   current source, manifest, output metadata, compatibility, and Capsule before
   accepting it. Raw edits leave the last working Preview unchanged.
5. **Preview** is a full-stack accepted generation owned by the current
   process. Nothing about the session is durable; a stopped canvas Preview
   frame shows **Preview stopped — build again.**
6. **Widget instance** is a canvas frame whose extension stores only
   `widgetKey` and a stable `instanceId`. It always follows the current healthy
   publication. Concrete resource references live only in that publication's
   `omnidraw.json`, never on the canvas item.
7. **Server function** is a declared, descriptor-driven export of a published
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
  `resources`) is the only manifest form the Capsule builder consumes. Concrete
  `resourceId` values are removed from this projection while the logical
  slot/kind/effect/operation contract remains. Its
  canonical JSON digest keys every build and reuse decision together with the
  executable-input digest (manifest + source files + build environment).
- **`release.json`** is minimal: exact file list with byte sizes and SHA-256,
  the signed Capsule identity and runtime descriptor, optional server entry
  with `runtimeAbi` and the functions digest, the executable-manifest digest,
  and the host release attestation. It is validated exactly before a folder
  counts as published.
- The reserved authoring-source artifact is covered by that same exact file
  list and release attestation. It is not a browser distribution input, is
  never writable, and is decoded only into an absent draft by a
  catalog-digest-fenced widget-domain operation. Metadata publication supplies
  the current exact published manifest when that draft is materialized.
- Exactly one manifest version exists: v1. There is no legacy reader, no
  migration, no revision ID, no pinning, and no rollback.

## Publication actions

| Action | Effect |
| --- | --- |
| Save draft Config | Digest-fenced write of presentation/manifest fields into the draft. |
| Publish metadata | Atomically replaces only `omnidraw.json` in the published folder; executable bytes are byte-identical before and after. No install, construction, Capsule generation, or signing runs. |
| Rebuild | Runs the repository's same portable `npm run build`, then waits for independent host acceptance. It does not expose raw source edits. |
| Build & publish | Requires one current accepted generation, applies release signing and exact release validation, and atomically replaces the publication. A resource-ID-only change may reuse byte-identical executable output, but still needs a fresh receipt and explicit publication. Existing canvas instances keep geometry and instance state and resolve the new published manifest on their next call. |

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
4. Resource bindings live only in the exact current draft or published
   manifest. Runtime and function reads re-resolve the manifest declaration,
   resource lifecycle, kind, effect, operation, and policy. Placement and
   canvas items accept no binding payload and never open a resource picker.

## Preview

Preview is full-stack but process-owned. The current process keeps accepted
build state, temporary Capsule bytes, live diagnostics, manifest-owned
resource references, signing work, and mounted handles; nothing survives
restart.

- The sidebar renders each catalog entry as one published row (**Add**:
  places the current publication) and, only while the draft differs from the
  publication, one draft row (**Preview**: places an ephemeral Preview frame).
- Scaffold creation runs the portable build automatically. Later source or
  manifest edits mark the draft dirty but do not replace the displayed
  Preview until another portable build receipt is accepted.
- Filesystem events are a latency hint; bounded polling of active drafts is the
  correctness fallback. Candidate receipts are deduplicated and re-read around
  validation so partial, replaced, stale, or forged output never becomes a
  generation.
- `widget.preview.open` requires the current accepted generation, validates its
  exact manifest-owned resource references, signs the independently
  constructed host Capsule with the Preview key, and returns mount inputs and
  diagnostics. It accepts no browser-selected resources.
- `widget.preview.load` returns the live session for one canvas frame or
  fails `NOT_FOUND`.
- `widget.preview.close` disposes the session; `widget.preview.invoke`
  executes a declared server function against the session's exact server
  artifact and accepted manifest references.
- The canvas Preview frame persists only the draft `widgetKey` and normal
  frame data (`widget-preview` extension). Deleting the frame closes the
  session. One Preview frame per draft is kept per canvas: placing the same
  draft again focuses the existing frame.
- Manual **Rebuild** and AI build use the same portable command. A failed build
  leaves the previous accepted Preview running. Publish rejects dirty,
  building, failed, stale, or superseded generations.

## Direct server functions

One call resolves the current canvas item and the current published (or
Preview) manifest, obtains the resource only from its declared `resourceId`,
then rechecks publication identity, lifecycle, kind, effect, operation,
descriptor, input schema, policy, timeout, cancellation, disconnect, and
concurrency. It executes in one disposable child process and returns one
terminal result. An ID is not a capability, and missing/stale references fail
closed without display-name or first-compatible fallback.

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
originating chat.

New chats start with an empty `workspace/widgets/` directory. `ensureChat`
preserves valid mounts already owned by that chat and may remove stale owned
links, but it never scans the shared draft catalog to add mounts. Discovery via
`od_widget_list` projects one bounded application-catalog snapshot and inspects
the existing mount set without writes. `od_widget_load({ name })`, widget
creation, and a verified human widget selection are the only paths that add an
editable mount. Loading one existing draft is idempotent; loading a healthy
published-only widget first asks the widget authority to atomically materialize
its exact release-attested source, then mounts that draft. An unhealthy draft
blocks implicit replacement from a publication.

The chat connection carries its real canvas identity. Submitted widget refs are
re-resolved against one server-side catalog snapshot; healthy drafts are
mounted read/write, published folders remain immutable, and one explicit active
editable target is injected through Pi's `before_agent_start` context hook.
Browser labels and stale health are never trusted.

Canvas projection may render a newly inserted AI Chat optimistically, but its
portal defers mounting and connecting until `CanvasDocumentService` exposes the
exact accepted item. A rejected, removed, or replaced optimistic node stops the
wait. The server still revalidates the durable canvas/item pair independently;
the browser readiness gate is only lifecycle coordination, never authority.

The scaffold scripts are `omnidraw-widget check .` and
`omnidraw-widget build .` from the public SDK. Check is bounded and read-only;
it validates only repository syntax/contracts and explicitly reports that
resource existence and Preview runtime were not checked. The host-owned build
uses the fixed SDK build script in a private scratch checkout with a sanitized
environment and atomically emits the receipt the host observes. Dependency
lock generation accepts exact registry versions only and disables lifecycle
scripts. Resource tools may return one exact safe `resourceId`; the agent
writes it into the target manifest and then checks and builds. There is no
binding-intent record or picker.

AI Chat exposes no general shell or generic URL fetch. Its structured file
tools enter only through validated explicit draft mounts, and
`od_widget_validate` owns the bounded check/build workflow. Consequently the
model receives no host filesystem, environment credential, executable lookup,
local network, publication root, or publication API capability. Direct
frontend Publish and Republish calls remain the only publication entrypoints.
The standalone Bash process adapter may remain covered for non-agent uses, but
it is absent from the fixed AI Chat tool registry and live composition.

`od_widget_preview_inspect` has two truthful modes. `artifact` mounts exact
accepted bytes in isolation and reports `resources: not_available`,
`bindings: unavailable`, and no visible-frame claim. `preview` resolves the
exact active chat/canvas/widget target and accepted generation, then reuses the
real manifest-owned function bridge in a process-owned diagnostic clone. The
clone does not mutate canvas layout and never claims to be the visible frame.
An absent or failed visible frame can still be inspected; the result reports
`previewState: absent|failed`, `executionTarget: diagnostic_clone`, and the safe
next action. Mounting, retired, ambiguous, and generation-mismatched states stay
distinct and fail before diagnostic execution. A failed shell mount retains
only a validator-accepted, bounded runtime-event snapshot, with raw paths,
secrets, resource IDs, and provider details still redacted. `od_widget_validate`
reports `acceptedArtifactBuild` plus `livePreviewRuntime: not_exercised`; build
acceptance is never runtime or resource evidence.
Structured build, resource, function, output, or guest failures block success;
bounded UI evidence can report functional behavior only when it was actually
observed. Every draft change invalidates the catalog without making raw source
presentable. Durable chat metadata lives in the `chats` table; transcripts stay
files.

## Ownership map

| Owner | Role |
| --- | --- |
| `packages/sdk` | Portable manifest and artifact contracts, guest ABI, widget state/resource/function contracts, authoring entrypoints, and the browser host bridge that encapsulates Capsule. |
| `packages/canvas-contract` | Serialized Canvas documents, widget-frame extension data, commands, queries, snapshots, events, versions, and canonical codecs. |
| `packages/canvas` | Canvas rendering, optimistic browser document state, and the injected widget-extension host seam. |
| `packages/component-ai-chat` | Reusable AI Chat UI, its injected transport-neutral port, and its narrow Canvas extension. |
| `packages/theme` | Public theme values, namespaced CSS, tokens, and caller-scoped theme application helpers. |
| `apps/backend` | Filesystem workspaces and catalog, build and publication, ephemeral Preview authority, trusted local function execution, resources, widget-instance state, signing, persistence, and private RPC handlers. |
| `apps/frontend` | Product navigation and sidebar, widget placement, SDK browser-host composition, Preview and inspection UI, AI Chat adapters, and the multiplexed browser RPC client. |

## Invariants

- The filesystem is the only widget catalog and release authority.
- The database has exactly 14 application tables; none store widgets,
  artifacts, Preview, or function history.
- Preview is ephemeral; only the draft `widgetKey` and frame data persist.
- Only accepted portable build generations reach Preview or publication.
- `omnidraw.json` is the only widget-to-resource authority; canvas items carry
  no resource binding map and placement never asks the user to choose one.
- Functions are direct and history-free.
- There is no tenant, organization, account, or membership scope anywhere.
