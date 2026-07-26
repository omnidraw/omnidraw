# Using the Capsule library

This guide is the consumer manual for `@omnidraw/capsule`. It covers the supported package entrypoints, building or obtaining a guest artifact, creating a browser host, mounting and controlling an instance, granting authority, testing, and production hardening.

This guide summarizes the public exports and security contract from the Capsule
source repository so it remains useful without broken cross-repository links.

## Install

Capsule is one ESM package:

```sh
bun add @omnidraw/capsule
```

The package contains browser-host code, Bun/Node build tooling, declarations, the reviewed POSIX source-ingestion helper, and exact third-party runtime dependencies. It does not require the Capsule monorepo or a Capsule service.

The tested package manager is Bun 1.3.14. Browser applications should use a modern ESM-aware bundler. The `build`, `build-runner`, and `sign` entrypoints are trusted tooling and must run outside the browser.

## Supported imports

Use only these imports:

| Import | Environment | Purpose |
| --- | --- | --- |
| `@omnidraw/capsule` | Browser host | Create hosts, mount artifacts, control handles, cache artifacts |
| `@omnidraw/capsule/build` | Bun/Node tooling | Build a deterministic artifact from a closed source snapshot |
| `@omnidraw/capsule/build-runner` | Bun/Node on POSIX | Ingest hostile source trees and launch the reference OCI builder |
| `@omnidraw/capsule/guest` | Capsule guest source | Call capabilities and use guest channels inside the VM |
| `@omnidraw/capsule/protocol` | Browser or tooling | Protocol constants and serializable contract types |
| `@omnidraw/capsule/schema` | Browser or tooling | Canonical application-schema resources and public schema types |
| `@omnidraw/capsule/sign` | Bun/Node release tooling | Canonically sign exact artifact bytes with explicit Ed25519 private keys |
| `@omnidraw/capsule/testkit` | Browser tests | Root-confined closed-tree automation |
| `@omnidraw/capsule/webgl` | Trusted browser adapter | Bounded WebGL platform integration |
| `@omnidraw/capsule/webgpu` | Trusted browser adapter | Bounded WebGPU platform integration |

Every other package subpath is unsupported and rejected by the export map. Do not import the private `@omnidraw/capsule-*` workspace names seen in the source repository.

The guest entrypoint imports the reserved `capsule:bridge` intrinsic. It is meant to be included in guest source and compiled by Capsule; importing it directly into an ordinary host runtime will fail.

## How the pieces fit

```text
trusted source snapshot
  → @omnidraw/capsule/build
  → immutable artifact
  → trusted release signing
  → @omnidraw/capsule browser host
  → policy ∩ artifact request ∩ mount grant ∩ live binding
  → QuickJS guest + host-owned DOM/capability membranes
```

Artifacts describe requested authority; they never grant it. The host policy, mount grants, live bindings, feature grants, browser support, and budgets all have to agree before authority becomes effective.

## Minimal browser mount

The simplest integration starts with artifact bytes produced by your trusted build/release pipeline.

```html
<div id="capsule-surface"></div>
```

