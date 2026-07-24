# Capsule as the Vibecanvas widget sandbox

Status: reevaluated 2026-07-24  
Capsule revision: `e80a2601fc8a51a0b3da14317cd6b2977f686e24`  
Package: `@capsule/capsule@0.9.0`, installed by local file path

## Verdict

**GO for the Vibecanvas migration.**

The concrete Capsule library gaps found in the first review are fixed:

- schema creation is public;
- artifact signing is public;
- the host and testkit share one attachment identity;
- bounded SVG DOM and Canvas 2D profiles exist;
- static SVG and font resources exist;
- production loading uses the release QuickJS build only.

No Capsule library blocker was found in the requested scope. The remaining work
is mainly in Vibecanvas: replace its Arrow artifact, SDK, capability, and mount
contracts.

| Decision | Result | Reason |
| --- | --- | --- |
| Continue the integration | **GO** | The public package supports the required build, signing, mount, capability, rendering, lifecycle, and cleanup flow. |
| Replace Arrow in the browser widget path | **GO** | Capsule can host DOM, SVG, Canvas 2D, WebGL, and WebGPU guests behind explicit profiles. |
| Add server functions and collaborative state | **GO with Vibecanvas adapter work** | Capsule now exposes schemas, descriptors, bindings, grants, calls, streams, and channels. |
| Allow guest-selected UI libraries | **GO with limits** | A library works when its built module graph only uses Capsule-supported JavaScript and browser APIs. Capsule is not a full browser. |

Per request, this reevaluation does not use unproven scale, security review, or
branded-browser acceptance as blockers.

## What changed since the first review

### Public schema support

`@capsule/capsule/schema` now exports `createCapsuleSchemaResource`.

This fixes the old problem where Vibecanvas could describe a capability but
could not create the schema objects required by the public host API.

The compatibility probe now creates and registers a schema, uses its reference
in a capability descriptor, and unregisters it during cleanup.

### Public artifact signer

`@capsule/capsule/sign` now exports `signCapsuleArtifactBytes`.

This fixes the old problem where the host could check signatures but a normal
consumer had no supported way to create one. The signer is tooling-only, which
is the right boundary: Vibecanvas should sign during publishing, not in the
browser.

The probe generates an Ed25519 key, signs the built artifact, configures a
required-key host policy, and mounts the signed bytes.

### Repaired testkit identity

The root host entry and `@capsule/capsule/testkit` now import the same emitted
identity token. A testkit attachment made by one entry is accepted by the
other.

The probe attaches the public testkit and locates a button inside Capsule's
closed widget root. This was rejected in the first review.

### SVG and Canvas 2D

Capsule now has:

- `svg-dom-v1` for bounded live SVG DOM;
- `canvas-2d-v1` for bounded Canvas 2D;
- `artifact-resources-v2` for sanitized static SVG and WOFF;
- `artifact-resources-v3` for additional bounded media forms.

“Missing general SVG and Canvas 2D profiles” previously meant that common
charts, diagrams, icons, drawing tools, and 2D games could not use their normal
rendering APIs. That gap is now closed with limited, budgeted profiles. It does
not mean every browser SVG or Canvas feature is allowed.

The probe renders one live SVG shape and one Canvas 2D shape. Diagnostics show
one Canvas 2D context and four Canvas operations.

### Runtime loading and population policy

The production graph now loads the release QuickJS build only. The local Vite
build no longer emits both release and debug QuickJS variants.

Capsule also documents a conservative virtualization policy:

- up to 16 active and 8 throttled live instances;
- lower limits for mixed-heavy and GPU widgets;
- freeze after about 2 seconds offscreen;
- destroy distant instances after about 30 seconds;
- park up to 64 suitable instances;
- keep larger populations as inert records and queued candidates.

Vibecanvas should feed viewport distance, visibility, priority, and occlusion
into this policy. These numbers are policy defaults, not a promise that every
widget workload has the same cost.

## Compatibility test

The executable probe is in `apps/capsule-compatibility`.

It uses:

