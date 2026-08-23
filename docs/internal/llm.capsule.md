# Using the Capsule library — 0.16.0

This is the consumer manual for `@omnidraw/capsule`. Capsule 0.16.0 uses
public browser API groups; runtime ABI, DOM profiles, feature profiles, and
feature grants remain private enforcement details.

## Install

Capsule is one ESM package:

```sh
bun add @omnidraw/capsule
```

The tested package manager is Bun 1.4.0. Browser applications should use a
modern ESM-aware bundler. The `build` and `sign` entries are trusted
Bun/Node tooling and must stay out of browser bundles.

The public package uses the custom Digital Reset Software License. Use,
commercial use, integration, and redistribution of complete unmodified copies
are permitted; modified versions and independently maintained forks are not.
Purely mechanical installation, bundling, minification, transpilation,
compression, linking, and packaging remain permitted when they do not change
Capsule's functionality, interfaces, security behavior, or licensing. Read the
root `LICENSE` before use or redistribution.

The npm archive contains the exact root `LICENSE`, a minimal end-user README,
this complete guide, declarations, and only minified JavaScript under `dist/`.
It contains no other documentation, source maps, TypeScript/source workspace
paths, or private workspace packages. The producer's exact-tarball verifier
enforces those facts before publication.

## Quick start: build, host, mount

An application-owned build worker first produces a closed ES2022
distribution. Capsule validates that output and binds an exact group contract
into the artifact's content-hash and signature domain:

```ts
import { buildCapsuleGuest } from '@omnidraw/capsule/build';

const built = await buildCapsuleGuest({
  input: {
    kind: 'external-distribution',
    snapshot: {
      files: [{ path: 'main.js', bytes: compiledMainBytes }],
    },
    entry: 'main.js',
    producer: {
      name: 'application-build-worker',
      version: '2026.07.29',
      digest: producerDigest,
    },
    sourceRevision: sourceRevision,
    dependencyLockDigest: dependencyLockDigest,
    buildConfigurationDigest: buildConfigurationDigest,
  },
  apis: ['DOM'],
  parkability: { parkable: false },
  policy: {
    maxFiles: 128,
    maxFileBytes: 2 * 1024 * 1024,
    maxTotalBytes: 8 * 1024 * 1024,
    maxPathBytes: 256,
    maxPathDepth: 16,
    maxModules: 128,
    maxOutputBytes: 8 * 1024 * 1024,
  },
});
```

The browser host declares an independent group ceiling:

```ts
import {
  createCapsuleHost,
  createDefaultCapsuleBrowserPlatform,
} from '@omnidraw/capsule';

const host = await createCapsuleHost({
  allowedApis: ['DOM'],
  browserPlatform: createDefaultCapsuleBrowserPlatform({ document }),
});
```

The common mount does not repeat groups, feature grants, empty capability
arrays, or complete budgets:

```ts
const container = document.querySelector<HTMLElement>('#capsule-surface');
if (container === null) throw new Error('Capsule container is missing.');

const handle = await host.mount({
  artifact: built.artifactBytes,
  container,
});
await handle.ready();
```

For production, sign the artifact in a trusted release step and configure the
host's signature policy as shown below.

Always release instances and shared hosts:

```ts
await handle.destroy('route-unmounted');
await host.destroy();
```

Both operations are idempotent.

## Supported imports

Use only these entries:

| Import | Environment | Purpose |
| --- | --- | --- |
| `@omnidraw/capsule` | Browser host | Create hosts, mount artifacts, control handles, cache artifacts |
| `@omnidraw/capsule/build` | Bun/Node tooling | Validate a closed external distribution and construct an artifact |
| `@omnidraw/capsule/guest` | Capsule guest source | Call application capabilities and use guest channels |
| `@omnidraw/capsule/protocol` | Browser or tooling | Group, network, capability, budget, and serializable contract types |
| `@omnidraw/capsule/schema` | Browser or tooling | Canonical application-schema resources |
| `@omnidraw/capsule/sign` | Bun/Node release tooling | Sign exact artifact bytes with explicit Ed25519 keys |
| `@omnidraw/capsule/testkit` | Browser tests | Root-confined closed-tree automation |
| `@omnidraw/capsule/authoring-inspection` | Trusted authoring browser host | Bounded closed-tree metadata for one dedicated inspection mount |
| `@omnidraw/capsule/webgl` | Trusted browser adapter | Fixed bounded WebGL integration |
| `@omnidraw/capsule/webgpu` | Trusted browser adapter | Fixed bounded WebGPU integration |

Every other package subpath is rejected. Never import private
`@omnidraw/capsule-*` workspace packages from an application.

The guest entry imports the reserved `capsule:bridge` intrinsic. Include it
only in guest code compiled by the application-owned toolchain.

## Authority model

The browser surface is the intersection of independent facts:

```text
signed artifact API request
  ∩ host allowed APIs and subordinate policy
  ∩ optional mount narrowing
  ∩ available browser platform primitives
  ∩ effective budgets
```

A group is a bounded browser API family, not ambient authority. Signature
trust, network destinations, browser-image sinks, resources, user activation,
application capabilities, channels, viewport policy, and parkability remain
separate named contracts.

Application capabilities have their own intersection:

```text
artifact capability request
  ∩ host capability policy
  ∩ mount grant
  ∩ live instance-bound provider binding
```

## The ten public groups

`capsule-api-groups-v1` has exactly these names:

| Group | Meaning |
| --- | --- |
| `DOM` | Bounded HTML DOM, events, forms, layout, observers, timers/frames, confined mutable Selection, CSS, coarse keyboard convention, and bounded live SVG |
| `NETWORK` | Bounded buffered fetch and explicitly authorized browser network-image sinks |
| `FILES` | User chooser, trusted external drop, immutable file snapshots, and PNG preview tokens |
| `CLIPBOARD` | Synchronous bounded plain-text copy, cut, and paste |
| `DIALOGS` | Activation-gated bounded synchronous `alert`; `confirm` and `prompt` remain denied |
| `CANVAS_2D` | Bounded write-oriented Canvas 2D |
| `WEBGL` | Bounded host-owned WebGL2 |
| `WEBGPU` | Bounded host-owned visible-canvas WebGPU |
| `AUDIO` | Signed static audio playback and bounded Web Audio synthesis |
| `VIDEO` | Signed bounded video playback |

`DOM` must be listed explicitly in every v1 artifact. All other groups depend
on it. `CANVAS_2D`, `WEBGL`, and `WEBGPU` are pairwise mutually exclusive.
Unknown names, aliases, duplicates, wrong case, missing dependencies, and
conflicts fail before artifact creation or guest execution.

Group arrays are defensively copied and normalized into canonical registry
order. Capsule does not scan JavaScript to infer them. A v1 group never
silently gains members or authority; a wider public contract needs a new
versioned identity.

## Signed group and resolved-target identity

A new artifact includes both:

```ts
{
  apiContract: {
    format: 'capsule-api-groups-v1',
    groups: ['DOM', 'NETWORK', 'WEBGL'],
    bundleDigest: 'sha256:…',
  },
  resolvedTarget: {
    runtimeAbi: '…',
    domProfile: '…',
    featureProfiles: ['…'],
  },
}
```

`apiContract` is the consumer's public intent and exact registry revision.
`resolvedTarget` is Capsule's private enforcement identity. The builder and
artifact verifier independently resolve the group contract and require
byte-for-byte agreement. Consumers inspect the resolved identity for audit
and compatibility evidence but never assemble it.

The contract bundle digest binds names, ordering, dependencies, conflicts,
private expansion, conditional resource rules, subordinate-policy
requirements, budgets, denials, ledgers, and evidence owners.

## Build a closed external distribution

Capsule accepts only `external-distribution`: exact application-built
`.js`/`.mjs` bytes plus provenance. Static exact relative imports and the
reserved `capsule:bridge` intrinsic are the only module edges.

Capsule preserves every application JavaScript module byte exactly. The
reserved bridge and declared resource imports resolve to signed generated
virtual modules instead of rewriting the importer. The artifact signs the
sorted application-owned module set eligible for generated runtime locations;
Capsule-generated bridge/resource modules are never eligible.

An external bundler may preserve a project-relative resource specifier such
as `../../../assets/tone.wav` even though its normalized output is
`main.js`. When that exact import has a declared resource binding, Capsule
maps it to a deterministic reserved adapter ID using the escaped-root count;
it does not traverse the filesystem or alter the application module.

The ingester rejects raw TypeScript, JSX, Vue source, source maps,
`sourceMappingURL`, HTML discovery, bare package imports, runtime `require`,
dynamic imports, `import.meta`, top-level await, workers, WebAssembly, native
modules, unresolved output, and loose unreachable files.

The signed provenance records the external producer, source revision,
dependency-lock digest, build-configuration digest, complete distribution
digest, and the `capsule-external-distribution-ingest@2.0.0` transform. That
transform binds byte-preserved application modules, generated bridge/resource
adapters, escaped-root resource mapping, and final graph validation. Its claim is
`deterministic-ingestion-only`: Capsule does not claim that it compiled,
reproduced, or OS-isolated the application build. The application owns
package installation, scripts, plugins, credentials, network, cancellation,
and worker cleanup.

`buildCapsuleGuest()` returns:

```ts
{
  artifactBytes: Uint8Array;
  artifactHash: `sha256:${string}`;
  diagnostics: readonly CapsuleBuildDiagnosticRecord[];
}
```

Loose executable bytes or side metadata are not a mount input. The browser
host independently decodes and verifies the canonical artifact inside each
mount transaction.

## Explicit resources, private formats

Resources are not API groups. Supply only explicit roots and bindings:

```ts
const built = await buildCapsuleGuest({
  input: {
    ...distributionInput,
    cssRoots: ['styles.css'],
    resourceBindings: [{
      module: 'main.js',
      specifier: './tone.wav',
      path: 'tone.wav',
    }],
  },
  apis: ['DOM', 'AUDIO'],
  parkability: { parkable: false },
  policy: buildValidationPolicy,
});
```

Capsule closes reachable relative CSS and resource edges and selects the
narrowest private format:

- CSS and PNG use the v1 resource format;
- sanitized SVG and validated WOFF require v2;
- an explicit WAVE or WebM binding requires v3 and respectively `AUDIO` or
  `VIDEO`.

An unbound `AUDIO` or `VIDEO` artifact still receives the complete stable
facade promised by its group; it simply has no signed media token to assign.
Selecting those groups does not infer resource v3. `FILES` PNG previews are
validated inbound file authority and do not require an artifact resource
graph.

Resource presence cannot change a selected group's promised members. Loose
files, resource-like JavaScript strings, network URLs, and HTML references do
not grant resource or API authority.

### CSS, images, fonts, and live SVG

List every source stylesheet in `cssRoots`. Capsule closes relative CSS
imports and PNG/SVG/WOFF edges, scopes the result to the owned closed root,
and signs the resource graph. Initial `html`, `body`, and `:root` selectors
map to the managed guest root. Do not target Capsule's internal host.

The DOM group includes the reviewed native/dynamic CSS surface. Custom
properties, fallbacks, math, gradients, modern typography/layout, animations,
media/container/supports rules, and ordinary scoped selectors are available
within the pinned grammar. Host/projection/document-global facilities such as
`:host`, `::slotted`, `::part`, `@property`, view transitions, `paint()`,
nesting, and runtime `@import` remain denied.

