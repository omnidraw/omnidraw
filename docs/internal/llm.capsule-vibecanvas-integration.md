# Capsule integration boundary for Vibecanvas widgets

**Status:** Authoritative consumer-integration profile

**Depends on:** [`llm.capsule-repository.md`](./llm.capsule-repository.md)

**Related investigation:** [`tasks/e/E32.md`](../../tasks/e/E32.md)

This document defines the Vibecanvas-owned code around the consumer-neutral Capsule repository. Nothing in this document belongs inside Capsule production code.

## 1. Decision

Use three explicit ownership boundaries:

1. **Capsule repository:** owns the UI builder, artifact, VM, DOM membrane, generic capabilities, policy, lifecycle, scheduler, and conformance testkit. It has no Vibecanvas dependency or terminology.
2. **Vibecanvas host adapter:** owns artifact publication/selection, widget-to-actor authority, actor transport, canvas lifecycle inputs, host policy, and application capability providers.
3. **Guest SDK and guest code:** `@vibecanvas/sdk` owns the typed ergonomic API. Widget authors import only that package plus normal UI dependencies. Capsule bundles all guest-side code.

The dependency rule is one-way:

```text
Widget source
    |
    v
@vibecanvas/sdk/widget -----> @capsule/guest-bridge
    |                               |
    +----------- bundled -----------+
                    |
                    v
             Capsule UI artifact

Vibecanvas host adapter -----> @capsule/host
Vibecanvas build adapter ----> @capsule/build

Capsule ----------------------> no Vibecanvas dependency
```

The SDK may depend on Capsule's small guest bridge. Capsule MUST NOT depend on the SDK.

## 2. What “guest imports only the SDK” means

Widget application code uses the public Vibecanvas package:

```ts
import { actor } from '@vibecanvas/sdk/widget';

actor.subscribe((snapshot) => {
  // render snapshot.state/context
});

await actor.send('in.save', { title: 'Example' });
```

It may also import React, Vue, CodeMirror, WebGPU helpers, and ordinary npm dependencies. It does not import:

- `@capsule/host`;
- `@capsule/protocol`;
- host APIs or ORPC clients;
- an actor instance ID;
- resource provider IDs;
- a source-injected bridge file;
- Arrow or a Capsule-specific UI framework.

`@vibecanvas/sdk/widget` internally uses `@capsule/guest-bridge`. The Capsule builder bundles both packages and their runtime dependencies into the widget artifact. The artifact has no runtime dependency on an installed `@vibecanvas/sdk` package.

The existing subpath is kept because `@vibecanvas/sdk/actor` is a server-actor authoring surface and should not be pulled into a UI artifact accidentally. A future root export may re-export the widget surface, but it must not merge browser and server runtimes.

## 3. Ownership matrix

| Concern | Capsule | Vibecanvas host/build adapter | `@vibecanvas/sdk` | Widget code |
| --- | --- | --- | --- | --- |
| TypeScript/JSX/Vue/CSS/assets build | Owns generic toolchain | Supplies snapshot, lock, trusted SDK/type overlay, policy | Supplies normal package bytes/types | Supplies source/imports |
| Artifact format/hash/verification | Owns | Stores, publishes, selects | None | None |
| VM, DOM, events, selection, CodeMirror | Owns | Supplies mount container and grants | Uses normal browser APIs | Uses normal browser APIs/frameworks |
| Generic calls/streams/cancel/quotas | Owns | Registers instance-bound providers | Wraps generic bridge in domain API | Calls SDK API |
| Actor identity/authorization | Knows nothing | Owns and captures owning instance | Never accepts a selectable instance ID | Never sees an instance ID |
| Actor protocol semantics | Transports bounded values | Implements server provider and resync source | Implements typed snapshot/send/output semantics | Consumes typed API |
| Actor resources | Knows nothing | Keeps authority in service-actor | Types actor-side portals | Uses actor messages, not resources directly |
| Canvas layout/focus/visibility | Schedules from generic inputs | Converts element state to handle inputs | Receives only intentional props/lifecycle | Renders UI |
| Durable business state | Knows nothing | Actor/Automerge services own it | Exposes typed state/commands | Reads/sends through SDK |
| Security grants | Enforces intersection | Decides grants and creates bindings | Cannot grant itself | Cannot grant itself |
| Errors/metrics/leaks | Classifies and measures kernel | Adds widget/actor context and product telemetry | Converts safe domain errors | May render/report |

## 4. Capsule repository boundary

The standalone Capsule repository exports only generic packages such as:

- `@capsule/build`;
- `@capsule/host`;
- `@capsule/protocol`;
- `@capsule/guest-bridge`;
- `@capsule/testkit`.

It must never import or contain:

- `@vibecanvas/sdk`;
- actor or actor-resource types;
- Automerge canvas types;
- ORPC routes/clients;
- widget manifests or definition database models;
- Vibecanvas capability identifiers;
- widget publication/migration behavior.

Capsule's generic fixture SDK proves the bridge. Vibecanvas tests its own SDK/provider pair in this repository.

## 5. Vibecanvas package boundaries

### 5.1 `packages/sdk`

Keep one public package with environment-specific subpaths:

| Subpath | Runtime | Purpose |
| --- | --- | --- |
| `@vibecanvas/sdk/widget` | Capsule guest VM | Typed actor snapshot/input/output API, lifecycle-safe subscriptions, widget props/outputs |
| `@vibecanvas/sdk/actor` | Headless actor runtime | `fn`/`fx`/`tx`, resource portals, actor function registration |
| internal protocol/build subpaths | Build/host only | Shared wire DTOs, runtime schemas, generated-contract helpers; not normal widget imports |

Required SDK changes:

- remove `@arrow-js/core` from the widget runtime;
- remove Arrow-specific reactive object semantics from the public contract;
- depend on `@capsule/guest-bridge` for transport/lifecycle only;
- expose a framework-neutral readable snapshot plus optional small observable helpers;
- expose actor status, epoch/revision, state, context, error, typed outputs, and send results;
- use declaration merging or generated type augmentation so the normal SDK import becomes definition-specific at build time;
- keep resource portals in the actor subpath, not the widget subpath;
- stop maintaining an Arrow-specific duplicate bridge and global setter API;
- never let SDK arguments select an actor instance, definition, resource ID, provider, filesystem path, or account.

### 5.2 New `packages/capsule-vibecanvas`

Create a consumer adapter package in this repository. It depends on Capsule and Vibecanvas contracts; Capsule never depends on it.

Conceptual modules:

```text
packages/capsule-vibecanvas/
  src/
    build/                 # generic Capsule build request assembly
    contract/              # normalized widget actor contract + typegen
    host/                  # host creation and policy defaults
    capabilities/actor/    # instance-bound actor provider
    capabilities/widget/   # props/outputs if not covered by host defaults
    artifact/              # Vibecanvas definition descriptor mapping
    testkit/               # SDK/provider integration fixtures
```

This package owns application mapping, not VM/DOM mechanics.

### 5.3 `packages/canvas`

Canvas retains only a thin integration layer:

- create the DOM portal/container;
- resolve the pinned widget artifact descriptor;
- create an instance-bound actor capability through `packages/capsule-vibecanvas`;
- call `capsuleHost.mount()`;
- forward rect, size, scale, focus, visibility, distance, occlusion, collapse, and lifecycle state;
- map structured errors/metrics to widget UI and telemetry;
- destroy the Capsule handle with the portal.

Canvas MUST NOT:

- compile TypeScript;
- reconstruct a source file map;
- rewrite SDK import strings;
- inject global bridge functions;
- implement long polling inside guest bootstrap;
- implement DOM patch/event protocols;
- directly expose ORPC clients to guest code;
- own actor replay/cursor logic.

### 5.4 `packages/service-agent` and build orchestration

The draft/publish service remains the trusted orchestrator. It:

1. creates a race-safe immutable definition snapshot;
2. normalizes and validates the actor/widget manifest;
3. generates the canonical actor contract and SDK type augmentation;
4. assembles a generic Capsule build request;
5. supplies `@vibecanvas/sdk/widget` and generated declarations as pinned/provided package inputs;
6. invokes `@capsule/build` in an OS-enforced sandbox;
7. invokes the separate headless actor builder;
8. verifies both artifacts and their shared contract hash;
9. stages source, artifacts, schema, and resource-binding transition plan;
10. changes one published definition-revision pointer transactionally;
11. performs idempotent actor/resource reconciliation with compensating rollback.

Capsule owns compilation and artifact construction. Vibecanvas owns definition consistency, actor compilation, storage, publication, authorization, and rollback.

### 5.5 `packages/service-actor`

The actor service remains outside Capsule. It:

- runs the verified headless actor artifact;
- owns actor lifecycle and durable state;
- validates actor data/input/output schemas at runtime;
- owns resource requirements, bindings, permissions, and concrete providers;
- produces restart-safe epoch/revision snapshots and scoped streams;
- distinguishes accepted, rejected, and optionally processed input results;
- never relies on the browser UI being alive.

