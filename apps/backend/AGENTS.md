# Omnidraw backend

This private application owns the Bun server, source-run CLI, durable
authorities, persistence, trusted local widget execution, provider adapters,
the single production `ManagedRuntime`, and deterministic simulation.

The required dependency direction is:

```text
core <- shell
core <- sim
core <- conformance
```

- `src/core` contains domain values, pure `fn.*` policy, typed failures,
  `Context.Service` contracts, and lazy `fx.*` / `tx.*` programs.
- `src/shell` contains database, filesystem, process, provider, HTTP, RPC,
  WebSocket, CLI, and runtime mechanics.
- `src/sim` contains controlled Layers, virtual time, seeded scheduling,
  network/process/storage faults, trace capture, and replay.
- `src/conformance` contains scenarios that execute unchanged against live and
  simulated Layers.

Core never executes Effects, constructs live Layers, accesses ambient world
handles, or imports shell/sim/conformance. Shell never imports sim. Runtime
edges own and dispose one `ManagedRuntime` per application instance.

Follow the repository root guide and
`docs/internal/llm.app-architecture.md`. Use exact `effect@4.0.0-rc.108` and
the vendored `repos/effect` reference. Do not preserve the retired portal,
custom runtime, Tapable, oRPC, compiled-binary, or compatibility architecture.

OSS widget server/function code is deliberately trusted local execution. It is
not a sandbox guarantee.
