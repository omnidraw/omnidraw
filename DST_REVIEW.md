# Deterministic simulation testing review

This is a post-implementation audit of backend deterministic simulation
testing (DST). It complements the requirements in
[`docs/PRD.md`](docs/PRD.md) and the architecture rules in
[`docs/internal/llm.app-architecture.md`](docs/internal/llm.app-architecture.md).

## Executive result

The repository has a useful deterministic runtime, controlled capability
fixtures, canonical traces, strict trace comparison, and shared live/sim
conformance. It does not yet provide bounded distributed-schedule exploration
or self-contained replay for every controlled input.

Verified on 2026-08-13:

- `bun test apps/backend/src/sim`: **11 passed, 0 failed**.
- `bun run test:backend:conformance`: **74 passed, 0 failed**.
- A 100-seed sweep of the widget publication model selected both explicit
  branches (40/60), but produced one final state.
- A 20-seed fork/yield sweep through the default `createSimulationRuntime`
  produced one observable order across all seeds.
- With `stepBound: 1`, a program completed 1,000 `Effect.yieldNow`
  continuations and recorded 1,000 scheduler choices but zero bounded steps.
- Replay accepted a changed scripted function result (`1` to `999`) when the
  scenario retained only its `success` status.
- Replay also accepted a scripted network change from `deliver` to `delay(0)`;
  the recorded network steps were identical.
- A record declaring only `logicalNodes: ["declared"]` accepted and recorded a
  network node and process node with different, undeclared identities.

These results distinguish qualification from exploration. The green tests
prove that the supplied layers behave deterministically for their covered
paths. They do not prove that seed sweeps explore materially different fiber
schedules, that a bound terminates all simulated execution, or that a record
alone reproduces every controlled input.

## Findings

### DST-1 — The default runtime does not accumulate runnable peers for schedule exploration — P1

[`SeededSimulationScheduler`](apps/backend/src/sim/scheduler.ts) defaults
`autoFlush` to `true`.
[`createSimulationRuntime`](apps/backend/src/sim/runtime.ts) does not expose the
option, so scheduling a task normally drains that dispatcher's queue
synchronously before sibling work can accumulate.

The scheduler can choose among already queued same-priority tasks, and the
qualification tests correctly verify that behavior by constructing it with
`autoFlush: false`. The default simulation runtime is different: the 20-seed
fork/yield audit always ran the child through its yield before the parent
continued past the fork. It also has no global choice across runnable
dispatchers; `flush()` drains each dispatcher separately in creation order.

This does not make the scheduler nondeterministic or incorrect as an Effect
scheduler seam. It means `rootSeed` is currently effective mainly for explicit
`world.choose` calls, not as a broad fiber-interleaving search input.

Recommended fix:

- add an explicit dispatcher mode to `TSimulationConfig`;
- make campaign execution step-driven, with a choice across all runnable
  dispatchers rather than a complete drain of one dispatcher;
- retain auto-flush as a convenience mode for small qualification tests; and
- record schedule-shape coverage so seed diversity is measurable.

### DST-2 — Two required distributed scenarios are synthetic models; Canvas coverage is only partial — P1

The prior review overstated this issue by treating all required scenarios as
policy sketches. Canvas is different:
[`canvas.sim.test.ts`](apps/backend/src/conformance/canvas.sim.test.ts) runs the
real shared Canvas core conformance program against
[`layerCanvasAuthoritySim`](apps/backend/src/sim/canvas/layer.canvas-authority.sim.ts)
inside the controlled runtime. It covers command reduction, duplicate command
idempotency, event replay, querying, and resync.

It still calls the authority sequentially and directly. It does not exercise a
Canvas client, `SimulationNetwork`, disconnect/reconnect, resubscription,
delayed or duplicate delivery, acknowledgement loss, or competing fibers. The
PRD's initial Canvas reconnect scenario is therefore only partially covered.

The other two scenarios in
[`scenarios.ts`](apps/backend/src/sim/scenarios.ts) are synthetic state models:

- widget publication/load chooses an order and then forces convergence with
  `Math.max`; it does not run the widget publication program, catalog
  authority, generation fence, or runtime loader;
- cancellable commit mutates a small record twice; it does not run a Function
  or Resource authority, `SimulationOutcomes`, durable storage, an interrupted
  fiber, or `SimulationProcesses`.