```json
"@capsule/capsule": "file:/Users/omarezzat/Workspace/vibecanvas/capsule"
```

The fixture is built from source with Capsule's supported build API. It does
not import Capsule internals.

### Covered flow

1. Build a deterministic two-module guest artifact.
2. Declare DOM, SVG, Canvas 2D, and one app capability.
3. Create and register a public schema.
4. Register the capability descriptor and provider binding.
5. Sign artifact bytes with the public Ed25519 signer.
6. Require that signature in host policy.
7. Mount through the public browser host.
8. Render DOM, SVG, and Canvas 2D.
9. Attach the public testkit and locate a closed-root button.
10. Send viewport data.
11. Freeze, resume, and destroy.
12. Check terminal counters and release registrations.

### Results

| Check | Result |
| --- | --- |
| Deterministic build and hash | Pass |
| Artifact validation | Pass |
| Required signature | Pass |
| Public schema creation and registration | Pass |
| Capability descriptor, grant, and provider binding | Pass |
| DOM mount | Pass |
| Live SVG rendering | Pass |
| Canvas 2D rendering | Pass |
| Public closed-root testkit attachment and lookup | Pass |
| Viewport update | Pass |
| Freeze and resume | Pass |
| Destroy and terminal cleanup | Pass |
| Production Vite build | Pass |

Test artifact hash:

```text
sha256:0922b28b26242ffa849a3c546d2b90e0fc772db8b3d44f29f9623151d620c399
```

The browser run used `quickjs-release-sync-v1`, `dom-core-v2`,
`svg-dom-v1`, and `canvas-2d-v1`.

The guest capability is registered and granted in the live probe. The local
browser driver did not produce a reliable trusted click through the closed
root, so this report does not claim that click as a new semantic assertion.
The public binding, authority, and test target were present and the unit tests
cover the exact request envelope.

### Commands

```bash
bun --filter @vibecanvas/capsule-compatibility test
bunx tsc -p apps/capsule-compatibility/tsconfig.json --noEmit
bun --filter @vibecanvas/capsule-compatibility build
```

## Compatibility matrix

### Artifact and package

| Need | Capsule now | Vibecanvas action |
| --- | --- | --- |
| Source build | Supported builder | Replace `buildBrowserModule`. |
| Deterministic bytes and hash | Supported | Store Capsule bytes and Capsule hash. |
| Validation | Supported | Validate at publish and load. |
| Signing | Public tooling signer | Sign in the trusted publish worker. |
| Verification | Host policy | Pin trusted public keys and signature rules. |
| Schema creation | Public schema entry | Build schemas from widget contracts. |
| External file install | Verified locally | Keep the file path only for this worktree PoC. |

### Guest code and UI libraries

| Need | Status | Note |
| --- | --- | --- |
| ES modules | Supported | Closed, normalized module graph. |
| Async guest code | Supported | Must obey VM and scheduler rules. |
| React/Vue-style libraries | Possible | Pin and test each supported graph. |
| Arbitrary npm package | Not promised | Packages using unsupported browser or Node APIs need changes. |
| Dynamic runtime imports | Restricted | Include dependencies in the built graph. |
| Node built-ins | Not a browser guest feature | Replace with guest-safe code or host capabilities. |

“Bring your own UI library” should mean:

> Authors may choose a library that can be compiled into the supported Capsule
> module graph and only uses the enabled Capsule profiles and capabilities.

### Rendering and browser features

| Surface | Status |
| --- | --- |
| Core DOM and events | Supported |
| CSS and layout | Supported bounded subset |
| Live SVG DOM | Supported by `svg-dom-v1` |
| Canvas 2D | Supported by `canvas-2d-v1` |
| Static PNG/CSS | Supported |
| Sanitized static SVG and WOFF | Supported by resource v2 |
| Bounded audio/video forms | Supported by resource v3 and media profiles |
| WebGL2 | Supported profile |
| WebGPU | Supported profile |
| Network | Explicit capability/profile only |
| Clipboard, files, dialogs, media | Explicit profile and budget only |
| Full browser compatibility | Not the model |

