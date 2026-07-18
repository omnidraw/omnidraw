# Capsule standalone repository specification

**Status:** Authoritative project-seeding specification

**Scope:** A consumer-neutral repository that builds, runs, secures, schedules, and tests sandboxed browser UI artifacts.

**Normative terms:** **MUST**, **SHOULD**, and **MAY** describe required, recommended, and optional behavior.

**Initial release gates:** TypeScript, React, Vue, unmodified CodeMirror 6, WebGPU, generic host capabilities, deterministic artifacts, and independent browser conformance tests.

## 1. Product definition

Capsule is an embeddable, iframe-free UI sandbox. It compiles a guest application and all of its runtime dependencies into an immutable artifact, evaluates all guest JavaScript inside an interruptible VM, and exposes host-owned browser facilities through checked capability membranes.

Capsule is a library, toolchain, artifact format, runtime, policy engine, scheduler, and test laboratory. It is not an application framework and it does not know the business model of any consumer.

The core rule is:

> Capsule owns execution and mediation. The application host owns authority. A consumer SDK owns business semantics. Guest application code owns only UI behavior.

Capsule MUST be buildable, testable, versioned, and released without checking out or importing a consumer repository.

## 2. Goals

Capsule MUST:

- build TypeScript/JavaScript, JSX, supported framework files, CSS, and assets before runtime;
- bundle the guest application, framework, consumer SDK, and dependencies into a self-contained artifact;
- execute no raw TypeScript in the browser;
- run guest JavaScript outside the host JavaScript realm;
- keep real DOM, WebGPU, file, clipboard, audio, network, and storage objects in the trusted host realm;
- provide a synchronous, host-backed DOM facade capable of editor-grade event, selection, layout, and observer behavior;
- provide a generic typed capability ABI for arbitrary consumer SDKs and host providers;
- enforce CPU, memory, DOM, handle, message, stream, asset, network, GPU, and lifecycle budgets;
- support active, throttled, frozen, parked, resumed, and destroyed instances;
- make teardown deterministic and observable;
- provide native-versus-Capsule differential tests and hostile-input tests;
- keep ordinary guest application code unaware of Capsule when it only uses standard browser APIs and its consumer SDK.

Capsule SHOULD contain enough bridge, lifecycle, validation, scheduling, error, and telemetry behavior that consumers do not rebuild transport loops or sandbox internals.

## 3. Non-goals

Capsule does not:

- define consumer business objects, accounts, resources, databases, secrets, or application authorization;
- choose which business object a mounted guest may access;
- publish or migrate consumer data;
- grant authority from artifact metadata;
- expose arbitrary host objects or host module imports;
- execute guest package installation scripts or guest bundler plugins;
- promise every browser API in the first release;
- treat a closed ShadowRoot as a code-security boundary;
- make a consumer SDK trusted merely because it is bundled;
- guarantee information-flow safety inside a capability provider or consumer SDK;
- use framework patches as a compatibility strategy.

## 4. Independence invariant

The standalone repository MUST satisfy all of these rules:

1. Production packages import only packages from this repository and explicitly approved upstream dependencies.
2. Tests and fixtures use neutral example names and local fixture SDKs.
3. No source package imports a consumer SDK, consumer host adapter, consumer schema, or consumer service.
4. No production switch statement recognizes a consumer capability identifier.
5. Consumer-specific type generation happens outside this repository.
6. A CI check scans production source, tests, examples, package metadata, and generated artifacts for a configurable forbidden-consumer-name list.
7. The repository's complete test suite runs with no consumer service, database, API, or source tree.

A consumer integrates by depending on Capsule. Capsule never depends on the consumer.

## 5. Trust zones

