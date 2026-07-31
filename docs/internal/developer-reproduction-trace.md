# Developer reproduction trace

The developer reproduction trace is an author-only diagnostic tool for following
canvas interaction failures across Omnidraw-owned boundaries. It is available
only when the frontend composes `Canvas` with development diagnostics enabled.
It does not record video, guest widget business events, chat content, arbitrary
network calls, DOM text, or product analytics.

## Workflow

1. Run the frontend in development and open the bug's canvas.
2. Open the bug-shaped **DEV TRACE** control in the canvas toolbar.
3. Keep **Smart** selected unless one technical channel needs isolating, then
   press **Record**.
4. Reproduce the failure and press **Mark Failure** at the visible symptom.
5. Press **Stop**, then **Copy for Agent**. Paste the resulting Markdown block
   directly into a coding-agent task.
6. Use **JSONL** when the agent needs the fuller bounded trace. No export is
   uploaded automatically.
7. Press **Clear** before starting a new recording. A stopped trace is never
   overwritten silently.

## Agent copy and full download

**Copy for Agent** uses a terse causal timeline rather than the storage-shaped
event envelope. Gesture rows contain an elapsed span, source sequence span,
action, target, path endpoints, crossed boundaries, and outcome. Non-gesture
facts use compact `sequence@elapsed channel/type` rows. The copy omits schema
version, retention priority, budgets, enabled-channel lists, repeated
environment fields, event-count indexes, and expanded gesture indexes. Those
dimensions do not help an agent locate the first broken boundary.

In Smart mode, the copy further reduces each correlated pointer gesture to one
row containing its action, aliased target, rounded start/end position, crossed
input boundaries, transform outcome, persistence/revision outcome, and relevant
selection result. Repeated canvas, gesture, node, transaction, and command UUIDs
do not enter the agent timeline. Mark Failure attaches to the latest gesture;
a marked pointer gesture with no transform is reported as a mechanically
supported possible anomaly.

The optional fuller JSONL download remains schema version `1` so a saved file
can be opened safely by future tooling. Its header contains bounded
environment facts, enabled channels, the UTC start time, and the configured
128 KiB copy / 2 MiB download budgets. Event envelopes contain:

- a monotonically increasing `sequence`;
- monotonic `elapsedMs` from trace start;
- a technical `channel` and semantic `type`;
- retention-only `priority`;
- optional canvas, host gesture, Cangine gesture, pointer, node, widget,
  transaction, and command correlation IDs; and
- bounded JSON data.

The summary reports the exact captured, retained, coalesced, summarized,
omitted, and redacted counts. It also lists gesture causal chains and
mechanically supported `possible anomaly` candidates with related sequence IDs.
An anomaly is evidence of a silent or failed edge, not a claim about intended
product behavior.

## Channels

| Channel | Captured host-owned facts |
|---|---|
| `input.dom` | Pointer/key phase, buttons, modifiers, coordinates, semantic target attributes, and pointer capture |
| `input.engine` | Normalized Cangine input and bounded hit facts |
| `picking` | Hit/hover target transitions |
| `transform` | Transform begin, update, commit, cancel, gesture, handle, and affected IDs |
| `editor` | Tool, selection, focus, history eligibility, and scene publications |
| `document` | Local request, affected-node plan, optimistic projection, pending command, acknowledgement, invalidation, and recovery |
| `transport` | Typed CanvasService snapshot, execute, and event boundaries with revisions, counts, duration, and normalized errors |
| `widget-host` | Portal registration/mount lifecycle, host interaction ownership, controls, and placement |
| `system` | Trace/runtime lifecycle and isolated callback failures |

Smart mode enables all causal channels but records no passive pointer motion,
hover crossings, raw drag frames, transform updates, empty widget observations,
scene publications, or redundant trace start/stop events. Pointer down/up/cancel
positions still show whether movement occurred. Picking records the action's
starting target, and transform begin/commit/cancel records whether that motion
became an editor gesture. Repeated editor and widget observations are retained
only when their compact semantic state changes.

Advanced mode is the explicit raw-channel path. It records active movement and
samples one in every twenty passive pointer moves while preserving the selected
technical channels. Recorder-toolbar pointer and keyboard interactions are
excluded in both modes.

In the development composition, normalized input and transform observers are
registered before editor routing so a consumed interaction is still visible.
Their callbacks return immediately while idle. Editor, widget, and scene
subscriptions are attached for recording and released on stop. None of these
observers are composed in production.

## Bounds and redaction

The active recorder holds at most 12,000 bounded events and bounds its
correlation indexes to the same limit. Mark Failure captures a five-second
following tail and then stops automatically. Export coalesces repetitive moves,
transform previews, hover observations, scene publications, and identical state
observations while retaining the first and last sample, semantic changes,
direction/velocity changes, extrema, and a dropped-run summary. Budget trimming
removes lower-priority samples before causal boundaries.

The toolbar's raw estimate describes the active in-memory recording before
export compaction. Smart mode removes high-frequency facts before they enter
that buffer. Copy for Agent is separately compacted and hard-limited to 128 KiB,
so the raw estimate can be larger without producing an oversized clipboard
artifact.

Values are normalized to JSON with limits on object depth, keys, arrays,
strings, and error stacks. Secret-shaped keys, credentials, authorization
values, data/blob URLs, binary-shaped values, cyclic/runtime objects, and
unsupported values are replaced with an explicit redaction reason. Canvas
input normalizes printable key identities and explicitly masks text-entry and
widget-content keystrokes, while retaining navigation/control key semantics.
Transport instrumentation records typed identifiers, revisions, operation
types, and
counts rather than raw request or response bodies. Document instrumentation
receives only already-available affected-node IDs and counts; it never scans or
serializes the scene.

## Reading a broken chain

For a failed clone-drag, search the marked gesture ID in chronological order:

```text
input.dom pointer-down
→ input.engine pointer-down + hit
→ transform transform-begin / transform-commit
→ document local-request / durable-plan-prepared / projection-applied
→ document command-dispatched
→ transport execute-dispatched / execute-received
→ document acknowledgement-accepted / pending-retired
→ widget-host portal-reconcile
```

The first missing terminal boundary narrows the investigation. For example, a
transform commit without `local-request` is reported as a possible
transform-to-editor anomaly; `projection-applied` without
`command-dispatched` points at the document outbox; and `execute-failed`
preserves the command correlation and normalized failure without including the
request body.

## Synchronous-path measurement

Run `bun run scripts/measure-reproduction-trace.ts` to compare the bounded local
reducer with recording absent and active while changing total canvas size but
keeping one affected node. On 2026-07-30, 2,000 iterations in the development
worktree produced:

| Total nodes | Recording | µs / iteration | Retained trace events |
|---:|:---:|---:|---:|
| 100 | no | 10.52 | 0 |
| 10,000 | no | 7.27 | 0 |
| 100 | yes | 11.38 | 2,001 |
| 10,000 | yes | 10.87 | 2,001 |

The absolute microbenchmarks are machine-dependent. The material result is that
capture cost stayed tied to the one emitted affected-node fact, not total canvas
size. The existing local-document iteration-spy test separately proves an
ordinary non-structural mutation performs no untouched-node iteration.
