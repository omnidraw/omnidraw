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
8. **Canonical server module** is the SDK-owned, host-neutral ES module and
   fixed Omnidraw ABI emitted once for a server-bearing build. OSS and managed
   accept the same module bytes; host wrappers, IPC, deployment metadata, and
   provider bindings are not part of its artifact digest.

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
  with the SDK-derived fixed ABI marker, exact canonical server-module digest,
  and functions digest, the executable-manifest digest, and the host release
  attestation. Authors do not select a runtime ABI. The release is validated
  exactly before a folder counts as published.
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
| Save published icon | Published-manifest- and catalog-fenced replacement of only `tool.icon` in the current published `omnidraw.json`. The private mutation requires exactly one Lucide or custom variant and rejects custom SVG resource, navigation, animation, and style surfaces. It creates or changes no draft and runs no build or signing work. |
| Publish metadata | Atomically replaces only `omnidraw.json` in the published folder from a matching draft; executable bytes are byte-identical before and after. No install, construction, Capsule generation, or signing runs. |
| Rebuild | Runs the repository's same portable `npm run build`, then waits for independent host acceptance. It does not expose raw source edits. |
| Build & publish | Requires one current accepted generation, applies release signing and exact release validation, and atomically replaces the publication. A resource-ID-only change may reuse byte-identical executable output, but still needs a fresh receipt and explicit publication. Existing canvas instances keep geometry and stable identity and resolve the new published manifest on their next call. |

## Runtime loading

Custom widget SVG icons are rendered in the trusted host only through a static
geometry allowlist; URI-bearing elements and attributes, style/CSS, animation,
and navigation surfaces are removed even for manifests authored outside the
published-icon mutation. Custom emoji icons are inserted as text, not HTML.

The browser mounts widgets through the filesystem catalog:

1. `widget.runtime.load` pins the canvas item identity (`canvasId`,
   `elementId`, `widgetInstanceId`, `widgetKey`), resolves the current
   catalog generation, reads the exact signed Capsule bytes listed in
   `release.json`, and revalidates the server-function descriptor digest and
   the signed capability request before returning mount inputs.
2. A missing or unhealthy publication produces a missing-widget frame. No
   durable canvas row is deleted.
3. Resource bindings live only in the exact current draft or published
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
- Shared drafts retain exact source and `package-lock.json`, never a persistent
  dependency tree. Creation, validation, manual **Rebuild**, and **Build &
  Publish** all capture that same input and join the host-owned private build
  boundary. It performs the exact-lock install under the configured registry
  policy, then atomically projects only a complete `dist/` plus receipt into
  the generation observer. Cancellation, source drift, or failure cleans the
  private work and cannot replace the last accepted generation.
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
- When a frame has no accepted generation, the content host remains mounted
  without executing guest code and shows the backend generation's bounded
  **Build required**, **Building**, or **Build failed** state with **Rebuild**
  and **Remove** controls. A toast may supplement this state but never replaces
  it or leaves an unexplained blank frame.

## Direct server functions

The server artifact is an Omnidraw module, not Bun source, a Cloudflare Worker,
or a complete deployable Fetch script. Widget authors use
`@omnidraw/sdk/server`; they do not receive Cloudflare `env`, define a Fetch
handler, write Wrangler configuration, select an execution runtime, or maintain
separate OSS and managed source. The OSS accepted-build boundary and private
managed accepted-build boundary admit the same portable language. A construct
that works only because OSS uses Bun is rejected.

OSS loads the exact canonical module bytes in one disposable Bun child on the
local host. This is explicitly trusted local execution. The child, blank guest
global, denied capabilities, and process cleanup are defense in depth, not a
hostile-code sandbox guarantee. Capsule remains exclusively the browser UI
sandbox and never executes server functions.

The private managed adapter may generate a small module/Fetch wrapper around
the exact canonical bytes. That wrapper has a distinct deployment digest and
must neither rewrite nor rebuild the canonical module or change the widget
artifact digest. The wrapper is an untrusted-realm trampoline, not a security
boundary: it holds no Turso credential, tenant secret, write-permit authority,
or provider handle. A separately trusted broker owns those values and is
reached only through a host-provided service binding. The adapter runs widget
code only as a Workers for Platforms user Worker—never in Cloudflare Sandbox,
a Container, a Durable Object, or the managed chat/build sandbox. The private
adapter owns dispatch namespaces,
uploads, outbound-worker policy, Cloudflare bindings, resource brokerage,
Turso credentials, tenant/authentication policy, metering, billing, plan
enforcement, and usage evidence.

OSS owns no Cloudflare executor, remote Turso fallback, per-user/monthly quota,
billing-plan limit, managed workload bound, or sandbox-minute allowance. OSS
conformance qualifies only the portable contract and local adapter. Before an
exact public package set is accepted, the private managed repository must use
the SDK version pinned by `public-package-set.json`, deploy through a real WFP
dispatch namespace, run the same conformance against Turso, verify the wrapper
references the exact canonical module digest, and prove widget code has no
outbound or host-OS authority.