| Zone | Trust | Responsibility |
| --- | --- | --- |
| Application host | Trusted for application policy | Chooses artifact, mount container, capability bindings, grants, budgets, and lifecycle hints |
| Capsule host runtime | Trusted security kernel | Verifies artifact, owns VM/DOM objects, validates operations, enforces policy, schedules and tears down |
| Capability provider | Trusted according to host policy | Implements one consumer-defined capability behind an instance-bound interface |
| Artifact | Untrusted | Contains guest program, SDK, frameworks, CSS, assets, and requested capabilities |
| Guest VM | Untrusted | Executes application and SDK code with only granted facades/capabilities |
| Browser-owned subsystems | Partially trusted platform | DOM/layout, GPU process, audio, clipboard, file handles, network stack |
| Build input | Untrusted | Source files, manifests, dependency metadata, assets, and generated package overlays |
| Builder/compiler plugins | Trusted infrastructure | Pinned by the build service; never selected or executed from guest input |

The consumer SDK runs inside the guest VM. It improves ergonomics and types but cannot grant itself authority.

## 6. Boundary model

There are four interfaces and no hidden fifth interface:

1. **Build interface:** a trusted caller passes an immutable source snapshot, lock data, provided packages, and build policy to the Capsule builder.
2. **Artifact interface:** the builder emits a consumer-neutral immutable artifact and diagnostics.
3. **Host interface:** a trusted host mounts an artifact with a container, policy, capability bindings, budgets, and lifecycle inputs.
4. **Guest bridge interface:** bundled SDK code calls generic capability operations through the Capsule guest ABI.

Application-specific messages MUST travel through a registered capability contract. The host MUST NOT inject ad hoc globals, rewrite arbitrary strings, or patch guest object prototypes to simulate missing business APIs.

## 7. Repository dependency direction

The required dependency direction is:

```text
protocol/artifact/schema
        ^
        |
vm  dom-guest  dom-host  policy  scheduler  capability-kernel
        ^          ^                  ^
        |          |                  |
        +----------+------------------+
                           |
                          host

protocol/artifact/schema <- build
protocol/artifact/schema <- guest-bridge
host + build + guest-bridge <- testkit
```

Rules:

- `protocol`, `artifact`, and schema packages MUST be environment-neutral and side-effect-free.
- `dom-guest` MUST NOT import `dom-host`.
- `dom-host` MUST NOT import a consumer adapter.
- `guest-bridge` MUST NOT import `host`.
- `build` MUST NOT import the browser host runtime.
- feature packages depend on protocol and narrow host/guest interfaces, not on framework packages.
- React, Vue, and CodeMirror appear only in fixtures/compatibility packages, never in the security kernel.

## 8. Public package surface

The conceptual public packages are:

| Package | Audience | Responsibility |
| --- | --- | --- |
| `@capsule/protocol` | Host adapters, builders, tools | Stable types and runtime schemas for artifacts, policies, errors, capabilities, lifecycle, traces |
| `@capsule/build` | Trusted build service | Deterministic dependency resolution, compilation, bundling, artifact generation, verification |
| `@capsule/host` | Trusted browser host | Host creation, artifact cache, capability registration, mount, lifecycle, diagnostics |
| `@capsule/guest-bridge` | Consumer SDK maintainers | Small framework-neutral client for calls, streams, outputs, lifecycle, props, and local observables |
| `@capsule/testkit` | Capsule and consumer integration tests | Neutral capability fixtures, native differential harness, fake providers, trace assertions |

Internal packages MAY be separately published for development, but consumers MUST NOT need to assemble the VM, DOM membrane, scheduler, or capability router themselves.

Ordinary guest application authors SHOULD NOT import `@capsule/guest-bridge`. Their consumer SDK may use it internally and is bundled into the artifact.

## 9. Build contract

### 9.1 Build input

The builder accepts a serializable request equivalent to:

```ts
type CapsuleBuildRequest = {
  source: Readonly<{
    rootId: string;
    files: readonly CapsuleSourceFile[];
    revision: string;
  }>;
  entry: string;
  dependencyLock: CapsuleDependencyLock;
  providedPackages?: readonly CapsuleProvidedPackage[];
  target: {
    runtimeAbi: string;
    domProfile: string;
    language: 'js' | 'ts' | 'jsx' | 'tsx';
    frameworkPlugins?: readonly CapsuleTrustedPluginId[];
  };
  capabilityRequests: readonly CapsuleCapabilityRequest[];
  requestedBudgets: CapsuleBudgetRequest;
  policy: CapsuleBuildPolicy;
};
```