If actors are treated as untrusted code, their process/VM/OS isolation is a separate security project. Browser Capsule isolation does not make the actor runtime safe.

## 6. Build contract between Vibecanvas and Capsule

The Vibecanvas build adapter passes only generic inputs:

```ts
const result = await capsuleBuild({
  source: immutableWidgetSnapshot,
  entry: normalizedManifest.widget.entry,
  dependencyLock,
  providedPackages: [
    vibecanvasWidgetSdkPackage,
    generatedWidgetContractTypes,
  ],
  target: {
    runtimeAbi: selectedCapsuleAbi,
    domProfile: selectedDomProfile,
    language: 'tsx',
    frameworkPlugins: selectedTrustedPlugins,
  },
  capabilityRequests: [widgetActorCapabilityRequest],
  requestedBudgets: normalizedManifest.widget.budgets,
  policy: deploymentBuildPolicy,
});
```

Capsule sees package bytes, capability descriptors, schemas, and hashes. It does not see an actor service object or understand the manifest's business meaning.

### 6.1 Required widget manifest section

Vibecanvas adds an explicit UI build/runtime declaration equivalent to:

```ts
type TVibecanvasWidgetUi = {
  runtime: 'capsule-v1';
  entry: string;
  domProfile: string;
  framework?: 'none' | 'react' | 'vue';
  capabilities: readonly string[];
  budgets?: TVibecanvasWidgetBudgetRequest;
  parkability?: {
    enabled: boolean;
    schema?: TJsonSchema;
  };
};
```

This is a Vibecanvas manifest type. It does not move into Capsule. The adapter translates it to Capsule's generic build/artifact types.

### 6.2 Generated contract

One normalized actor contract is the source for:

- actor state-name union;
- actor data/context from `dataSchema`;
- input message name/payload map;
- output message name/payload map;
- resource slot name, kind, requiredness, and permitted scope for actor-side code;
- named DB operation parameter/result types where declared;
- runtime JSON schemas;
- actor/widget contract digest;
- SDK declaration augmentation;
- host actor capability descriptor.

New Capsule definitions require data, input, and output schemas. Legacy definitions may use `unknown`; new definitions may not silently widen to `any`.

### 6.3 SDK type augmentation

The base SDK declares an augmentable contract registry. The build step emits a type-only module augmentation for the ordinary public import, conceptually:

```ts
declare module '@vibecanvas/sdk/widget' {
  interface TWidgetContractRegistry {
    state: TGeneratedState;
    context: TGeneratedContext;
    input: TGeneratedInputMap;
    output: TGeneratedOutputMap;
  }
}
```

Widget code still imports `@vibecanvas/sdk/widget`. The compiler sees generated types; the runtime bundles the normal SDK implementation. The same contract digest is embedded in UI and actor artifacts and checked by the host provider.

## 7. Widget actor capability

### 7.1 Capability identity

Vibecanvas defines a versioned capability identifier and runtime contract in `packages/capsule-vibecanvas`. Capsule treats the identifier as opaque data.

The artifact requests the capability and includes the per-definition contract hash. At mount, the host adapter supplies an instance-bound provider with the same contract hash.

### 7.2 Host-minted authority

The provider closure captures:

- canvas/document authorization context;
- widget element identity;
- owning actor definition revision;
- owning actor instance or a cancellable late-binding resolver;
- actor transport client;
- schema validators and payload limits.

Guest calls never contain a selectable actor/definition/element/account ID. A copied capability handle is valid only inside the same Capsule instance and lifecycle generation.

### 7.3 Snapshot contract

The guest-facing snapshot contains:

```ts
type TWidgetActorSnapshot<TState, TContext> = {
  actorEpoch: string;
  revision: number;
  status: TActorSystemStatus;
  state: TState;
  context: TContext;
  error?: TSdkError;
};
```

An epoch changes whenever monotonic revision continuity cannot be preserved across actor restart/replacement. Clients compare `(actorEpoch, revision)`, not revision alone.

### 7.4 Subscription contract

Opening the actor stream uses one race-free rule:

- server/provider returns an atomic initial snapshot plus cursor and then newer events; or
- provider subscribes first, buffers events, fetches snapshot, and deduplicates by epoch/revision before releasing events.

A snapshot request followed by a separate subscription is forbidden because it loses events in the gap.

If actor creation completes after UI mount, the provider performs one atomic late-bind snapshot/subscription transition. Guest polling by instance ID is forbidden.

### 7.5 Send contract

`actor.send(name, payload, options)` returns a typed result that distinguishes:

- transport failure;
- schema rejection;
- not authorized/not bound;
- accepted and queued;
- optional processed success/failure when requested and supported.

Returning the same message ID for accepted and dropped messages is not an acceptable Capsule-era contract.

### 7.6 Outputs

Actor outputs are typed separately from snapshots. The contract declares whether each output is:

- ephemeral and live-only;
- replayable from a cursor;
- durable until acknowledged.

The SDK does not pretend ephemeral outputs were delivered during freeze/park. The provider and SDK use explicit resync behavior.

### 7.7 Backpressure and teardown

The descriptor declares payload size/depth, send rate, in-flight calls, event queue bytes/count, and overflow mode. State snapshots normally use coalesce-latest; durable outputs use a cursor/acknowledgement contract.

Freeze, park, and destroy:

- Capsule cancels or suspends bridge delivery according to the descriptor;
- the provider detaches/coalesces UI delivery;
- the backend actor continues unless an explicit actor operation changes it;
- resume atomically resynchronizes before reporting ready;
- destroy cancels calls/streams but does not implicitly delete the actor.

## 8. Actor resources

Actor resources remain a server authority boundary:

```text
Widget UI -> typed actor input -> actor fn/fx/tx -> bound KV/DB/secret resource
```

The widget SDK has no direct KV, DB, or secret bridge by default. Generated resource types are used by `@vibecanvas/sdk/actor` so actor functions receive slot-specific portals.

Capsule only sees actor capability calls and validated values. It knows neither resource kind nor binding.

A future direct UI resource API would be a new Vibecanvas capability with:

- a distinct `ui` authority class;
- instance-bound opaque grants;
- operation allowlists and runtime schemas;
- server authorization, quotas, audit, redaction, and revocation;
- an explicit secret policy.

It would not require a Capsule core change, but it must not reuse actor management APIs or expose provider/resource IDs.

Keeping secrets behind the actor is not by itself an anti-egress guarantee: actor code can copy plaintext into state/output. Preventing that requires trusted actors, non-revealing secret operations, or an information-flow policy.

## 9. State ownership

Use one owner per state category:

- Automerge owns canvas document layout and intentionally shared widget UI properties;
- the backend actor owns durable business/resource-backed state;
- Capsule local state owns ephemeral view state, caches, and explicitly scoped preferences;
- Capsule host props carry theme, geometry, scale, visibility, and other host observations.

Do not mirror actor context into Capsule's durable store. Do not persist canvas layout through the actor. Data crossing owners uses typed commands/events and explicit migration/conflict rules.

## 10. Canvas host integration

Create one shared Capsule host/scheduler for the canvas application and one `CapsuleHandle` per hydrated Capsule widget.

`attach-dom-portal.ts` remains responsible for the positioned container. A new thin `mount-capsule.ts` delegates to `packages/capsule-vibecanvas` and Capsule.

Forward at least:

- CSS width/height and canvas scale;
- visible/offscreen/collapsed state;
- distance and priority band;
- occlusion estimate;
- focus and composition state;
- pointer-capture transitions;
- fullscreen/collapse changes;
- destruction.

Capsule decides runtime admission, throttling, freeze, and park within host policy. Canvas may request lifecycle changes but must not manipulate VM internals.

The actor lifecycle is independent. Parking a UI does not pause the actor; deleting the canvas element may destroy the actor only through the existing explicit application lifecycle.

## 11. Artifact delivery and live upgrades

Replace raw `widgetCode` with a runtime descriptor:

```ts
type TWidgetRuntimeDescriptor =
  | {
      kind: 'arrow-v1';
      sourceRevision: string;
      sources: readonly { path: string; content: string }[];
    }
  | {
      kind: 'capsule-v1';
      definitionRevision: string;
      artifactHash: string;
      actorArtifactHash: string;
      actorContractHash: string;
      capsuleAbi: string;
      domProfile: string;
    };
```

During migration, every mounted widget pins a descriptor/artifact hash. Definition publication does not silently change a live instance.

The application selects an explicit policy:

- stay pinned until remount;
- state-preserving UI remount while keeping actor revision/state;
- coordinated actor+UI revision migration;
- rollback to previous descriptor on failure.

Artifact caches key only on verified content hash. Capability bindings and effective grants are always new per mounted instance.

## 12. Error boundary

Capsule returns generic classifications. The Vibecanvas adapter adds safe product context and maps errors to:

- widget definition/revision;
- UI build or actor build;
- artifact fetch/verification;
- Capsule ABI/profile;
- capability denied/contract mismatch;
- actor not bound/transport/schema/resource;
- guest runtime;
- host DOM/policy;
- budget/interrupt;
- lifecycle/restore;
- internal host adapter.