The controlled network, storage, process, and outcome services are qualified
together in `controlled-capabilities.test.ts`, but no distributed domain
scenario composes them with these semantic programs. In particular,
`SimulationProcesses.cancel` only records an operation ID in a set and
`crash` only flips a boolean; neither owns or interrupts an Effect fiber.

Recommended fix: keep the cheap models, then add three service-level scenarios:

1. Canvas client/authority reconnect, duplicate command, delayed event, lost
   acknowledgement, resubscription, and resync.
2. Widget publication with an overlapping runtime load, a newer accepted
   generation, stale completion rejection, and last-good replacement.
3. Function/resource work with cancellation before commit, after commit, and
   after a lost acknowledgement, using a stable invocation identity and an
   actually interrupted provider fiber.

### DST-3 — Replay is not self-contained for outcomes or delivery dispositions — P1

`TSimulationRecord` captures choice and fault results, trace steps, schedule,
and final evidence. Fault replay is already self-contained: `world.fault`
consumes the recorded fault step. Outcome and network scripts are different.

An `outcome` step in [`types.ts`](apps/backend/src/sim/types.ts) records only
`kind`, `operationId`, and `status`. `SimulationOutcomes.take` reads the current
`scriptedOutcomes` configuration even during replay. The audit changed a
successful payload from `1` to `999`; because the scenario kept only the
status, every recorded step and the final digest still matched.

Network dispositions are also read from the current `scriptedDeliveries`.
They are inferred indirectly from enqueue/drop traces rather than recorded as
inputs. `deliver` and `delay(0)` return different dispositions to the program
but emit identical enqueue evidence, and that configuration change replayed
successfully.

The record also has no canonical script/configuration fingerprint. A caller
can therefore supply a materially different script and get either an
apparently successful replay or a late divergence only when downstream trace
or final state happens to expose it.

Recommended fix:

- record normalized outcome payloads/errors, or a redacted payload plus a
  canonical digest;
- add an explicit step for every consumed network disposition;
- have replay return the recorded outcome/disposition instead of consulting
  the current script;
- fingerprint all normalized fault, delivery, provider, and process scripts;
  and
- fail during replay setup when that fingerprint differs.

### DST-4 — `stepBound` bounds trace append operations, not simulated execution — P1

[`layer.simulation-world.ts`](apps/backend/src/sim/layer.simulation-world.ts)
checks `stepBound` only in its private `append` function. Scheduler selections,
fiber continuations, and Effect operations do not consume that bound.

The audit ran 1,000 explicit yields with `stepBound: 1`. It succeeded with
1,000 schedule choices and zero `steps`. An infinite yield/retry loop that does
not call a traced world capability can therefore run forever despite the
configured deterministic bound. The field name and the campaign guidance in
the previous review incorrectly implied a general execution bound.

Recommended fix:

- define separate bounds for trace steps, scheduler choices, world actions,
  virtual time, and scenario-specific retries/messages;
- enforce the scheduler bound inside task selection and include the terminating
  bound in replay evidence; and
- keep an outer test timeout only as a CI safety net, not as canonical
  simulation evidence.

### DST-5 — `logicalNodes` is record metadata, not an enforced world boundary — P2

The world validates that configured logical node names are non-empty and
unique, then stores them in the record. The network and process capability
layers do not consult that set. `connect`, `send`, and `start` accept any
non-empty node ID.

The audit declared one node named `declared`, then successfully connected
`undeclared-network` and started `undeclared-process`; both appeared in the
trace while the record's `logicalNodes` remained unchanged. This makes node
topology incomplete as replay evidence and allows spelling mistakes to create
new logical nodes silently.

Recommended fix: construct one canonical node registry from the normalized
configuration and require every network/process operation to reference a
declared node. Model dynamic node creation as an explicit recorded world action
rather than an implicit string insertion.

### DST-6 — Six simulation conformance suites are deterministic fixtures, not DST runs — P2

Agent, Events, Functions, Resources, Widget State, and Widgets simulation
conformance run shared core programs against deterministic in-memory
authorities using `Effect.runPromise`. This is valid and valuable conformance,
but those suites do not create `createSimulationRuntime`, install the seeded
scheduler, advance virtual time, inject controlled network/process faults, or
produce replay records.

Canvas simulation conformance is the exception and should not be grouped with
the six fixture-only suites.

Report the categories separately:

- **sim conformance:** the same semantic program against a deterministic
  alternate authority;
- **DST:** a semantic program inside the controlled runtime with scheduling,
  time, nodes, faults, trace, bounds, and replay.