Distribution-relative PNG/SVG resources are the contained image path. A
sanitized SVG excludes scripts, handlers, links, entities, external URLs,
animation, filters, masks, and `foreignObject`.

Declare a WOFF 1 font only through source CSS:

```css
@font-face {
  font-family: "Widget";
  src: url("./widget.woff") format("woff");
  font-weight: 400;
  font-style: normal;
}
```

Capsule rewrites the URL and family identity, loads the face before guest
evaluation, and exposes neither native identity. `local()`, network fonts,
WOFF2, variations, color/SVG font tables, and guest `FontFace` or
`document.fonts` authority remain denied.

Live SVG is part of `DOM`; it is not another group. Use the reviewed
`document.createElementNS()` element/attribute surface. Parser assignment,
links, styles, filters, masks, animation, and external resources remain
absent. The current `svg-dom-v2` surface retains exact
`aria-hidden="true"`/`"false"` values on every supported live SVG element and
accepts `clip-rule` only as `nonzero`, `evenodd`, or `inherit`. Removal is the
unset ARIA state. The common legacy decorative hint `focusable="false"` is an
observable no-op: it does not create focus authority, readback remains unset,
and `diagnostics().dom.svgCompatibility` counts the recovery. Other values,
unknown `aria-*`, relational ARIA references, focus/navigation attributes,
handlers, URLs, namespace/parser operations, and styles still fail closed.
Static `.svg` resources use their separate unchanged sanitizer.

Literal browser-loaded CSS images require both `NETWORK` and explicit
`networkPolicy.browserImages` exact-URL authority. Origin-wide authority is
denied because selector-chosen paths are an information-flow channel.
URL-bearing custom properties and `var()` in image-bearing sinks are denied so
later inheritance cannot bypass the signed policy.

### Media and rendering resources

An explicit `.wav` or `.webm` default import becomes an opaque signed token.
Assign only that token to the matching `AUDIO` or `VIDEO` facade and call
`play()` synchronously during trusted user activation. Autoplay, network
media, raw bytes, streaming, DRM, capture, fullscreen, picture-in-picture,
remote playback, and native media objects remain denied.

`CANVAS_2D` exposes bounded write/path/text/artifact-image operations; pixel
readback and export remain absent. `WEBGL` and `WEBGPU` expose only their
generated fixed ledgers. Select exactly one rendering group.

## Network policy

`NETWORK` selects the network API family. It does not select any destination.
Use `CapsuleNetworkPolicy` at build and host boundaries:

```ts
import {
  CAPSULE_NETWORK_POLICY_FORMAT,
  type CapsuleNetworkPolicy,
} from '@omnidraw/capsule/protocol';

const networkPolicy: CapsuleNetworkPolicy = {
  format: CAPSULE_NETWORK_POLICY_FORMAT,
  bufferedFetch: [{
    origin: 'https://api.example.com',
    pathPrefix: '/widgets/',
    methods: ['GET', 'POST'],
  }],
};

const built = await buildCapsuleGuest({
  input: distributionInput,
  apis: ['DOM', 'NETWORK'],
  networkPolicy,
  budgets: { networkBytes: 1024 * 1024 },
  parkability: { parkable: false },
  policy: buildValidationPolicy,
});

const host = await createCapsuleHost({
  allowedApis: ['DOM', 'NETWORK'],
  networkPolicy,
  limits: { networkBytes: 1024 * 1024 },
  browserPlatform: createDefaultCapsuleBrowserPlatform({ document }),
});
```

The effective buffered-fetch rules are the exact intersection of signed
artifact, host, and optional mount policies. Omitting policy while selecting
`NETWORK` materializes a deny-all network policy; it never creates ambient
fetch authority. Supplying policy without `NETWORK` is invalid. Capsule decodes
safe path escapes before prefix comparison and rejects encoded dot, slash,
backslash, percent, control, query, or fragment syntax before native fetch.

An optional `browserImages` record authorizes exact URLs and reviewed CSS image
sinks. Its retained v1 `origins` field must be `[]`; origin-wide authority is
rejected. It is deliberately separate from buffered fetch: browser credentials,
redirects, CORS, CSP, cache, response traffic, and decode allocation follow the
embedding browser and do not consume Capsule's `networkBytes` ledger. Omit it
when mediated bytes are required.

## Budgets and limits

All ten dimensions are finite:

```ts
type CapsuleBudgetDimension =
  | 'cpuMs'
  | 'memoryBytes'
  | 'domNodes'
  | 'handles'
  | 'messageBytes'
  | 'streamBytes'
  | 'assetBytes'
  | 'networkBytes'
  | 'gpuBytes'
  | 'lifecycleBytes';
```

The registry gives every selected group immutable default requests and hard
maxima. Base `DOM` supplies finite defaults for every dimension and keeps
network and GPU authority at zero. Other groups contribute only the bounded
increases they need.

All public overrides are partial:

- build `budgets` narrows or requests selected dimensions;
- build `policy.budgetCeilings` is an optional partial trusted ceiling;
- host `limits` is an optional partial ceiling;
- mount `limits` is an optional per-instance narrowing.

Omitted dimensions use the applicable group defaults. Effective values are
the component-wise minimum of artifact request, host ceiling, optional mount
narrowing, profile hard maxima, and shared partitions. Zero is an exact deny
value.

```ts
const handle = await host.mount({
  artifact: signedArtifactBytes,
  container,
  limits: {
    cpuMs: 100,
    assetBytes: 2 * 1024 * 1024,
  },
});
```

Read `handle.diagnostics().budgets` and the resource ledgers when tuning.
Fixture measurements are evidence about those fixtures, not universal
deployment recommendations.

## Host and mount narrowing