```ts
import {
  CapsuleMemoryArtifactCache,
  createCapsuleHost,
  createDefaultCapsuleBrowserPlatform,
  type CapsuleHandle,
} from '@omnidraw/capsule';
import {
  CAPSULE_DOM_CORE_V2_PROFILE,
  CAPSULE_RUNTIME_ABI,
  type CapsuleCompleteBudgetMaximums,
} from '@omnidraw/capsule/protocol';

const container = document.querySelector<HTMLElement>('#capsule-surface');
if (container === null) throw new Error('Capsule container is missing.');

const budgets: CapsuleCompleteBudgetMaximums = Object.freeze({
  cpuMs: 100,
  memoryBytes: 32 * 1024 * 1024,
  domNodes: 2_000,
  handles: 4_000,
  messageBytes: 64 * 1024,
  streamBytes: 64 * 1024,
  assetBytes: 2 * 1024 * 1024,
  networkBytes: 0,
  gpuBytes: 0,
  lifecycleBytes: 256 * 1024,
});

const host = await createCapsuleHost({
  runtimePolicy: {
    target: {
      runtimeAbi: CAPSULE_RUNTIME_ABI,
      domProfile: CAPSULE_DOM_CORE_V2_PROFILE,
      featureProfiles: [],
    },
    capabilities: [],
    budgetCeiling: budgets,
    budgetDefaults: budgets,
    vm: {
      mode: 'release',
      maxJobsPerDrain: 1_000,
      maxEntryDepth: 32,
    },
  },
  browserPlatform: createDefaultCapsuleBrowserPlatform({ document }),
  artifactCache: new CapsuleMemoryArtifactCache({
    maxEntries: 32,
    maxTotalBytes: 64 * 1024 * 1024,
    maxArtifactBytes: 8 * 1024 * 1024,
  }),
});

let handle: CapsuleHandle | undefined;
try {
  handle = await host.mount({
    artifact: signedArtifactBytes,
    container,
    capabilityBindings: [],
    grants: [],
    featureGrants: [],
  });
  await handle.ready();
} catch (error) {
  await handle?.destroy('mount-failed');
  await host.destroy();
  throw error;
}
```

`container` must be a real unreserved `HTMLElement`. Capsule owns its instance shell until the handle reaches terminal cleanup. A competing mount into the same container is denied.

Always destroy the handle when the instance is no longer needed, then destroy the host when the application no longer needs any Capsule instances:

```ts
await handle?.destroy('route-unmounted');
await host.destroy();
```

Both operations are idempotent.

## Artifact verification and signing

`buildCapsuleGuest()` produces deterministic, content-addressed artifact bytes. Production releases should sign those bytes in a trusted release step and require the expected key at the host:

```ts
const host = await createCapsuleHost({
  runtimePolicy: {
    target,
    capabilities: [],
    budgetCeiling: budgets,
    budgetDefaults: budgets,
    artifactVerification: {
      signaturePolicy: {
        trustedKeys: new Map([['app-release-2026', releasePublicKey]]),
        minimumValidSignatures: 1,
        requiredKeyIds: ['app-release-2026'],
        rejectUntrustedSignatures: true,
      },
    },
  },
  browserPlatform: createDefaultCapsuleBrowserPlatform({ document }),
});
```

The public tooling entry exposes one narrow bytes-in/bytes-out producer rather than artifact mutation or CBOR codecs:

```ts
import { signCapsuleArtifactBytes } from '@omnidraw/capsule/sign';

const signedArtifactBytes = await signCapsuleArtifactBytes(
  built.artifactBytes,
  [{ keyId: 'app-release-2026', privateKey: releasePrivateKey }],
);
```

Keys are explicit private Ed25519 `CryptoKey` values; Capsule owns no key store or ambient credential lookup. One call may add multiple unique signatures, ordered canonically by key ID. Signing preserves the content address and rejects malformed/noncanonical bytes, duplicate IDs, invalid keys, and configured byte/signature limits. Keep this entry out of browser builds. Omitting host `signaturePolicy` permits zero trusted signatures and is appropriate only for bounded local construction work where unsigned artifacts are an explicit choice.

The host verifies direct bytes before execution. A memory cache stores only verified copied bytes. After a verified artifact is cached, a later mount may use `{ hash: artifactHash }`; the host re-verifies cache hits against the current policy.

## Build a dependency-free guest

The builder accepts a complete serialized source snapshot and closed dependency graph. This example builds one plain JavaScript module with no package dependencies:

```ts
import { buildCapsuleGuest } from '@omnidraw/capsule/build';
import {
  CAPSULE_DOM_CORE_V2_PROFILE,
  CAPSULE_RUNTIME_ABI,
  type CapsuleBuildRequest,
  type CapsuleCompleteBudgetMaximums,
} from '@omnidraw/capsule/protocol';

const encoder = new TextEncoder();

const artifactBudgets: CapsuleCompleteBudgetMaximums = {
  cpuMs: 100,
  memoryBytes: 16 * 1024 * 1024,
  domNodes: 100,
  handles: 200,
  messageBytes: 16 * 1024,
  streamBytes: 0,
  assetBytes: 0,
  networkBytes: 0,
  gpuBytes: 0,
  lifecycleBytes: 64 * 1024,
};

const request: CapsuleBuildRequest = {
  input: {
    kind: 'source',
    snapshot: {
      revision: 'hello-v1',
      files: [{
        path: 'src/main.js',
        bytes: encoder.encode(`
          const output = document.createElement('output');
          output.textContent = 'Hello from Capsule';
          document.body.append(output);
        `),
      }],
    },
    entry: 'src/main.js',
    dependencyLock: {
      formatVersion: 2,
      rootDependencies: {},
      entries: [],
    },
    dependencyContent: { entries: [] },
  },
  target: {
    runtimeAbi: CAPSULE_RUNTIME_ABI,
    domProfile: CAPSULE_DOM_CORE_V2_PROFILE,
    featureProfiles: [],
    language: 'js',
  },
  capabilityRequests: [],
  parkability: { parkable: false },
  requestedBudgets: artifactBudgets,
  policy: {
    maxFiles: 8,
    maxFileBytes: 256 * 1024,
    maxTotalBytes: 512 * 1024,
    maxPathBytes: 256,
    maxPathDepth: 8,
    maxPackages: 1,
    maxPackageExports: 1,
    maxDependencyEdges: 1,
    maxDependencyMetadataBytes: 1,
    maxModules: 8,
    maxOutputBytes: 2 * 1024 * 1024,
    budgetDefaults: artifactBudgets,
    budgetCeilings: artifactBudgets,
  },
};

const built = await buildCapsuleGuest(request);
console.log(built.artifactHash, built.diagnostics);
```

The builder never discovers ambient `node_modules`, package manifests, compiler configuration, or host globals. For React, Vue, locked packages, CSS, PNG, sanitized SVG, WOFF, PCM16 WAVE, or silent VP8 WebM resources, provide the exact serialized dependency metadata/content and select the required trusted framework and feature profiles. The checked-in fixtures and build tests are the canonical advanced examples.

Never feed an attacker-controlled filesystem tree directly to the compiler. Use `ingestCapsuleSourceTree()` with explicit POSIX helper authority, or the networkless OCI path, before constructing a build request.

## Lazy browser loading

Import the browser host at the route or visibility boundary where the first Capsule widget is admitted rather than in the application bootstrap:

```ts
const { createCapsuleHost, createDefaultCapsuleBrowserPlatform } =
  await import('@omnidraw/capsule');
```

The production host has a release-only QuickJS loader edge. Importing the host transfers and evaluates the host/membrane closure, but the release QuickJS distribution is fetched only when the first VM is created. The debug QuickJS distribution is not part of the production graph, and warm mounts transfer no additional runtime code. Keep `testkit`, `build`, `build-runner`, and `sign` out of production browser imports.

Run `bun run benchmark:loading` in this repository for the fixed Vite/Chromium procedure, phase-specific transfer/parse/evaluation/heap evidence, and current machine-bound ceilings. Aggregate `dist/` size is not a route transfer budget.

## Population and virtualization

Do not allocate one live Capsule runtime per persisted or offscreen widget. The retained construction policy `capsule-virtualized-canvas-admission-v1` permits at most 10,000 inert records and 512 queued reprioritization candidates while admitting no more than:

- 16 active runtimes;
- eight additional throttled runtimes;
- 16 frozen runtimes;
- eight mixed-heavy runtimes;
- two GPU runtimes; and
- 24 aggregate live runtimes across all states.

At most 64 parked envelopes may be retained, and only for artifacts whose snapshot semantics have separately passed application acceptance. The reference policy freezes offscreen instances after a two-second grace and destroys instances outside the retention radius after 30 seconds unless they are eligible for bounded parking.

These are conservative deployment maxima, not latency or physical-memory guarantees. A deployment may narrow them using evidence from its actual browser, machine, and widget mix. It must not widen them without a new aggregate capacity report. Run `bun run benchmark:capacity` for Capsule's bounded construction procedure; its short churn window explicitly does not establish a two-hour physical-memory trend.

## Target and feature profiles

The build target, host target, artifact target, and mount feature grants must agree.