`providedPackages` is the generic injection point for a consumer SDK, generated declaration overlay, or other host-owned build input. A provided package is ordinary package bytes plus package metadata and integrity; Capsule does not interpret its name or semantics.

### 9.2 Snapshot rules

The source snapshot MUST:

- have stable normalized paths;
- reject absolute paths, traversal, duplicate normalized paths, NULs, case-collision ambiguity, and all symlinks;
- be read and hashed with no-follow, race-safe semantics;
- include byte, file-count, depth, and per-file limits;
- identify the complete dependency lock and provided-package hashes;
- remain immutable for the duration of the build.

### 9.3 Build isolation

A service accepting hostile input MUST run the builder inside an OS-enforced sandbox, container, or equivalent boundary with:

- read-only source and dependency inputs;
- a fresh isolated output directory;
- no network during compilation;
- no inherited secrets or ambient credentials;
- no package install scripts;
- no guest configuration code or guest-selected plugins;
- CPU, wall-clock, memory, process, file, and output-byte limits;
- deterministic locale, timezone, environment, and toolchain versions.

An ordinary worker or child process without OS restrictions is not a hostile-build boundary.

### 9.4 Resolution and bundling

The builder MUST:

- resolve a pinned dependency graph without executing modules for metadata discovery;
- type-check and compile supported TypeScript/JavaScript inputs;
- support JSX and Vue SFCs only through pinned trusted plugins;
- bundle all guest runtime code, including consumer SDK and framework code;
- reject unresolved runtime imports, Node built-ins, native addons, runtime `require`, undeclared workers, and unsupported guest WebAssembly;
- extract and policy-tag CSS and binary assets;
- preserve stable virtual source names and source maps;
- emit deterministic bytes for identical inputs/toolchain;
- report every dependency version and transform version;
- never evaluate guest output in the host realm.

The final guest module graph may depend only on the versioned Capsule VM bootstrap ABI. It MUST NOT perform runtime npm resolution or fetch raw source.

### 9.5 Artifact envelope

An artifact contains:

- manifest version and artifact hash;
- versioned execution-target payload;
- entry module and module/chunk hashes;
- parsed/scoped CSS payloads;
- binary asset table and hashes;
- source maps and normalized diagnostics metadata;
- exact dependency and trusted-transform digests;
- Capsule runtime ABI, DOM profile, and optional feature profile versions;
- requested/required capabilities and contract hashes;
- requested/default CPU, memory, DOM, message, stream, asset, GPU, and lifecycle budget maxima;
- parkability declaration and snapshot schema digest;
- build toolchain identity and reproducibility metadata.

The artifact declares requests and maxima. It never contains effective grants or mount authority.

### 9.6 Artifact verification

The host MUST verify before guest evaluation:

- envelope and schema version;
- content hash and optional signature policy;
- every referenced chunk/asset hash;
- runtime ABI/profile compatibility;
- capability contract compatibility;
- size/count limits;
- requested policy intersection;
- absence of undeclared payloads.

Artifacts SHOULD be content-addressed and cached by verified hash. Cache hits MUST NOT reuse mount-specific grants, provider bindings, or state.

## 10. Guest authoring contract

### 10.1 Ordinary application code

Ordinary guest code may import:

- its consumer SDK;
- normal application dependencies;
- supported React, Vue, CodeMirror, rendering, and utility packages;
- local modules and assets.

It does not need to import Capsule to use supported browser APIs or its consumer SDK. The build includes everything the guest requires, including the SDK's guest-side bridge implementation.

The guest MUST NOT receive a host-generated JavaScript source string, raw host function, or mutable host object.