A shared host may allow more than one artifact:

```ts
const host = await createCapsuleHost({
  allowedApis: ['DOM', 'NETWORK', 'AUDIO'],
  networkPolicy: hostNetworkCeiling,
  browserPlatform: createDefaultCapsuleBrowserPlatform({ document }),
});
```

The mount may only remove authority:

```ts
const handle = await host.mount({
  artifact: signedArtifactBytes,
  container,
  allowedApis: ['DOM', 'NETWORK'],
  networkPolicy: instanceNetworkNarrowing,
  limits: { networkBytes: 256 * 1024 },
});
```

Mount `allowedApis` must remain a valid dependency-complete subset of both the
signed artifact and host. It cannot add a group. Omission keeps the signed
request intersected with the host ceiling.

A missing required browser primitive rejects before guest execution. V1 has
no partially degraded group. Build and sign a separate artifact with fewer
groups when a product needs a fallback.

## Artifact signing and verification

Sign canonical bytes in a trusted release environment:

```ts
import { signCapsuleArtifactBytes } from '@omnidraw/capsule/sign';

const signedArtifactBytes = await signCapsuleArtifactBytes(
  built.artifactBytes,
  [{ keyId: 'app-release-2026', privateKey: releasePrivateKey }],
);
```

Require the matching public key in the browser host:

```ts
const host = await createCapsuleHost({
  allowedApis: ['DOM'],
  artifactVerification: {
    signaturePolicy: {
      trustedKeys: new Map([['app-release-2026', releasePublicKey]]),
      minimumValidSignatures: 1,
      requiredKeyIds: ['app-release-2026'],
      rejectUntrustedSignatures: true,
    },
  },
  browserPlatform: createDefaultCapsuleBrowserPlatform({ document }),
});
```

The signer owns no ambient key store. It accepts explicit private Ed25519
`CryptoKey` values, orders signatures canonically by key ID, preserves the
content hash, and rejects malformed or noncanonical bytes and duplicate keys.

Artifact authenticity is deny-by-default. A mount fails closed with
`ARTIFACT_REJECTED` unless `artifactVerification` carries a `signaturePolicy`
that requires at least one valid signature, or the loud escape hatch
`allowUnsigned: true`. An empty or zero-minimum policy is not authentication
and still requires the escape hatch. Use the
escape hatch only for bounded local construction where unsigned artifacts are
a deliberate choice; successfully published mounts are counted in
`diagnostics().unsignedMounts`. `minimumValidSignatures` counts distinct
signing keys, including non-extractable verification keys, not distinct key
IDs, so one key registered under several identities cannot satisfy an m-of-n
policy.

Treat verification policy as authority, not a live configuration object. The
options, target, and signature-policy objects must contain only exact
enumerable data properties; `trustedKeys` must be a native `Map`, and the two
string lists must be dense undecorated arrays. Capsule snapshots their
descriptors once into private null-prototype records before cache or crypto
work. Trusted-key copying and lookup use initialization-captured native Map
operations across crypto awaits. Accessors, Map proxies, prototype pollution,
and later mutation cannot change the decision.

`CapsuleMemoryArtifactCache` stores copied verified canonical bytes. A later
mount may use `{ hash: artifactHash }`, but the host revalidates the cache hit
under current signature and policy requirements.

## Application capabilities

Browser API groups and application capabilities are deliberately separate.
Capabilities retain exact IDs, versions, contract hashes, schemas, operations,
quotas, providers, and lifecycle policy.

Construct schemas through the supported schema entry, register them on the
host, then register descriptors:

```ts
import {
  type CapsuleCapabilityBinding,
  type CapsuleKernelCallContext,
} from '@omnidraw/capsule';
import { createCapsuleSchemaResource } from '@omnidraw/capsule/schema';

const counterSchema = await createCapsuleSchemaResource({
  format: 'capsule-schema-v1',
  root: {
    type: 'object',
    properties: { amount: { type: 'number', integer: true } },
    required: ['amount'],
  },
});

const schemaRegistration = await host.registerSchema(counterSchema);
const descriptorRegistration = host.registerCapabilityDescriptor({
  id: 'example.counter',
  version: '1.0.0',
  contractHash,
  operations: [{
    name: 'increment',
    kind: 'call',
    inputSchema: counterSchema.reference,
    outputSchema: counterSchema.reference,
  }],
});

const binding: CapsuleCapabilityBinding = {
  descriptor: descriptorRegistration.descriptor,
  invoke(_context: CapsuleKernelCallContext, _operation, input) {
    return input;
  },
  dispose() {},
};
```

The artifact must request the capability, the host must allow its identity,
and the mount supplies the concrete binding and grant. Discovery alone grants
nothing. Inputs and outputs validate at both sides of the bridge, and native
provider objects never enter the guest.

Guest SDK code uses the guest entry:

```ts
import {
  callCapabilityAsync,
  discoverCapability,
} from '@omnidraw/capsule/guest';

const selector = {
  id: 'example.counter',
  versionRange: '^1.0.0',
  contractHash: 'sha256:…',
};

if (discoverCapability(selector) !== null) {
  const result = await callCapabilityAsync(
    selector,
    'increment',
    { amount: 1 },
    { timeoutMs: 1_000 },
  );
}
```

All JavaScript bundled into one artifact still shares one guest realm and one
application trust domain. A dependency can call guest-visible bridge globals,
so routing identifiers are not authentication. Capsule authenticates every
asynchronous call and stream delivery with a cryptographically random,
host-issued settlement token held in the bridge module's private state; a
missing or mismatched token is rejected without consuming pending work. The
host also invokes bridge, snapshot, and timer dispatch through VM-retained
ordinary-object registry slots, not through replaceable QuickJS global-object
properties.