The portable invocation contract does not expose catalog generations or an
evaluation-lifetime guarantee. Hosts may evaluate the module once or reuse an
isolate, so module-scope mutation, caches, locks, and intrinsic modification
must not affect a function result. A function is portable only as a function
of its input, the frozen invocation context, and declared resource results.
The context cancellation surface is exactly `aborted`, `reason`,
`throwIfAborted`, and abort-listener add/remove; prototype identity,
`onabort`, and native `DOMException` identity are not ABI.

Every descriptor uses the single `small` memory class with a 128 MiB portable
ceiling. Canonical server bytes are at most 8 MiB. The managed acceptance gate
must additionally prove the complete wrapper upload stays within its compressed
platform limit and that global-scope parsing/evaluation stays within the Worker
startup limit. `timeoutMs` is a wall-clock contract: the wrapper aborts awaited
work, while the caller maps an uncatchable platform CPU/memory termination to
the same bounded terminal failure class.

Managed user Workers run the wrapper and canonical module in one realm where
Worker globals physically exist. Shared admission rejects direct, computed,
and unresolved `globalThis` access outside the ECMAScript allowlist, but static
admission is not the egress boundary. The private live gate must configure an
outbound Worker to deny public network access and prove denial with an actual
exfiltration attempt. The user Worker receives no direct Turso binding. KV,
secret-store, and database resource semantics are brokered by strongly
consistent storage; Cloudflare KV is not a valid implementation of revisioned
CAS. Database batches use one provider-owned sticky transaction/pipeline and
CAS-participating reads cannot use a stale replica.

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

## Portable resource capability matrix

The manifest is the complete widget-facing resource authority. A server
function may use only the slots and effects in its accepted descriptor, and
those effects must stay within the matching manifest requirement. An `fn`
function declares no resources, an `fx` function may declare read access only,
and a `tx` function may declare read, write, or read/write access. The host
rechecks this chain on every call; a resource ID alone grants nothing.

| Resource | Read operations | Write operations | Portable observable behavior |
| --- | --- | --- | --- |
| KV | `get`, `has`, `list` | `set`, `delete`, `compareAndSet` | Bounded JSON values, positive revisions, prefix/cursor pagination, and explicit compare-and-set success or conflict. |
| Secret store | `get`, `has`, `list` | `set`, `delete`, `compareAndSet` | `get` is the explicit widget capability that returns plaintext plus revision. `list` returns only name and revision; it never returns plaintext, provider timestamps, or storage metadata. Writes use positive revisions and explicit compare-and-set success or conflict. |
| Database | Declared read `invoke`; `query` only when arbitrary SQL is enabled | Declared write `invoke`; `execute` and bounded execute batches only when arbitrary SQL is enabled | Named operations use their declared parameter types, effect, SQL, result kind, and optional JSON result-column declarations. Declared JSON columns decode bounded SQL text as tagged JSON; arbitrary SQLite query results remain text unless declared by a named operation. Rows preserve ordered and duplicate columns plus tagged cell values. Execute results contain normalized affected-row counts and optional decimal-string insert IDs. The adapter, not widget SQL, owns a batch transaction. |

All calls use one SDK-owned bounded request/result/failure wire contract. The
request contains only correlation, logical slot, operation, requested effect,
and encoded input. It never carries a concrete resource ID, provider handle,
credentials, environment, tenant, user, or host binding. Portable values are
canonical tagged null, boolean, finite number, string, bigint, bytes, arrays,
and sorted-key objects; database rows additionally retain column order and
cell types. Malformed input/output, unknown operations, denied effects,
provider failures, and limits are bounded failure codes rather than leaked
provider errors. A write with an unclear outcome consumes its single-use
permit and is never retried automatically.

Widget-authored database SQL is one bounded, classified statement. Transaction
control, `ATTACH`/`DETACH`, `PRAGMA`, `VACUUM`, trigger creation, extension
loading, host-file functions, temporary objects, and writes to SQLite, libSQL,
Turso, or Omnidraw internal namespaces are forbidden. An unclassified
statement and any declared-effect mismatch fail closed. Local maintenance SQL
and human resource-management APIs are outside this widget data-plane profile.

Admission rejects direct dynamic-code authority and statically resolvable
constructor aliases. The OSS guest additionally disables string and Wasm code
generation in its VM, and the managed Worker profile must apply the equivalent
runtime restriction, so indirect constructor reconstruction cannot execute.

OSS preserves its complete local product surface: embedded database files and
WAL handling, encrypted secrets, catalog/data editing, drafts, apply and
backup/restore flows, recovery, redacted listing, and explicit human secret
reveal. A private managed Turso/resource adapter may use different private
storage schemas and management APIs, but the same conformance scenarios must
produce the same widget-visible transcript and failure classes. Neither side
may project provider time, identity, credentials, or billing state into the
portable result.

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