### 10.2 Consumer SDK contract

A consumer SDK may depend on `@capsule/guest-bridge` and expose any business-friendly API it chooses. The generic bridge provides:

- capability discovery by ID/version/contract hash;
- bounded request/response calls;
- bounded streams with cancellation and backpressure;
- structured outputs to the host;
- host props and prop-change subscription;
- lifecycle notifications;
- framework-neutral readable state helpers;
- normalized errors and diagnostics.

The consumer SDK owns:

- business names and domain types;
- generated TypeScript declarations;
- domain validation beyond the generic boundary schema;
- reconnect, snapshot, cursor, acknowledgement, and conflict semantics specific to its service;
- framework-specific ergonomic wrappers if desired.

Capsule owns transport, serialization, quotas, cancellation, stream cleanup, lifecycle delivery, and error containment.

### 10.3 Reserved guest ABI

The builder may compile `@capsule/guest-bridge` to a reserved versioned intrinsic such as `capsule:bridge`. This intrinsic is the only non-bundled guest import and is provided by the VM bootstrap.

The intrinsic exposes no application authority by itself. It can only address capability bindings granted to the current instance and validates contract/version/operation on every call.

## 11. Generic capability model

### 11.1 Capability descriptor

A capability is identified by an opaque reverse-domain-style ID, semantic version range, and contract hash. Capsule treats the identifier as data.

A descriptor contains:

- callable operation names with input/output runtime schemas;
- stream names with input/event schemas;
- operation mode and idempotency metadata;
- payload/depth/rate/in-flight/queue limits;
- stream overflow behavior: reject, disconnect, coalesce-latest, or bounded lossless;
- lifecycle behavior for freeze, park, resume, and destroy;
- optional opaque handle types and their permitted operations;
- normalized error-code schema.

TypeScript types are not a runtime security boundary. Runtime schemas and generic byte/depth limits are mandatory.

### 11.2 Capability request, grant, and binding

Authority is the intersection of:

1. artifact request;
2. host-wide policy;
3. mount-time grant;
4. an instance-bound provider binding.

Missing any one of these denies access.

The artifact cannot grant a capability. A package import cannot grant a capability. Knowing a capability ID cannot grant a capability.

### 11.3 Instance-bound provider

At mount, the host may provide a binding equivalent to:

```ts
type CapsuleCapabilityBinding = {
  descriptor: CapsuleCapabilityDescriptor;
  invoke(context: CapsuleCallContext, operation: string, input: unknown): Promise<unknown>;
  openStream?(context: CapsuleStreamContext, stream: string, input: unknown): CapsuleHostStream;
  onLifecycle?(event: CapsuleProviderLifecycleEvent): void | Promise<void>;
  dispose(): void | Promise<void>;
};
```

The provider closure owns application authority. If the guest should access only one object, the binding captures that object; the guest does not submit a global object ID and ask Capsule to authorize it.

Capsule supplies each call with:

- instance-local capability handle;
- operation metadata;
- deadline and `AbortSignal`;
- remaining generic quota view;
- trace/correlation identifier;
- lifecycle generation.

Capsule never supplies consumer account, document, service-object, or resource identities because it does not know them.

### 11.4 Calls

For every call Capsule MUST:

- verify instance, capability, version, contract, and operation;
- validate input shape plus byte/depth/count limits;
- enforce rate, concurrency, and deadline policy;
- create an abortable provider invocation;
- validate and bound the output;
- normalize provider failures without leaking host prototypes/stacks/secrets;
- reject late settlements after generation change or disposal;
- record structured metrics and trace events.

### 11.5 Streams

Streams MUST have:

- explicit open, event, error, close, and cancel states;
- bounded queues and bytes;
- declared overflow behavior;
- one lifecycle generation owner;
- cancellation on destroy and according to the descriptor on freeze/park;
- no delivery into a non-runnable guest;
- resumable semantics only when the consumer contract defines a cursor/snapshot rule.