The recommended base is `CAPSULE_DOM_CORE_V2_PROFILE`. Add only the profiles the application needs:

- `CAPSULE_ARTIFACT_RESOURCES_PROFILE` for signed CSS/PNG resources, mutually exclusive `CAPSULE_ARTIFACT_RESOURCES_V2_PROFILE` for sanitized SVG/WOFF too, or `CAPSULE_ARTIFACT_RESOURCES_V3_PROFILE` for those plus PCM16 WAVE and silent VP8 WebM;
- `CAPSULE_CONTROLLED_DIALOGS_PROFILE` for mediated synchronous alerts;
- `CAPSULE_USER_FILES_PROFILE` for chooser-selected text files;
- `CAPSULE_USER_FILES_DROP_PROFILE` for bounded inbound file drops;
- `CAPSULE_USER_FILES_IMAGES_PROFILE` for bounded PNG previews;
- `CAPSULE_CLIPBOARD_TEXT_PROFILE` with `CAPSULE_DOM_SELECTION_PROFILE` for plain-text clipboard editing;
- `CAPSULE_FETCH_BUFFERED_PROFILE` for policy-bounded buffered fetch;
- `CAPSULE_WEB_AUDIO_SYNTHESIS_PROFILE` for bounded synthesis;
- `CAPSULE_SVG_DOM_PROFILE` for reviewed live SVG construction and copied geometry;
- `CAPSULE_CANVAS_2D_PROFILE`, `CAPSULE_CANVAS_WEBGL_PROFILE`, or `CAPSULE_CANVAS_WEBGPU_PROFILE` for one mutually exclusive bounded canvas facade;
- `CAPSULE_MEDIA_AUDIO_PROFILE` and/or `CAPSULE_MEDIA_VIDEO_PROFILE` for activation-gated resources-v3 playback.

Profile dependencies are checked fail-closed. Canvas profiles are mutually exclusive. Static media requires resources v3. File drop requires base file authority. Image previews require base file and artifact-resource authority. Clipboard on DOM v2 requires the Selection overlay.

Listing a feature in the host target means the host may support it; the same exact feature still must be declared by the artifact and passed in `featureGrants` for that mount.

### Resource v2/v3 authoring

With `artifact-resources-v2` or v3, import `.svg` exactly like `.png` and assign its opaque token to a reviewed `<img src>` or CSS image sink. SVG source is canonicalized to a small non-interactive element/attribute subset; scripts, handlers, links, entities, external URLs, animation, filters, masks, and `foreignObject` fail the build.

Declare an artifact font only in source CSS:

```css
@font-face {
  font-family: "Widget Fixture";
  src: url("./widget.woff") format("woff");
  font-weight: 400;
  font-style: normal;
}
.title { font-family: "Widget Fixture"; }
```

Capsule admits WOFF 1 only, rewrites both URL and family identities, loads the face before guest evaluation, and exposes neither native identity. `local()`, network URLs, WOFF2, variations, color/SVG font tables, extra descriptors, and guest `FontFace`/`document.fonts` authority are denied. Rasterization is browser/OS-dependent.

For live charts, select `CAPSULE_SVG_DOM_PROFILE` and use `document.createElementNS('http://www.w3.org/2000/svg', name)`. Only the reviewed element/attribute ledger and `getBBox()` copy are available; use explicit nodes and attributes rather than `innerHTML`, hrefs, styles, filters, masks, animation, or external resources.

Resources v3 permits default imports of canonical `.wav` and `.webm` tokens. Select the matching media profile, assign only that token to an `<audio>` or `<video>` facade, and call `play()` synchronously inside a trusted click/key handler. Autoplay, network URLs, controls, streaming, DRM, capture, fullscreen, PiP, and remote playback are denied. Canvas 2D similarly requires its exact profile and exposes only bounded write/path/text/artifact-image operations; pixel readback and export APIs are absent.

## Budgets

Every finite resource has an explicit bound. `budgetCeiling` is the maximum host authority, `budgetDefaults` supplies omitted mount values, artifact budgets bound the guest request, and `mount({ budgets })` may narrow a specific instance.