AI Chat exposes host-authority Bash but no generic URL fetch. Bash starts in
the chat workspace and is intentionally not a confinement boundary: it retains
the host process's filesystem, environment, executable lookup, subprocess, and
network authority. This is an explicit OSS trusted-host product decision, not
a security boundary. Structured file tools still enter only through validated
explicit draft mounts, `od_widget_validate` owns the bounded accepted-artifact
workflow, and direct frontend Publish and Republish remain the supported
publication actions.

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

## Headless authoring verification

The source-run `omnidraw widget` CLI is the supported trusted-local boundary
for repairing an existing draft without AI Chat or Canvas UI interaction. It
connects to the already-running backend through the same private Effect RPC;
it never opens the database or constructs another catalog, build authority,
Preview service, browser runner, or backend runtime.

The autonomous loop is deliberately two-step and generation-fenced:

```text
omnidraw widget list / resolve exact draft
  -> edit the returned draft path
  -> omnidraw-widget check .                  # useful offline evidence only
  -> omnidraw widget validate                 # host-accepted generation
  -> omnidraw widget inspect --mode artifact  # isolated accepted bytes
  -> omnidraw widget inspect --mode preview   # manifest-bound runtime policy
  -> consume bounded diagnostics / optional verified PNG
  -> repair and repeat
```

`validate` and AI Chat validation share the same host orchestration and report
source validation separately from artifact acceptance. `inspect` never builds:
the caller must carry the exact draft digest, accepted generation, and build
identity from validation. Preview mode can run a diagnostic clone without any
Canvas. An optional `--canvas` selector correlates one existing unique Preview;
it never creates, opens, moves, or removes a frame. Without that selector,
visible-frame evidence is not claimed.

Artifact inspection is not resource evidence. A diagnostic clone is not the
visible Canvas frame, and its PNG is evidence rather than the success
criterion. Manifest-bound reads retain normal Preview policy; protected or
unclear writes fail closed because the CLI has no approval coordinator. OSS
widget builds and server functions execute as trusted local host code, not in
a sandbox.

Screenshot metadata remains on RPC while bytes use a short-lived, random,
single-use loopback lease bound to the originating inspection operation. The
CLI presents that operation identity in a private request header, consumes the
lease immediately, revalidates PNG MIME, dimensions, size, and SHA-256, and
writes through a sibling temporary file without replacing an existing
destination unless `--overwrite` was explicit. Missing or cross-operation
credentials receive the same 404 as an unknown lease and do not consume it.
Lease URLs are never printed.

## Ownership map

| Owner | Role |
| --- | --- |
| `packages/sdk` | Portable manifest and artifact contracts, guest ABI, mount-local state/resource/function contracts, authoring entrypoints, and the browser host bridge that encapsulates Capsule. |
| `packages/canvas-contract` | Serialized Canvas documents, widget-frame extension data, commands, queries, snapshots, events, versions, and canonical codecs. |
| `packages/canvas` | Canvas rendering, optimistic browser document state, and the injected widget-extension host seam. |
| `packages/component-ai-chat` | Reusable AI Chat UI, its injected transport-neutral port, and its narrow Canvas extension. |
| `packages/theme` | Public theme values, namespaced CSS, tokens, and caller-scoped theme application helpers. |
| `apps/backend` | Filesystem workspaces and catalog, build and publication, ephemeral Preview authority, trusted local function execution, resources, signing, persistence, and private RPC handlers. |
| `apps/frontend` | Product navigation and sidebar, widget placement, SDK browser-host composition, Preview and inspection UI, AI Chat adapters, and the multiplexed browser RPC client. |
| Private managed repository | Exact-bytes WFP wrapper generation and upload, dispatch namespaces, outbound-worker policy, Cloudflare bindings, resource broker and Turso adapter, credentials, authentication, tenancy, metering, billing, plan enforcement, usage evidence, and real managed qualification. |

## Invariants

- The filesystem is the only widget catalog and release authority.
- The database has exactly 13 application tables; none store widgets,
  artifacts, Preview, or function history.
- Preview is ephemeral; only the draft `widgetKey` and frame data persist.
- Widget local-store values belong to one Capsule mount and never become shared
  or durable widget-instance state.
- Only accepted portable build generations reach Preview or publication.
- OSS and managed accept the same SDK-owned canonical server-module language;
  adapter wrappers and transports never change its bytes or artifact digest.
- Managed widget functions execute only as WFP user Workers; Capsule executes
  browser UI only, and OSS execution remains trusted local host code.
- `omnidraw.json` is the only widget-to-resource authority; canvas items carry
  no resource binding map and placement never asks the user to choose one.
- Functions are direct and history-free.
- There is no tenant, organization, account, or membership scope anywhere.