Capsule provides the mechanics. It does not invent domain replay semantics.

### 11.6 Opaque handles

Every host-backed handle validates:

- instance owner;
- capability owner;
- handle type;
- generation;
- lifetime/disposed state;
- permitted operation;
- relevant quotas.

Cross-instance handles, stale handles, forged identifiers, use-after-free, and type confusion are mandatory abuse tests.

## 12. Host API

The conceptual host API is:

```ts
const host = await createCapsuleHost({
  runtimePolicy,
  artifactCache,
  telemetry,
  browserPlatform,
});

const handle = await host.mount({
  artifact,
  container,
  capabilityBindings,
  grants,
  budgets,
  initialProps,
  lifecycle,
  restoreSnapshot,
});
```

The exact names may change; the ownership may not.

### 12.1 Capsule host responsibilities

The host runtime owns:

- artifact verification and cache deduplication;
- VM creation, module loading, deadlines, jobs, and disposal;
- DOM root creation and all browser-object tables;
- policy intersection and capability routing;
- standard platform capabilities;
- stream/call lifecycle and serialization;
- scheduling, freeze, park, resume, and memory-pressure response;
- error classification, metrics, traces, and leak counters;
- deterministic cleanup after guest/provider failure.

### 12.2 Application host responsibilities

The application host owns only:

- selecting a verified artifact;
- selecting the mount container;
- deciding grants and budgets within deployment policy;
- creating instance-bound application capability providers;
- sending props, theme values, geometry, visibility, priority, and occlusion hints;
- deciding application-specific upgrade, persistence, and data-lifecycle policy;
- handling structured outputs/errors/metrics.

The application host SHOULD NOT implement VM polling, guest promise settlement, message queues, capability serialization, DOM patches, event emulation, or sandbox cleanup.

### 12.3 Capsule handle

The returned handle supports:

- `ready()`;
- `setProps(value)`;
- `setTheme(tokens)`;
- `setViewport({ width, height, scale, visibility, distance, priority, occlusion })`;
- `focus(options)`;
- `freeze(reason)`;
- `resume(reason)`;
- `park(snapshotRequest)`;
- `snapshot()`;
- `destroy(reason)`;
- structured output/error/lifecycle/metrics subscriptions;
- diagnostics and leak counters.

No method exposes the VM object, real guest nodes, host object tables, or provider internals.

## 13. VM and scheduling contract

### 13.1 Execution model

- Each mounted instance has a separate VM runtime and heap.
- The DOM-compatible VM is entered synchronously on the browser main thread.
- The host owns the real DOM and invokes guest callbacks through generated facades.
- Every guest entry has an execution deadline and interrupt source.
- Boot, module evaluation, event callbacks, timers, animation callbacks, microtasks, observer callbacks, capability settlements, stream delivery, and teardown hooks are all budgeted entries.
- Pending job draining is bounded by deadline and job count.
- A host bridge operation must itself be bounded because a VM interrupt cannot preempt an unbounded host function.

### 13.2 Reentrancy

Capsule MUST define and test nested event/callback entry. Reentrant entry may occur through focus, click, selection, form controls, observers, or host capability settlement.

The implementation MUST prevent:

- use of expired event objects;
- settlement into the wrong execution frame;
- lifecycle transition during an unsafe critical section;
- stale-handle reuse after nested disposal;
- queue corruption under nested synchronous calls.

### 13.3 Lifecycle states

- **Active:** normal input, frames, timers, streams, and capabilities within budget.
- **Throttled:** reduced frames/timers and optional stream coalescing.
- **Frozen:** no guest execution; host retains VM/DOM according to memory policy; provider behavior follows descriptors.
- **Parked:** VM is destroyed after a declared serializable snapshot; arbitrary heaps are not implicitly serializable.
- **Destroyed:** all guest, DOM, provider, handle, timer, stream, asset, GPU, and observer state is permanently released.

Freeze and park do not invent consumer-service lifecycle semantics. Providers and consumer SDKs receive lifecycle signals and implement domain-specific resynchronization.

