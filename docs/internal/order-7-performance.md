# Order 7 measured performance evidence

This record covers the representative workloads added by D12. Run them with
`bun run benchmark:order-7`; the command builds the public packages first and
then executes `apps/backend/benchmarks/order-7.ts`.

## Method

- Runtime: Bun 1.3.14 on `darwin-arm64`.
- Measurements: 7 or 9 samples after 1 or 2 warmups, with median and p95 wall
  time read from `Bun.nanoseconds()`.
- Canvas command: a valid 2,048-item authoritative snapshot and one guarded
  reorder, including the complete reducer checks.
- Canvas query: a 2,048-row in-memory Turso store scanned in 256-row cursor
  pages, retaining strict row validation.
- Canonical JSON: the same frozen nested 128-node payload serialized 100 times.
- Rate limiting: 2,048 active scope ledgers and 1,000 admissions to one hot
  scope.
- Database serialization: 256 operations queued concurrently on one connection
  owner.

The values are comparative evidence from the same machine, not cross-machine
service-level targets.

## Results

| Workload | Baseline median / p95 | Final median / p95 | Decision |
| --- | ---: | ---: | --- |
| Canvas command reduction | 10.189 / 10.378 ms | 9.870 / 10.515 ms | Keep the complete reducer; no material avoidable cost was demonstrated. |
| Canvas query full scan | 32.172 / 32.585 ms | 29.921 / 30.197 ms | Keep strict validation on every persisted row. |
| Repeated canonical JSON | 41.778 / 43.401 ms | 40.621 / 41.302 ms | Keep the simpler normalize-then-stringify implementation. |
| Widget-state rate limiter | 19.090 / 20.679 ms | 0.241 / 0.282 ms | Optimize the demonstrated full-map scan, a 79.2x median reduction. |
| Serialized database operations | 0.255 / 0.407 ms | 0.108 / 0.136 ms | Keep the existing serializer; baseline was already about one million operations per second and the variation required no code change. |

An experimental one-pass canonical stringifier regressed the representative
workload to a 74.812 ms median and 265.493 ms p95. It was discarded. Parity and
invalid-value tests remain to protect the current canonical behavior.

## Optimized ownership and invalidation

The only retained performance change is in
`WidgetStateMutationRateLimiter`. Its ledger map is owned by one limiter
instance and remains bounded by `maxTrackedScopes` (2,048 in the benchmark).
Admission for an existing scope now prunes only that scope. A full-map expiry
sweep occurs only when a new scope arrives at capacity, where reclaiming an
expired slot is required for correctness. `release(scopeId)` invalidates one
scope and `clear()` invalidates the owner's complete lifecycle state.

No cache was added to Canvas reduction, persisted-row queries, canonical JSON,
or database serialization. Full contract and storage validation remains in
place at untrusted ingress.

## Cancellation scope

This order only makes package-internal disposal idempotent and consistent. It
does not change a public cancellation signature. The existing public
`AbortSignal` ports remain source-compatible, so no future-major proposal is
needed from this measurement; any later port redesign must be proposed and
justified separately as a major-version change.