Schema registration is bounded. It cannot be removed while a descriptor or
pending/live mount in any lifecycle state may still use it.

## Guest channels

Declare channel schemas in the build request and register the corresponding
schema resources before mount. Supply initial values at mount:

```ts
const handle = await host.mount({
  artifact: signedArtifactBytes,
  container,
  guestChannels: {
    props: { schema: propsSchemaReference, initial: { count: 0 } },
    theme: { schema: themeSchemaReference, initial: { mode: 'dark' } },
    output: {
      schema: outputSchemaReference,
      onOutput(value) {
        console.log('guest output', value);
      },
    },
  },
});

handle.setProps({ count: 1 });
handle.setTheme({ mode: 'light' });
const stopOutput = handle.onOutput((value) => console.log(value));
```

Values use Capsule's bounded structured-value format. Functions, accessors,
cycles, host objects, and unsupported prototypes are rejected.

## Lifecycle, viewport, and observation

After `ready()`:

```ts
await handle.setSchedulingMode('throttled');
await handle.freeze('tab-hidden');
await handle.resume({
  reason: 'tab-visible',
  schedulingMode: 'active',
});

handle.setViewport({
  width: 800,
  height: 600,
  scale: window.devicePixelRatio,
  visibility: 'visible',
  distance: 0,
  priority: 0,
  occlusion: 0,
});
```

`snapshot()` captures a parkable guest. `park()` captures and releases the
runtime. Resuming a parked handle builds a fresh generation and may accept a
compatible replacement artifact. These operations require an explicit signed
parkability and snapshot contract.

### Mount geometry and scrolling