## 14. DOM compatibility membrane

### 14.1 Core model

- Browser objects remain in the host realm.
- Guest objects are reviewed prototype facades backed by opaque handles.
- The DOM root is a host-created closed ShadowRoot.
- Every topology operation checks root containment.
- Guest code receives stable wrapper identity for a live host object.
- Host and guest prototypes never cross the membrane.

### 14.2 Synchronous behavior

The required synchronous surface includes:

- element/text creation and tree mutation;
- properties and attributes;
- event registration, dispatch, propagation, and cancellation;
- focus and pointer capture;
- selection and range operations;
- layout reads and geometry;
- contenteditable and form state;
- MutationObserver and ResizeObserver ordering;
- animation-frame scheduling;
- supported CSSOM operations.

The architecture is rejected if a guest `preventDefault()` cannot affect the real native event before the host listener returns.

### 14.3 Security policy

Profiles deny by default:

- scripts, frames, navigation, popups, downloads, custom-element constructors, top-layer escape, fullscreen, pointer lock, and uncontrolled portals;
- unsafe URL attributes/properties and CSS fetches;
- access outside the root;
- host custom-element registries and ambient host globals.

CSS is parsed and policy-checked rather than assigned as an unreviewed trust boundary.

## 15. Standard capability profiles

Capsule implements standard capabilities generically:

- DOM/events/selection/layout/observers;
- timers and animation frames;
- policy-controlled fetch/network;
- files, blobs, drag/drop, and clipboard;
- sound-effect-oriented audio;
- local guest store and optional host journal adapter;
- canvas and WebGPU;
- structured host props and outputs.

Every profile has:

- a versioned support ledger;
- generated facade bindings from pinned Web IDL plus reviewed overrides;
- explicit denied members;
- operation and resource budgets;
- lifecycle behavior;
- conformance, abuse, and teardown tests.

## 16. Framework and editor gates

### 16.1 Frameworks

React and Vue fixtures use normal upstream packages, normal imports, and normal mounting APIs. Capsule may compile and bundle them but MUST NOT patch their installed package bytes or require consumer adapters.

Acceptance covers:

- initial mount/update/unmount;
- delegated/direct events;
- properties versus attributes;
- forms and controlled inputs;
- focus and selection;
- portals only within explicitly allowed confined roots;
- timers, microtasks, observers, and animation frames;
- error boundaries and teardown.

### 16.2 CodeMirror

Unmodified CodeMirror 6 is the highest DOM release gate. Tests include:

- typing, deletion, selection, composition/IME, clipboard, undo/redo;
- contenteditable mutation reconciliation;
- focus transitions and pointer selection;
- layout/scrolling/measurement;
- MutationObserver and ResizeObserver behavior;
- accessibility tree and keyboard navigation;
- freeze/resume and deterministic teardown.

The first architecture fixture is intentionally smaller: one editor, one character, correct `beforeinput`, selection, DOM mutation observation, and no leak.

### 16.3 WebGPU

WebGPU uses host-owned objects and generation-checked guest handles. The profile defines adapter/device requests, feature/limit filtering, buffers/textures/pipelines, mapped-memory copy rules, command submission, frame throttling, device loss, freeze, and disposal.

The guest never receives a host GPU object. Copy, command, frame, and retained-resource budgets are mandatory.

## 17. Security model

### 17.1 Required controls

- deny-by-default profile/member/capability policy;
- separate VM runtime and memory limits per instance;
- interruption on every guest entry path;
- root-confined DOM topology;
- owner/type/generation/lifetime checks for handles;
- bounded structured values, buffers, errors, calls, and streams;
- parsed URL/CSS policy;
- no ambient network, clipboard, files, audio, GPU, or storage;
- mount-time authority intersection;
- deterministic teardown and late-settlement rejection;
- build isolation distinct from runtime isolation;
- structured security violations without guest-controlled host logs/stacks;
- independent security review before production claims.