Effective budgets are component-wise minima. Zero is a valid deny value and must not be replaced by a truthy default. Start with network, GPU, streams, and assets at zero, then increase only the dimensions required by a selected profile.

Inspect `handle.diagnostics().budgets` and the resource ledgers when tuning limits. A quota failure is a policy outcome, not a reason to disable the boundary.

## Capabilities

Application capabilities are deny-by-default. Effective operations are the exact intersection of:

1. the artifact's capability request;
2. the host runtime policy;
3. the mount grant; and
4. a live instance-bound provider binding.

The descriptor identity includes capability id, exact version, contract hash, operations, schemas, quotas, and lifecycle behavior. Construct schemas through the supported schema entry, register them on the shared host, then register trusted descriptors and supply concrete bindings and grants per mount:

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
  invoke(_context: CapsuleKernelCallContext, _operation, input) { return input; },
  dispose() {},
};
```

A registration is bounded and duplicate exact identities are rejected. `schemaRegistration.unregister()` returns false while a descriptor or any pending/live active, frozen, or parked mount may use it; unregister the descriptor and destroy dependent mounts before retrying. Host destroy terminally clears all registrations.

Guest source uses `@omnidraw/capsule/guest`:

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

const capability = discoverCapability(selector);
if (capability !== null) {
  const result = await callCapabilityAsync(
    selector,
    'increment',
    { amount: 1 },
    { timeoutMs: 1_000 },
  );
  console.log(result);
}
```

Discovery does not grant authority. Inputs and outputs are validated against the registered schemas on both sides of the bridge. Provider objects, native objects, stacks, and mutable host state never cross into the guest.

## Props, themes, outputs, and local store

Declare guest channels in the artifact build request and register their exact schemas before mounting, either through host construction or `await host.registerSchema(resource)`. Supply initial values at mount:

```ts
const handle = await host.mount({
  artifact: signedArtifactBytes,
  container,
  capabilityBindings: [],
  grants: [],
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
const unsubscribe = handle.onOutput((value) => console.log(value));
```

Guest code reads and subscribes through the guest entrypoint. Values use Capsule's bounded structured-value format; functions, accessors, cycles, host objects, and unsupported prototypes are rejected.

Subscriptions do not replay previous events. Call the returned unsubscribe function when the listener is no longer needed.

## Lifecycle and viewport

After `ready()`, a handle supports:

```ts
await handle.setSchedulingMode('throttled');
await handle.freeze('tab-hidden');
await handle.resume({ reason: 'tab-visible', schedulingMode: 'active' });

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

`freeze()` stops runnable work. `snapshot()` captures a parkable guest without parking it. `park()` captures and releases its runtime. `resume()` reconstructs a parked runtime and may accept a compatible replacement artifact. These operations require an artifact with an explicit parkability/snapshot contract.

Use `onLifecycle`, `onError`, and `onMetrics` for bounded observation:

```ts
const stopErrors = handle.onError((event) => {
  console.error(event.code, event.source);
});
const stopMetrics = handle.onMetrics((event) => {
  metricsSink.record(event);
});
```

Listener exceptions are contained and reported through the configured host telemetry sink. Error records contain normalized bounded data, not guest/provider stacks or host objects.

## Testkit

Testkit is opt-in and single-use:

```ts
import {
  createCapsuleTestAutomation,
  locateCapsuleTestTarget,
} from '@omnidraw/capsule/testkit';

const automation = createCapsuleTestAutomation({
  maxTargets: 128,
  maxScannedElements: 4_096,
  maxResults: 64,
});

const handle = await host.mount({
  artifact: signedArtifactBytes,
  container,
  capabilityBindings: [],
  grants: [],
  testAutomation: automation.attachment,
});

