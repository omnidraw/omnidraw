# Turso custom-domain migration report

Tested 2026-07-12 with this repository's `@tursodatabase/database` 0.6.1, an in-memory database, and experimental feature `custom_types` enabled.

## Observed behavior

1. `CREATE DOMAIN` works only when `custom_types` is enabled.
2. A domain check is enforced on inserts. The original domain rejected `fs` with `CHECK constraint failed: actor_resource_kind_allowed`.
3. `ALTER DOMAIN ...` is not implemented and fails near `DOMAIN`.
4. `DROP DOMAIN ACTOR_RESOURCE_KIND` fails while any table column uses it: `cannot drop type actor_resource_kind: used by column kind in table actor_resources`.
5. Re-running `CREATE DOMAIN` cannot replace it, including with `IF NOT EXISTS`; it cannot change an existing definition.
6. Domain constraints are not dynamically replaceable. A table rebuild/copy is required to change the domain used by an existing column.
7. A transactional rebuild preserved parent rows and rows in a referencing child table. The rebuilt domain accepted `fs` and continued rejecting values outside the new set.
8. `PRAGMA foreign_key_check` is not supported by the tested Turso engine (`Not a valid pragma name`). Validation must therefore use explicit anti-join queries. Do not assume all SQLite diagnostic pragmas exist.

Raw experiments:

- `domain-experiment.ts` / `domain-experiment.out`
- `domain-rebuild-experiment.ts` / `domain-rebuild-experiment.out`

## Strategies

### A. Edit the original migration only for databases that have never run it

Changing migration 009 directly is safe only when every database is disposable/new and migration 009 has never been applied. It does nothing to existing databases and risks schema drift between installations. This is not appropriate for released/deployed databases.

### B. New domain name plus one table rebuild

Create `ACTOR_RESOURCE_KIND_V2` with the expanded constraint, rebuild each table column to use V2, then optionally drop V1 after no columns reference it. This needs one copy of each affected table and is the simplest operational strategy, but leaves a versioned domain name.

### C. Preserve the exact domain name (recommended when the name matters)

Because the old domain cannot be dropped while referenced, temporarily copy affected table data into a table whose corresponding column uses the base type (`TEXT`), drop the original table, drop/recreate the domain, recreate the original table, and copy the data back. This copies the affected table twice internally but can be atomic in one transaction.

Template tested successfully:

```sql
-- Must be changed before BEGIN; changing it inside a transaction is ineffective
-- in SQLite-compatible engines.
PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

CREATE TABLE actor_resources_buffer (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL
) STRICT;

INSERT INTO actor_resources_buffer (id, kind, name)
SELECT id, kind, name
FROM actor_resources;

DROP TABLE actor_resources;

DROP DOMAIN ACTOR_RESOURCE_KIND;
CREATE DOMAIN ACTOR_RESOURCE_KIND AS TEXT
    NOT NULL
    CONSTRAINT actor_resource_kind_allowed
        CHECK (value IN ('kv', 'secretStore', 'db', 'fs'));

-- Reproduce the complete real table definition, not this abbreviated example.
CREATE TABLE actor_resources (
    id TEXT PRIMARY KEY NOT NULL,
    kind ACTOR_RESOURCE_KIND,
    name TEXT NOT NULL
) STRICT;

INSERT INTO actor_resources (id, kind, name)
SELECT id, kind, name
FROM actor_resources_buffer;

DROP TABLE actor_resources_buffer;

-- Recreate every index and trigger belonging to the dropped table.
CREATE INDEX actor_resources_kind_idx ON actor_resources (kind);

COMMIT;
PRAGMA foreign_keys = ON;
```

## Data-safety requirements

- Wrap the entire copy/drop/recreate/copy sequence in one transaction. A failure (including a new constraint rejecting existing data) should roll everything back.
- Use `BEGIN IMMEDIATE` to avoid concurrent writes during the copy.
- Disable foreign-key enforcement before the transaction, not during it. Otherwise dropping a referenced parent can fail or `ON DELETE` actions can affect child data.
- Re-enable foreign keys after commit even on application-level errors; migration code should use `try/finally` or equivalent.
- Explicitly list columns in both `INSERT ... SELECT` statements. Do not use `SELECT *` in a production migration.
- Reproduce all columns, defaults, generated expressions, checks, primary/unique constraints, foreign keys, indexes, and triggers. Dropping a table drops its indexes and triggers.
- Inventory all domain users before dropping it. `DROP DOMAIN` itself blocks the operation if one was missed.
- Check existing values before migration:

```sql
SELECT id, kind
FROM actor_resources
WHERE kind NOT IN ('kv', 'secretStore', 'db', 'fs') OR kind IS NULL;
```

- Verify referring rows with explicit anti-joins because the tested engine lacks `PRAGMA foreign_key_check`:

```sql
SELECT b.*
FROM actor_resource_bindings AS b
LEFT JOIN actor_resources AS r ON r.id = b.resource_id
WHERE r.id IS NULL;
```

- Compare row counts before and after, and test representative accepted/rejected values.
- Back up production data before a destructive schema migration.

## Important project-specific concern

The repository migration runner splits files at `--> statement-breakpoint`. Confirm that it can execute this rebuild as one transaction and that it uses one connection throughout. Do not place transaction-dependent statements into a mechanism that independently commits every statement. Also test against the same Turso server/cloud version used in production: custom types are experimental and behavior/API may change.

## Recommendation for `ACTOR_RESOURCE_KIND`

For a deployed database, add a new migration. If retaining the exact name is important, use strategy C and rebuild only `actor_resources`; child table data can remain in place while foreign keys are disabled. If the domain name is internal and versioning is acceptable, use strategy B to reduce complexity. In either case, table data must be copied because Turso currently has no in-place domain or column-type alteration.