### 17.2 Honest limits

- A main-thread VM is not an OS process boundary.
- Browser and VM vulnerabilities remain possible.
- A granted provider can intentionally expose sensitive data.
- A consumer SDK can copy any data it legitimately receives into another granted channel.
- Timing and resource side channels are reduced, not eliminated.
- Already-submitted GPU work cannot always be preempted.

Capsule guarantees mediation and budget enforcement at its boundary. It does not claim semantic safety for provider business logic.

## 18. Errors and observability

Errors are classified as:

- build input;
- dependency resolution;
- compile/bundle;
- artifact verification;
- ABI/profile mismatch;
- capability denied/contract mismatch;
- provider/transport;
- guest runtime;
- DOM/policy;
- budget/interrupt;
- lifecycle/snapshot/restore;
- host platform/internal.

Every instance exposes bounded diagnostics:

- artifact/profile versions;
- lifecycle generation/state;
- entry counts and execution time;
- memory and handle counts;
- DOM/listener/observer/timer counts;
- call/stream queue and byte counts;
- capability denials/errors;
- GPU/assets retained;
- teardown before/after counters.

Guest-supplied labels are sanitized and cardinality-limited.

## 19. Independent conformance repository

The repository contains no consumer fixtures. Required neutral fixtures are:

1. static DOM;
2. form and synchronous cancellation;
3. generic counter capability through `@fixture/sdk`;
4. capability stream with coalescing/backpressure/cancel;
5. React application;
6. Vue application;
7. editing primitives;
8. minimal and full CodeMirror;
9. WebGPU triangle and device-loss fixture;
10. freeze/park/resume population and leak soak;
11. hostile build inputs;
12. hostile runtime/DOM/handle/capability inputs.

The `@fixture/sdk` guest imports only its own public SDK. That SDK depends internally on `@capsule/guest-bridge`. The matching host fixture registers a generic capability binding. This proves the consumer boundary without naming or importing a real consumer.

### 19.1 Differential tests

The same fixture runs:

- natively in the browser; and
- as a Capsule artifact.

The harness compares DOM, events, cancellation, focus, selection, layout tolerances, observer ordering, outputs, screenshots where useful, errors, and teardown counters.

### 19.2 Browser matrix

CI has explicit Chromium, Firefox, and WebKit lanes for supported profiles. Device/IME and GPU tests may use dedicated hardware lanes but remain release gates for their declared platform matrix.

### 19.3 Builder tests

- deterministic rebuild hashes;
- source-map stability;
- dependency lock and transform drift;
- provided-package bundling;
- no runtime external imports except the ABI intrinsic;
- path/symlink/file/byte limits;
- install-script/config/plugin non-execution;
- no-network sandbox;
- timeout/OOM/process-limit behavior;
- artifact tamper and incompatible-profile rejection.

### 19.4 Capability tests

- request/grant/binding intersection;
- contract hash/version mismatch;
- input/output schema failure;
- bytes/depth/rate/concurrency limits;
- stream overflow modes and cancellation;
- freeze/resume/destroy behavior;
- provider timeout/abort/late settlement;
- cross-instance and stale-handle rejection;
- teardown with provider failures.

## 20. Repository shape

```text
capsule/
  package.json
  lockfile
  packages/
    protocol/          # environment-neutral schemas/types
    artifact/          # envelope, hashing, verification
    build/             # compiler, bundler, trusted plugins
    vm/                # runtime adapter, module loader, interrupts
    dom-guest/         # reviewed guest DOM prototypes/facades
    dom-host/          # browser objects, events, selection, CSS policy
    policy/            # policy intersection and quotas
    scheduler/         # entries, visibility, freeze/park
    capability-kernel/ # generic calls, streams, handles, cancellation
    host/              # small public host API
    guest-bridge/      # small public SDK-author API
    webgpu/            # generic WebGPU profile
    files/             # generic file/clipboard profile
    audio/             # generic audio profile
    store/             # optional generic local/journal primitives
    testkit/           # public integration/differential harness
  fixtures/
    sdk/
    static-dom/
    forms/
    react/
    vue/
    editing/
    codemirror/
    webgpu/
    capability/
  apps/
    lab/               # interactive compatibility/trace explorer
  benchmarks/
  security/
  docs/
```