The guest document root (the guest's `document.body`) emulates a browser
document viewport:

- The internal `<capsule-instance>` shell fills your mount container's
  content box by default (plain inline `height: 100%`). Your own CSS or
  script on the shell, or a `setViewport()` call, overrides that default;
  `setViewport()` writes explicit pixel sizes and wins. Capsule reserves
  `display`, `contain`, and `overflow` on the shell — never override those.
- The guest root fills the shell's content box and scrolls its own overflow
  (`width`/`height` 100%, `box-sizing: border-box`, `overflow: auto`), so
  guest CSS like `height: 100%` resolves exactly as it would against a
  browser viewport, and content taller than the frame scrolls instead of
  being silently clipped.
- These are layered defaults, not a prison: ordinary guest rules through
  the `html`/`body`/`:root` selector mapping (for example
  `body { height: auto; overflow: visible }`) and guest inline styles
  override them without `!important`. Guests keep owning their own inner
  scrolling as before.
- With an auto-height container and no `setViewport()` call, the chain
  stays content-sized exactly as in earlier releases.

Use bounded observation:

```ts
const startupErrors = [];
const mount = host.mount({
  artifact,
  container,
  onError(event) {
    startupErrors.push(event);
  },
});
const handle = await mount;

const stopErrors = handle.onError((event) => {
  if (event.category === 'vm') {
    console.error(
      event.artifactHash,
      event.runtimeGeneration,
      event.location,
    );
  }
});
const stopMetrics = handle.onMetrics((event) => {
  metricsSink.record(event);
});
```

The mount listener is active before application-module evaluation and is
released when mount settles. Handle listeners do not replay startup events.
Listener failures are contained.

Current errors use the exact message-free `capsule-mount-error-v3`
discriminated union. Guest failures carry the exact artifact hash, a positive
never-reused runtime generation, and an optional frozen generated location.
Locations use one-based lines and zero-based UTF-16 columns against the exact
application-owned distribution bytes; apply consumer-owned source maps
outside Capsule. Omitted locations are normal when native metadata is absent,
ineligible, stale, malformed, internal, or out of bounds. The separately
exported v1/v2 formats and `*V1`/`*V2` types are historical shapes, not aliases
for v3.

With the current `DOM` bundle, `console.error()` emits only the nonfatal
`guest.console` / `GUEST_REPORTED_ERROR` signal. Capsule evaluates guest
argument expressions normally but never passes their resulting values to the
host hook and never inspects, coerces, stringifies, retains, or hashes them.
Multiple calls in one outermost entry coalesce. The complete mount—including
freeze, park, rejected replacement, and committed replacement—publishes at
most 16 reports; later entries increment only the saturating suppressed
diagnostic. `console.log()` and `console.warn()` remain inert.

## Diagnostics

Public group diagnostics are immutable:

```ts
const diagnostics = handle.diagnostics();
console.log({
  format: diagnostics.apiContract.format,
  bundleDigest: diagnostics.apiContract.bundleDigest,
  requested: diagnostics.apiContract.requestedApis,
  effective: diagnostics.apiContract.effectiveApis,
  legacy: diagnostics.apiContract.legacy,
  resourceFamilies: diagnostics.apiContract.resourceFamilies,
  budgets: diagnostics.budgets,
  svgCompatibility: diagnostics.dom.svgCompatibility,
});
```

The same snapshot includes the exact private target for compatibility audit,
plus lifecycle, viewport, capability, VM, DOM, queue, resource-ledger, and
teardown counters. Ordinary callers diagnose with groups; they do not copy the
private target back into a construction request.

After successful destroy, every live instance-owned and subscription counter
must be zero. Historical peaks and cumulative traffic may remain visible.

## Testkit

Testkit is opt-in and single-use:

```ts
import {
  createCapsuleTestAutomation,
  createCapsuleTestHost,
  locateCapsuleTestTarget,
} from '@omnidraw/capsule/testkit';

const testHost = await createCapsuleTestHost({
  allowedApis: ['DOM'],
  browserPlatform: createDefaultCapsuleBrowserPlatform({ document }),
});

const automation = createCapsuleTestAutomation({
  maxTargets: 128,
  maxScannedElements: 4_096,
  maxResults: 64,
});

const handle = await testHost.mount({
  artifact: signedArtifactBytes,
  container,
  testAutomation: automation.attachment,
});

const button = locateCapsuleTestTarget(automation, {
  role: 'button',
  name: 'Save',
  maxResults: 2,
});
```

Use the returned geometry with browser automation for trusted input. The
ordinary production host rejects `testAutomation`; only
`createCapsuleTestHost` accepts it, and that test host otherwise retains the
same exact group-first host and mount records. Both public facades capture one
immutable descriptor snapshot before delegating. Testkit returns no ShadowRoot or DOM node,
does not enter the VM, and cannot bypass group, capability, or activation
policy. Never import the testkit entry in production.

## Dedicated authoring inspection

Authoring products that must inspect one isolated draft use the separate
production-supported host. Do not add its attachment to an ordinary visible
or published mount:

```ts
import {
  createCapsuleAuthoringInspection,
  createCapsuleAuthoringInspectionHost,
} from '@omnidraw/capsule/authoring-inspection';

const inspection = createCapsuleAuthoringInspection({
  maxTargets: 64,
  maxResults: 32,
});
const inspectionHost = await createCapsuleAuthoringInspectionHost({
  allowedApis: ['DOM'],
  artifactVerification: { signaturePolicy },
  browserPlatform: createDefaultCapsuleBrowserPlatform({ document }),
});
const handle = await inspectionHost.mount({
  artifact: signedArtifactBytes,
  container: isolatedInspectionContainer,
  authoringInspection: inspection.attachment,
});
await handle.ready();

const matches = inspection.query({
  role: 'button',
  name: 'Save',
  exact: true,
  maxResults: 2,
});
const point = matches.length === 1
  ? inspection.validateActionPoint(matches[0]!.id)
  : undefined;

// After the trusted pointer click has settled, and immediately before typing:
const focused = matches.length === 1
  ? inspection.validateFocusedTarget(matches[0]!.id)
  : undefined;
if (focused?.valid !== true) {
  throw new Error(`Input target changed: ${focused?.reason ?? 'missing'}`);
}

// Immediately before one trusted browser insert operation:
const keyboardGuard = inspection.armNativeKeyboardGuard(
  matches[0]!.id,
  'insert_text',
);
// Drive exactly one trusted browser insert-text operation outside this page.
// Then, without starting another operation:
const keyboardResult = inspection.finishNativeKeyboardGuard(keyboardGuard.guardId);
if (!keyboardResult.valid) {
  throw new Error(`Input was not retained: ${keyboardResult.reason}`);
}
```

Drive a real browser pointer only when `point?.valid === true`, using the
returned mount-relative `centerX`/`centerY` plus the trusted container's
browser position. Re-query after runtime replacement. Freeze/resume may
advance `lifecycleGeneration`; `runtimeGeneration` and
`attachmentGeneration` identify the inspected root generation.

For keyboard input, let the native click and guest focus handlers settle, then
call `validateFocusedTarget(targetId)` immediately before the first global key
operation. It succeeds only when the same current target remains visible,
enabled, non-sensitive, editable, and is the closed root's exact active
element. A denial reason is one of `missing`, `stale`, `not_visible`,
`disabled`, `sensitive`, `not_editable`, or `not_focused`; do not type after a
denial. The check does not focus, mutate, or dispatch.

For each native mutation, arm exactly one guard for `delete_backward`,
`insert_text`, or `commit_enter`, drive one matching trusted browser operation,
and immediately finish the same `guardId`. Only one guard may be active. Arm
atomically repeats the retained-target safety and exact-focus check. During the
native listener, Capsule records only whether the exact keydown/beforeinput was
observed. After every guest callback it cancels that same native default if
focus left the target, if a contenteditable Selection escaped the target, or
if the event did not match the declared operation. Finish returns only the
ticket identity, `valid`, one of `valid`, `focus_redirected`,
`selection_outside_target`, `event_missing`, `event_mismatch`, or `stale`, the
two event-observed booleans, and whether native cancellation actually
succeeded. Treat every non-`valid` result as an aborted action. Selection-only
commands such as select-all instead require an immediate second
`validateFocusedTarget` before any guarded mutation. Contenteditable guarding
requires captured composed-range endpoints; Capsule denies arm on a browser
that cannot provide that exact view instead of trusting a clipped scoped
Selection. Input and textarea targets do not depend on that primitive.

`visibleSummary()` orders interactive/form controls, canvas/media, landmarks,
then visible text in tree order. `canvases()` returns visible bounds, bitmap
dimensions, owned context kind, and context-loss state only. It makes no
pixel-content claim. All records and arrays are frozen and bounded. The
4,096-element scan allowance is cumulative across calls on one attachment;
inspection fails closed before a call would exceed what remains. After each
successful call, `diagnostics().lastQueryOmitted`,
`lastVisibleSummaryOmitted`, and `lastCanvasOmitted` report exact result-limit
omissions for that call kind, so an authoring shell can mark a snapshot as
truncated instead of assuming a full result. The
controller never exposes nodes, the closed root, HTML, form values, URLs,
arbitrary styles/attributes, pixels, GPU objects, an evaluator, or
programmatic activation; password/file/hidden inputs are marked sensitive.
Destroying the handle or host disposes the single-use attachment and clears
all retained targets and generation identity.

## WebGL and WebGPU adapters

`createDefaultCapsuleBrowserPlatform()` constructs the reviewed adapters.
Use `/webgl` or `/webgpu` only to implement a custom trusted platform or
inspect fixed facade limits.

Those subpaths expose adapter types, fixed limits, and public group identity.
They do not expose a general private-profile assembler. Native contexts,
devices, buffers, textures, queues, and other browser objects remain
host-owned.

`WEBGL` resolves to `canvas-webgl-v2`, the bounded WebGL2 ledger used by the
pinned Three.js r185 indexed transparent-shader probe. V2 adds ordinary blend
state only: `BLEND` plus the five blend state methods. It remains neither
ambient WebGL nor a promise that arbitrary scenes work. Already signed 0.12.0
artifacts retain their exact `canvas-webgl-v1` facade; Capsule does not widen
them during verification or mount. `WEBGPU` is the
bounded visible-canvas subset, not compute or unrestricted WebGPU.

## Lazy loading and population

Load the browser host at the first widget/route admission boundary:

```ts
const { createCapsuleHost, createDefaultCapsuleBrowserPlatform } =
  await import('@omnidraw/capsule');
```

The QuickJS release distribution loads only when the first VM is constructed.
Keep `build`, `sign`, and `testkit` out of production browser imports. Load
`authoring-inspection` only in the isolated trusted authoring route that owns
the dedicated mount; ordinary application and Preview routes use the root
host.

Do not allocate one live runtime per persisted or offscreen record. The
repository's conservative construction policy admits at most 24 aggregate
live runtimes, including at most two GPU runtimes, and retains at most 64
eligible parked envelopes. A deployment may narrow those values from its own
evidence and must not widen them without a new capacity report.

Run `bun run benchmark:loading`, `bun run benchmark:capacity`, and
`bun run benchmark:micro` in the repository for the exact procedures and
current machine-bound evidence. The micro suite covers only browser-free CPU
paths; a short construction run is not a long-term physical-memory claim.

## Migration from 0.9.4

0.10.0 intentionally removes the ordinary source-level profile assembler.

Replace:

| 0.9.4 source input | 0.10.0 source input |
| --- | --- |
| build `target.runtimeAbi`, `target.domProfile`, `target.featureProfiles` | build `apis` |
| build `requestedBudgets` plus complete policy budget records | optional partial build `budgets` and partial `policy.budgetCeilings` |
| build/host/mount `fetchAuthority` | `CapsuleNetworkPolicy` |
| host `runtimePolicy.target` | host `allowedApis` |
| host complete `budgetCeiling`/`budgetDefaults` | optional partial host `limits` |
| mount `featureGrants` and repeated empty arrays | simple mount, with optional `allowedApis`/`limits` narrowing |
| caller-selected artifact resource profile | inference from explicit `cssRoots`/`resourceBindings` |

For example:

```ts
// 0.9.4
buildCapsuleGuest({
  input,
  target: { runtimeAbi, domProfile, featureProfiles, language: 'js' },
  capabilityRequests: [],
  parkability: { parkable: false },
  requestedBudgets: completeBudgets,
  policy: legacyPolicy,
});

// 0.10.0
buildCapsuleGuest({
  input,
  apis: ['DOM', 'NETWORK'],
  networkPolicy,
  parkability: { parkable: false },
  budgets: { networkBytes: 1024 * 1024 },
  policy: buildValidationPolicy,
});
```

Rebuild and re-sign normal artifacts to obtain the signed
`apiContract`/`resolvedTarget` form.

The 0.10.0 host also retains a bounded artifact-only adapter for existing
0.9.4 exact-target bytes. Admission succeeds only when the complete final
target maps unambiguously to an accepted group expansion and the new host
allows every mapped group. Diagnostics report
`format: 'legacy-exact-target-0.9.4'` and `legacy: true`. Unknown,
construction-only, ambiguous, incomplete, or disallowed targets fail closed;
the adapter never invents authority and cannot narrow a legacy artifact by
rewriting its signed target.

The compatibility is one-way. A frozen 0.9.4 host does not understand the new
group-artifact schema. It rejects the artifact during schema validation,
before VM or guest execution, with `ARTIFACT_REJECTED` caused by
`envelope_invalid`. The current 0.10 retained exact-target mode is different:
its decoder understands the group schema, then rejects the artifact with
`ARTIFACT_REJECTED` caused by `target_incompatible`.

The artifact adapter is not a reason to preserve two source APIs. Remove all
application imports and examples of public runtime/profile constants and
feature grants during the upgrade.

## Upgrading from 0.15.1

Capsule 0.16.0 adds bounded content-free `console.error()` observability to
new current-bundle `DOM` artifacts. Rebuild and sign a guest to select
`guest-console-errors-v1`; `console.log()` and `console.warn()` remain inert,
and console argument values never cross the guest boundary.

Existing 0.15.1 signed artifacts remain valid under their exact retained
bundle digest. They keep `form-select-options-v1` and `svg-dom-v2`, do not gain
`guest-console-errors-v1`, and therefore keep `console.error()` inert. Existing
0.15.0 artifacts are also retained exactly with `svg-dom-v2` but without the
later select-options or console overlays. Do not copy an old bundle digest
into a newly constructed manifest; preserve the signed artifact or rebuild it
against the current registry.

## Upgrading from 0.12.0

Capsule 0.13.0 moves newly built `WEBGL` artifacts to `canvas-webgl-v2` so
standard Three.js transparent materials can configure blending. Rebuild and
sign WebGL guests to select v2. Existing 0.12.0 signed group artifacts remain
valid under their retained bundle digest and continue using the v1 method and
constant tables without blend authority.

- No host API call shape changes are required.
- Custom trusted WebGL adapters must implement the five ordinary blend-state
  methods for new v2 artifacts.
- Readback, debug renderer information, context-loss control, ambient uploads,
  and native-object export remain denied.
- Repeat the native/Capsule WebGL lab on the deployment's real browser, OS,
  GPU, and driver before making a compatibility claim.

## Upgrading from 0.11.0

Capsule 0.12.0 changes default mount geometry without any API change. The
internal mount shell now fills its container's content box by default, and
the guest document root fills the shell and scrolls its own overflow. Guest
CSS using percentage heights now resolves against the root instead of
collapsing to content size, and overflowing guest content scrolls rather
than being silently clipped.

- No mount, build, or signing changes are required; existing signed
  artifacts work unchanged.
- Review guests that depended on a content-sized document root (for
  example, measuring `document.body.offsetHeight` to report an intrinsic
  size). Such guests can restore the old behavior with an ordinary
  `body { height: auto; overflow: visible }` rule.
- If you size instances through `setViewport()`, nothing changes: it still
  overrides the container-fill default.

The group-contract format and bundle digest are unchanged; artifacts do not
need to be rebuilt or re-signed for this release.

## Upgrading from 0.10.2

Capsule 0.11.0 preserves the package's root and eight supported subpath
imports, but deliberately tightens several public authority boundaries. Apply
these changes before mounting an artifact built for this release:

- Configure an authenticating `artifactVerification.signaturePolicy`, or set
  the explicit `artifactVerification.allowUnsigned: true` escape hatch for
  bounded local construction. Unsigned mounting is no longer the default, and
  successful escape-hatch mounts increment `host.diagnostics().unsignedMounts`.
- When an effective mount combines `FILES` or `CLIPBOARD` with `NETWORK`, set
  the literal mount option `allowDataSourceNetwork: true` after reviewing the
  resulting data-flow authority. The composition otherwise fails closed.
- Remove `testAutomation` from production `host.mount()` calls. Import
  `createCapsuleTestHost` from `@omnidraw/capsule/testkit` and mount through
  that test-only host instead:

  ```ts
  import {
    createCapsuleTestAutomation,
    createCapsuleTestHost,
  } from '@omnidraw/capsule/testkit';

  const testHost = await createCapsuleTestHost({
    allowedApis: ['DOM'],
    browserPlatform,
    artifactVerification: { allowUnsigned: true },
  });
  const testAutomation = createCapsuleTestAutomation();
  const handle = await testHost.mount({
    artifact,
    container,
    testAutomation: testAutomation.attachment,
  });
  ```

- Mounts now default to `visualConfinement: 'strict'`, which applies paint
  containment and clipping to the internal shell. Use
  `visualConfinement: 'none'` only when the embedding host deliberately owns
  an equivalent boundary.
- Replace browser-image origin rules with exact URL rules. The retained
  `browserImages.origins` field must be an empty array in the v1 policy.
- Supply verification options, targets, and signature policies as exact
  enumerable data records. Use a native `Map` for `trustedKeys` and dense,
  undecorated arrays for required key IDs and target feature profiles.

Public result shapes also grew: host diagnostics include `unsignedMounts`, and
instance quota partitions include `networkScratchBytes`. Update exhaustive
consumers and any test fixtures that construct those records. Signature
thresholds now count distinct `CryptoKey` identities rather than key IDs;
capability call and stream rates use rolling one-second windows; and
programmatic `Element.click()` uses Capsule's confined reduced activation
contract rather than native click behavior.

The `capsule-api-groups-v1` bundle digest changed with these authority and DOM
contract changes. Rebuild and re-sign artifacts instead of copying the old
digest into new manifests.

## Versioning

The package version is `@omnidraw/capsule` 0.16.0. The group-contract format
and bundle digest, artifact envelope, runtime ABI, private ledgers/profiles,
capability identities, network-policy format, and snapshot schemas are
independently versioned exact contracts.

Before upgrading:

1. read [`CHANGELOG.md`](../CHANGELOG.md);
2. rebuild and sign normal guest artifacts;
3. verify the host's `allowedApis`, network policy, and limits;
4. run package, group-conformance, focused construction, and application
   tests;
5. verify snapshot migration declarations for parked instances; and
6. obtain human acceptance for every browser/interaction/hardware claim the
   release makes.

Unsupported exact identities fail before guest execution rather than being
approximated.

## Production checklist

- Pin exact Capsule and application dependency versions and lockfiles.
- Compile guests in application-owned isolation and ingest only a closed
  distribution.
- Select the smallest dependency-complete API group set.
- Sign artifacts in a trusted release environment and require the expected
  public keys.
- Keep host groups, network policy, capability policy, and limits narrower
  than or equal to signed requests.
- Leave application capabilities absent until intentionally integrated.
- Treat user activation, files, clipboard, dialogs, audio, and rendering as
  explicit authority.
- Use the default browser platform unless a custom adapter has been reviewed.
- Never attach testkit in production.
- Observe normalized errors and terminal cleanup counters.
- Destroy every handle and host during application teardown.
- Keep automated construction evidence separate from human compatibility
  acceptance.
- Require the exact packed Digital Reset license and
  minified-only/no-source-map JavaScript checks to pass on the exact archive
  selected for publication.

## Troubleshooting

`ERR_PACKAGE_PATH_NOT_EXPORTED` means code imported an unsupported deep path.
Use the root or one of the eight supported subpaths.

`capsule:bridge` cannot be resolved means the guest entry was imported by
ordinary host code. Bundle it only into guest output.

An API-contract or target-incompatible error means the artifact contract,
bundle digest, host group ceiling, mount subset, resolved target, or platform
does not agree. Compare public group diagnostics first; do not copy private
profiles into a new request.

A network denial means no rule survived artifact/host/mount policy
intersection, the request exceeded a rule or quota, or `NETWORK` is absent.

A signature failure means the artifact has too few valid trusted signatures,
is missing a required key ID, or carries a forbidden untrusted signature.

A quota error means one effective budget is exhausted. Read immutable
diagnostics and adjust only the smallest relevant partial limit.

A container error means the element is not empty/eligible or another pending
or live mount owns it. Destroy the prior handle and await cleanup before
reuse.