Actor transport errors are never labeled as guest runtime errors. Guest-provided labels and details are bounded and sanitized.

## 13. Integration tests in this repository

Capsule's own suite remains consumer-neutral. Vibecanvas adds tests for:

### SDK/build

- widget source imports only `@vibecanvas/sdk/widget` plus normal dependencies;
- SDK and generated types are bundled with no runtime SDK import;
- actor/UI contract hashes match;
- schema/type drift fails the build;
- preview and publish use identical artifact bytes;
- the distributed binary/sidecar can invoke the isolated builder;
- no browser or actor raw-TypeScript execution.

### Host/provider

- host auto-binds only the owning actor;
- cross-instance/definition/account access is denied;
- late actor creation atomically binds snapshot plus stream;
- restart epoch/revision ordering and gap recovery;
- accepted/rejected/processed send semantics;
- output durability modes;
- payload/rate/in-flight/queue/backpressure limits;
- freeze/park/resume resync;
- UI destroy cancels transport without deleting actor;
- resource errors are structured and direct resources remain denied.

### Canvas/lifecycle

- one artifact fetch/verification per hash;
- offscreen/collapsed widgets are not automatically active;
- focus, composition, pointer capture, fullscreen, and collapse transitions;
- pinned live-instance upgrade/remount/rollback;
- UI-only publication preserves actor state;
- teardown returns Capsule, portal, provider, listener, timer, stream, and handle counters to zero.

### Security

- no SDK import rewrite or injected globals;
- no guest-selected actor/resource IDs;
- contract-hash and grant mismatch rejection;
- actor resource/secret non-exposure at the bridge;
- forged handles and late provider settlement;
- hostile actor behavior tested separately according to the chosen actor trust model.

## 14. Migration sequence

### Phase 0 - create independent Capsule repo

- move the consumer-neutral repository specification into the new repo unchanged;
- scaffold public packages and forbidden-consumer dependency/name checks;
- implement Capsule Gate 0A and 0B with `@fixture/sdk`;
- release development versions of protocol/build/host/guest-bridge/testkit.

### Phase 1 - SDK and contract adapter

- add `@capsule/guest-bridge` to `packages/sdk`;
- define the augmentable widget contract and new snapshot/send/output API;
- add actor contract normalization/type generation;
- implement the instance-bound actor provider in `packages/capsule-vibecanvas`;
- keep Arrow widget runtime unchanged as fallback.

### Phase 2 - artifact pipeline

- add definition revisions and separate UI/actor artifact hashes;
- add isolated Capsule UI and headless actor builds;
- use the same artifact for preview and publish;
- add storage, delivery, verification, retention, and rollback.

### Phase 3 - canvas dual runtime

- add the runtime descriptor union and Capsule mount path;
- create the shared host/scheduler;
- forward portal lifecycle/geometry inputs;
- pin live instances and add explicit remount/rollback;
- enable Capsule per definition/feature flag.

### Phase 4 - compatibility adoption

- migrate static/default widgets;
- adopt React/Vue profiles;
- adopt editing/CodeMirror;
- adopt WebGPU;
- measure active/frozen/parked scale and leaks.

### Phase 5 - subtraction

After every supported definition is rebuilt and rollback exists:

- remove raw `widgetCode` delivery;
- remove browser TypeScript compilation;
- remove SDK string rewriting and injected actor bootstrap;
- remove unbounded long polling/global client-side routing;
- remove Arrow dependencies and `arrow-v1` only when its support window closes.

## 15. Acceptance criteria

The boundary is complete when:

- the Capsule repository builds/tests/releases with no Vibecanvas checkout, imports, names, schemas, or services;
- a widget imports only `@vibecanvas/sdk/widget` plus ordinary dependencies;
- the SDK, frameworks, and dependencies are contained in a verified UI artifact;
- the host mounts with a container, artifact, grants, budgets, provider bindings, and lifecycle inputs only;
- Canvas contains no compiler, bridge loop, guest bootstrap, or DOM protocol;
- Capsule contains no actor/resource/Automerge/ORPC knowledge;
- actor authority is host-minted and instance-bound;
- actor schemas/types/contract hash agree across UI, host provider, and actor artifact;
- actor resources remain server-side unless a separate UI capability is explicitly designed;
- preview/publish/live-upgrade/rollback semantics are revisioned and tested;
- UI and actor raw TypeScript execution is removed for Capsule definitions;
- native framework/editor/WebGPU, security, lifecycle, scale, and leak gates pass.

---