const button = locateCapsuleTestTarget(automation, {
  role: 'button',
  name: 'Save',
  maxResults: 2,
});
console.log(button.target, button.geometry.centerX, button.geometry.centerY);
```

Pass the returned viewport coordinates to the external browser driver when an interaction is required. Testkit itself is read-only: it returns opaque target snapshots and geometry, never the closed `ShadowRoot` or a DOM node, and does not bypass profile or capability policy. Do not attach it in production.

## WebGL and WebGPU adapters

`createDefaultCapsuleBrowserPlatform()` probes and constructs the reviewed native adapters automatically. Use the `webgl` and `webgpu` subpaths only when implementing a custom trusted browser platform or inspecting exact facade limits.

The guest receives the bounded facade selected by its signed profile. Native contexts, devices, buffers, textures, and queues remain host-owned. GPU bytes, object counts, submission rates, and teardown are independently accounted. `canvas-webgl-v1` is the exact reviewed WebGL2 ledger used by the pinned Three.js r185 probe, not ambient WebGL or a claim that arbitrary Three.js scenes are supported.

## Build-runner boundary

`@omnidraw/capsule/build-runner` is for trusted server/CLI code on supported POSIX platforms:

- `ingestCapsuleSourceTree(root, limits, authority)` performs race-resistant, no-follow source ingestion through the reviewed helper;
- `runCapsuleOciBuild(authority, request, limits)` launches the pinned networkless OCI worker;
- `CAPSULE_POSIX_INGEST_HELPER_SOURCE` points to the helper source included in the package.

Both APIs require explicit trusted authority: exact executable/helper identity, paths, hashes, resource ceilings, environment, and platform. They do not discover or trust ambient tools.

## Errors and diagnostics

Expected boundary failures use normalized error classes and stable codes:

- `CapsuleHostError` for host/mount failures;
- `CapsuleBuildError` for build input, transform, and limit failures;
- `CapsuleBuildRunnerError` for ingestion or OCI boundary failures;
- `CapsuleGuestBridgeError` inside guest code.

Log the stable code and bounded message. Do not depend on stack text. For a live instance, `handle.diagnostics()` returns an immutable snapshot of target, authority, budgets, lifecycle state, viewport, queues, resource ledgers, and retained counters. After successful destroy, all live instance-owned counters should be zero.

## Production checklist

- Pin the exact `@omnidraw/capsule` version and lockfile.
- Build from a closed serialized source/dependency snapshot.
- Sign artifacts in a trusted release environment.
- Require the expected public keys and reject untrusted signatures.
- Keep host capability policy empty until a capability is intentionally integrated.
- Grant capabilities and feature profiles separately per mount.
- Default network, GPU, files, clipboard, audio, and dialogs to denied.
- Set finite budgets and narrower per-mount values.
- Virtualize high-population canvases and stay within the 24-live-runtime aggregate policy unless new capacity evidence justifies a different bound.
- Use the default browser platform unless a custom adapter has been reviewed.
- Never attach testkit in production.
- Subscribe to normalized errors and terminal cleanup metrics.
- Destroy every handle and host during application teardown.
- Treat automated construction checks separately from human browser/compatibility acceptance.

## Troubleshooting

`ERR_PACKAGE_PATH_NOT_EXPORTED` means the code imported an unsupported deep path. Use the root or one of the nine supported subpaths.

`capsule:bridge` cannot be resolved means the guest entrypoint was imported by ordinary host code. Include it only in guest source processed by Capsule.

An unsupported target/profile error means the artifact, host target, browser probe, or feature grant does not match exactly. Compare all four rather than widening policy.

A signature-policy failure means the artifact has too few valid trusted signatures, is missing a required key id, or carries a rejected untrusted signature.

A quota error means one effective budget was exhausted. Read the immutable diagnostics, identify the exact dimension, and adjust the smallest relevant bound.

A container-ownership error means another pending or live mount owns that element. Destroy the prior handle and await its cleanup before reuse.

## Versioning and upgrades

The npm version belongs only to `@omnidraw/capsule`. Runtime ABI, artifact schema, DOM profile, feature profiles, capability identities, and snapshot schemas are independent compatibility identifiers and do not change merely because the npm version changes.

Before upgrading:

1. read `CHANGELOG.md`;
2. rebuild and sign guest artifacts with the new trusted toolchain;
3. verify the host target still admits every artifact target;
4. run package, construction, and application tests;
5. verify snapshot migration declarations for parked instances; and
6. obtain human acceptance for any browser/interaction claim.

Unsupported identifiers fail before guest execution rather than being approximated.
