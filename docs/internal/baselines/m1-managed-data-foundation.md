# M1 managed data-foundation evidence

M1 replaces actor-era/XDG bootstrap with one explicit Vibecanvas home, a fresh strict Turso `main.db`, and an immutable `000-initial.sql` baseline. The migration is intentionally clean-room: unknown, partial, and actor-era homes are inspected read-only and refused without mutation.

## Final database contract

- `--data-dir` takes precedence over `VIBECANVAS_HOME`, which takes precedence over `~/.vibecanvas`; relative overrides resolve once against the captured process working directory and application-level `~` expansion is rejected.
- The default organization tree is rooted at `organizations/00000000-0000-4000-8000-000000000001`; resource databases use `resources/<resource-id>/data.db`.
- The baseline contains 40 application tables and every one reports `strict = 1` through the pinned Turso runtime.
- Customer-owned tables require `org_id`; tenant relationships use organization-qualified foreign keys and supporting indexes.
- The deterministic seed contains organization `00000000-0000-4000-8000-000000000001`, owner account `00000000-0000-4000-8000-000000000002`, and local cell `00000000-0000-4000-8000-000000000003`.
- `000-initial.sql` has SHA-256 `862dfebc6fbc1e21d52ac71130279f73c6214439d74107785ed1b671f4a60e2b`.
- Header/connection evidence is `application_id = 1447641669` (`VIBE`), `user_version = 0`, WAL journal mode, foreign keys enabled, ignored checks disabled, `synchronous = FULL`, and `integrity_check = ok`.
- The first deterministic bootstrap reports `applied: true`; a closed/reopened second start reports `applied: false` and retains the original checksum ledger row.

The complete pinned-runtime capture is [`m1-managed-database-introspection.json`](./m1-managed-database-introspection.json). It records `PRAGMA table_list`, every table column, index list and indexed column, every foreign key, the migration ledger, connection/header PRAGMAs, integrity/quick checks, and both bootstrap results. Reproduce it with:

```bash
bun run db:evidence:capture -- --output docs/internal/baselines/m1-managed-database-introspection.json
```

## Corruption and recovery proof

The permanent database commands exercise the database boundary directly rather than relying on application validation:

| Command | Final result |
| --- | --- |
| `bun run db:schema:verify` | 6 passed, 539 assertions; exact table/column/PK/FK/index/STRICT manifest and pinned feature probe |
| `bun run db:constraints:test` | 9 passed, 50 assertions; invalid IDs, tenant links, enums, booleans, timestamps, JSON, digests, paths, revision/artifact links, resource state, leases, idempotency, usage, legacy compatibility, and bound-SQL metadata rejected by Turso |
| `bun run db:recovery:test` | 17 passed, 60 assertions; atomic bootstrap rollback/retry, checksum refusal, partial/actor-era refusal, restart, lifecycle close, killed WAL writer, and full-home backup/restore |

The killed-writer test proves that committed WAL data survives and an in-flight transaction does not. The backup/restore test preserves the control database ledger/catalog/encryption reference and the organization resource `data.db` together. Unknown and actor-era roots retain byte-identical marker files and gain no `main.db` or managed directories.

## Compatibility and release proof

Existing public behavior was mapped onto the new schema while later milestones replace the compatibility surfaces:

- service-db: 75/75 tests, 824 assertions;
- service-actor: 168/168 tests, 843 assertions;
- service-automerge: 10/10 tests, including bounded pending writes and explicit document-registration success/failure;
- service-agent: 124/124 tests;
- CLI/shared home integration: 114/114 tests;
- current API packages: 26/26 focused tests and all nine typechecks.

The common repository gate passed with `git diff --check`, functional-core lint, and `bun run test`. The test suite's filesystem watcher, localhost, and npm compiler cases were rerun with their normal host capabilities after the restricted sandbox correctly prevented those effects.

`bun run build` passed all four release targets after downloading the pinned Turso native packages. `bun run test:binary` then passed native encryption loading, actor IPC, actor-era refusal without mutation, `VIBECANVAS_HOME`, `--data-dir` precedence, compiled default-port fallback, HTTP assets, API/Automerge WebSockets, managed schema inspection, and clean shutdown. A packaging check discovered and fixed one browser-boundary issue by isolating the raw SQL asset in a server-only migration constants module.

No old database import or compatibility migration exists. From this checkpoint onward, changes to the frozen baseline require numbered forward migrations.