### Vibecanvas application features

| Feature | Capsule mapping | Work still needed |
| --- | --- | --- |
| Widget props | Props channel | Define revision and schema rules. |
| Theme | Theme channel | Map `service-theme` updates. |
| Guest outputs | Output channel | Map to widget events. |
| Short server functions | Capability call | Create schemas and provider adapter. |
| Collaborative state | Capability calls/streams | Define Automerge-safe operations and cleanup. |
| Durable widget state | Capability provider | Keep authority in host services. |
| Resource access | Capability provider | Map `resource-runtime` contracts. |
| Focus | Handle method | Connect canvas selection/focus. |
| Visibility and distance | Viewport update | Connect canvas virtualization. |
| Suspend and wake | Freeze/resume | Define canvas state transitions. |
| Unmount | Destroy | Make cleanup idempotent. |

## Required Vibecanvas changes

### Replace the Arrow artifact

Do not wrap Capsule bytes in the old Arrow UI envelope. Store Capsule's
canonical artifact bytes as the executable source of truth.

The widget revision should record at least:

- artifact hash;
- Capsule format version;
- runtime ABI;
- DOM and feature profiles;
- resource profile;
- budgets;
- capability requests;
- signature and key metadata;
- builder version.

### Replace the builder

The publish pipeline should:

1. collect guest sources and pinned dependencies;
2. build a closed Capsule module graph;
3. create capability schemas and descriptors;
4. validate the artifact;
5. sign the exact bytes;
6. store immutable bytes plus metadata;
7. publish only after all checks pass.

### Rewrite the guest SDK

The current SDK assumes Arrow and Vibecanvas globals. Replace it with a small
Capsule guest SDK for:

- props and theme subscriptions;
- typed outputs;
- server-function calls;
- collaborative-state calls and streams;
- resource requests;
- lifecycle notifications where needed.

Guest code must not receive raw service objects, database handles, auth tokens,
or Automerge internals.

### Add host capability adapters

Create one narrow provider per public app capability. Each provider should:

- use a stable id, version, and contract hash;
- validate input and output through registered schemas;
- get tenant and widget identity from trusted mount context;
- apply time, byte, and call limits;
- cancel work and release streams on freeze or destroy.

### Make mounting asynchronous

The canvas mount port should return a handle and support:

- `ready`;
- props and theme updates;
- viewport updates;
- focus;
- freeze;
- resume;
- diagnostics;
- idempotent destroy.

Do not hide Capsule lifecycle work inside a synchronous DOM helper.

## Suggested migration order

1. **Artifact contract:** add a new Capsule-based widget manifest and revision.
2. **Builder:** build, validate, sign, and store Capsule bytes.
3. **DOM path:** mount simple dependency-free guests beside Arrow in development.
4. **SDK and channels:** move props, theme, and outputs.
5. **Capabilities:** add server functions, collaborative state, and resources.
6. **Rendering profiles:** test the actual UI libraries Vibecanvas wants to support.
7. **Canvas lifecycle:** connect viewport, freeze, resume, park, and destroy.
8. **Cutover:** regenerate pre-release widgets, remove Arrow contracts, then delete Arrow.

There is no need for a legacy compatibility layer because Vibecanvas has not
deployed this widget format.

## Remaining limitations

These are product rules or integration work, not current Capsule library
blockers:

- Capsule supports named, bounded browser profiles, not every browser API.
- A UI library may need a build preset or small adapter.
- Canvas 2D consumes the shared asset-byte budget for its backing store.
- GPU widgets need much lower live-instance limits than small DOM widgets.
- Snapshot parking only helps guests that implement the required state hooks.
- Vibecanvas still needs real capability providers and contract definitions.

Out of scope by request:

- independent security review;
- proof of Vibecanvas population scale;
- branded-browser and hardware acceptance.

## Final recommendation

Adopt Capsule as the new widget sandbox and start with the artifact/builder
contract. The updated library has removed the concrete blockers found in the
first review. Keep the guest promise precise: authors can choose their UI
library when it fits Capsule's supported build graph and granted profiles.