### DST-7 — Script exhaustion silently changes to repeat-last/default behavior — P2

Fault, delivery, and outcome scripts reuse their final element after the
configured sequence is exhausted. Fault and delivery scripts add another
special case: an empty sequence silently becomes `pass` or `deliver`, while an
empty outcome script is an `INVALID_CONFIG` failure.

Repeat-last is convenient for persistent faults, but it can hide an unexpected
extra retry or message. Exact regression scripts should fail when a third
decision occurs after two were declared.

Add an explicit per-script exhaustion policy:

- `repeat-last` for intentional persistent behavior;
- `fail-on-exhaustion` for exact regression scripts; and
- `default` only when the scenario deliberately omits a script.

Record reuse/exhaustion as evidence and use `fail-on-exhaustion` by default for
saved regression cases.

### DST-8 — There is no campaign runner, failing corpus, or novelty filter — P2

The root manifest has no `dst` command, and there is no scenario registry, seed
sweep runner, record writer, coverage signature, minimizer, or failing-record
corpus. Current seeds live in Bun tests. A developer needs an ad hoc program to
repeat the audit sweeps above.

This is not required for the existing qualification tests to be valid, but it
prevents the system from operating as a repeatable distributed-state search
tool.

A focused runner should support commands equivalent to:

```text
bun run dst --scenario canvas-reconnect \
  --seed 123 --count 64 --scheduler step \
  --schedule-bound 5000 --record-dir .artifacts/dst

bun run dst --replay .artifacts/dst/failure-<id>.json
```

It should provide bounded parallelism, stop-on-first-failure, canonical record
files, a stable script fingerprint, and a coverage signature based on choice
buckets, schedule shape, world actions, invariant result, and final digest.

## How to use DST effectively today

### 1. Keep the two current gates

```text
bun test apps/backend/src/sim
bun run test:backend:conformance
```

The first is the 11-test runtime/capability qualification suite. The second is
the 74-test backend conformance-plus-simulation gate. Neither is a campaign.

### 2. Treat seed sweeps as explicit-choice sweeps

With the current auto-flushing runtime, root seeds reliably vary
`world.choose` decisions such as ready-network-message selection. Do not claim
fiber schedule coverage merely from a large seed count. First verify that the
record contains a choice with more than one runnable candidate and that seeds
produce more than one schedule-shape signature.

Scripted faults, deliveries, and provider outcomes do not vary with the root
seed. Vary those inputs explicitly around semantic boundaries:

| Dimension | Small useful matrix |
| --- | --- |
| Commit | fail before, commit, commit then lost acknowledgement |
| Network | deliver, drop, duplicate, delay before/after retry |
| Process | running, crash before send, crash after commit, restart |
| Cancellation | before provider work, before commit, after commit, after lost acknowledgement |
| Generation | old load first, publication first, stale load last |

### 3. Preserve configuration with every record

Until replay records contain consumed outcomes, delivery dispositions, and a
script fingerprint, save the exact normalized `TSimulationConfig` beside every
record. A successful replay is not proof that an independently reconstructed
script matches the recording.

### 4. Add external safety limits

`stepBound` currently limits trace length only. Use bounded scenario loops and
an outer test timeout for ad hoc campaigns. Inspect both `record.steps.length`
and `record.schedule.length`; one can grow independently of the other.

### 5. Deduplicate by behavior, not seed

For each run, calculate a signature containing at least:

- scenario plus the exact script/configuration fingerprint;
- final digest and invariant result;
- ordered world action/type sequence;
- selected-index buckets for explicit choices;
- scheduler runnable-count and selected-index buckets;
- maximum virtual time, trace count, and scheduler choice count; and
- the set of node IDs actually used, checked against `logicalNodes`.

Keep the first record for a new signature. Retain another seed only when it is
a smaller reproduction.

## Recommended implementation order

1. Make execution genuinely bounded across scheduler and world actions.
2. Make replay consume recorded outcomes/dispositions and fingerprint scripts.
3. Add a step-driven, cross-dispatcher scheduler mode for campaigns.
4. Replace the widget and cancellation sketches with service-level scenarios,
   and complete the Canvas reconnect scenario.
5. Enforce the logical-node registry and exact script exhaustion.
6. Add a focused campaign runner, corpus, and novelty signatures.
7. Report simulation conformance, runtime qualification, and DST campaign
   coverage as separate metrics.