Start with fewer packages if that accelerates Phase 0, but preserve the public boundaries. Splitting files into packages must not precede evidence for a real boundary.

## 21. Versioning

Version independently:

- host public API;
- build request schema;
- artifact envelope;
- VM bootstrap ABI;
- DOM profile;
- standard feature profiles;
- capability descriptor/bridge protocol;
- snapshot/restore schema;
- trace format.

An artifact declares compatible ranges. The host rejects incompatible artifacts before evaluating guest code.

Capability descriptors use semantic versions plus a contract hash. A host may provide multiple compatible versions without changing Capsule core.

## 22. Construction gates

### Gate 0A - architecture falsification

Prove synchronous real-event cancellation, nested event reentrancy, node identity/root confinement, contenteditable-to-observer ordering, selection/range geometry, every-entry interruption, and zero-leak teardown in a real browser.

Stop if synchronous cancellation, safe reentrancy, or bounded interrupt latency cannot be achieved.

### Gate 0B - artifact and consumer-SDK skeleton

Build a TypeScript guest that imports only `@fixture/sdk`. Bundle the SDK, compile its generic bridge to the ABI intrinsic, emit deterministic artifact bytes, mount it with a generic host provider, and verify request/grant/binding intersection.

### Gate 1 - security kernel

Complete artifact verification, handle tables, topology policy, schema/value limits, capability router, scheduler, lifecycle generations, CSS/URL policy, and teardown counters.

### Gate 2 - DOM core and standard UI

Pass static DOM, forms, events, props/outputs, local store, observers, focus, and lifecycle tests.

### Gate 3 - Vue and React

Pass unmodified pinned upstream packages and native differential suites.

### Gate 4 - editing and CodeMirror

Pass editing primitives, IME/accessibility, minimal editor, then full release fixture.

### Gate 5 - WebGPU and remaining standard capabilities

Pass graphics, file, clipboard, audio, network, resource, lifecycle, and device-loss policies.

### Gate 6 - scale and production hardening

Pass active/throttled/frozen/parked population tests, long-running leak soak, browser matrix, independent security review, release/recovery drills, and compatibility documentation.

## 23. Definition of done

Capsule 1.0 is complete only when:

- the independence invariant passes in CI;
- a consumer SDK can be bundled and bridged without Capsule changes;
- ordinary guest code needs no Capsule import;
- the host integration requires only artifact/container/policy/provider/lifecycle inputs;
- no raw TypeScript or runtime package resolution occurs in the browser;
- artifacts are deterministic, content-addressed, verified, and self-contained;
- every capability is request/grant/binding constrained and budgeted;
- synchronous DOM/event architecture gates pass;
- unmodified pinned React, Vue, CodeMirror, and WebGPU fixtures pass their declared matrix;
- freeze, park, resume, destroy, interruption, and provider failure are leak-free;
- abuse, fuzz, differential, performance, and security-review gates pass;
- public APIs, protocols, profiles, support ledger, and migration policy are versioned and documented.

## 24. Consumer integration checklist

A consumer is correctly separated when:

- its guest application imports only its SDK and normal dependencies;
- its SDK is bundled and calls only the generic guest bridge internally;
- its host adapter registers generic capability descriptors/providers;
- provider bindings capture authority instead of accepting arbitrary global IDs from the guest;
- its builder supplies SDK/generated packages through generic build inputs;
- its host never injects global functions or rewrites raw guest source strings;
- Capsule source contains no consumer names, types, routes, schemas, or service imports;
- consumer business state and migrations remain outside Capsule;
- consumer integration tests use `@capsule/testkit` but do not become Capsule's core conformance suite.

---
