# Actor code rules after approval

Actor code runs in Bun child-process guest code. Keep it deterministic and robust.

Imports:
- Actor files may import types/helpers from @vibecanvas/sdk/actor.
- Do not import from @vibecanvas/sdk without a subpath.
- Use @vibecanvas/sdk/actor for actor-side code only.
- Use @vibecanvas/sdk/widget for widget-side code only.

Registry:
- actor/functions.ts must default-export an object with fn, fx, and tx maps.
- Keys must exactly match manifest transition function names.
- Example:

import { txAddTodo } from "./tx.addTodo";

export default {
  fn: {},
  fx: {},
  tx: {
    "tx.addTodo": txAddTodo,
  },
};

Function signatures:
- Functions receive (portal, args).
- args.data is current actor data.
- args.msg is the input message payload.
- Use await portal.next() only when continuing an ordered pipeline.
- Use await portal.setData(nextData) to update actor data.
- Use await portal.emitMessage({ type: "out.name", payload }) to emit actor outputs.
- `fn.*` receives no resource portal. `fx.*` receives read-only resources. `tx.*` receives resource reads and writes permitted by the manifest and user binding.
- Select a declared slot through `portal.resources.kv("slot")`, `portal.resources.secretStore("slot")`, or `portal.resources.db("slot")`. Never supply or derive a concrete resource ID or path.

Reliable implementation style:
- For simple widgets, use one tx.* function per input message.
- Copy data immutably: arrays with map/filter/spread; objects with spread.
- Never mutate args.data in place.
- Always tolerate missing/invalid data defensively even though schemas should validate.
- Keep generated IDs simple and local; prefer counters stored in actor data when possible.
- Do not use browser globals in actor files. No window/document/localStorage.
- Do not depend on network calls unless the user explicitly asked and the capability is safe.

Example actor tx function:

import { defineTx } from "@vibecanvas/sdk/actor";

type TTodo = { id: string; title: string; done: boolean };
type TData = { todos: TTodo[]; nextId: number };
type TMsg = { title: string };

export const txAddTodo = defineTx<TData, TMsg>(async (portal, args) => {
  const title = args.msg.title.trim();
  if (!title) return;
  const nextId = args.data.nextId + 1;
  await portal.setData({
    ...args.data,
    nextId,
    todos: [...args.data.todos, { id: String(nextId), title, done: false }],
  });
});

# Shared actor resources

Use vc_list_resources and vc_inspect_resource when resource context is needed. Use vc_query_db_readonly for bounded row inspection when the user explicitly selected the database. Do not invent table or column names. The concrete selected resource remains host-side and is bound during publish; actor code refers only to the manifest slot.

Database structure and seed-data changes are outside ordinary actor generation. If a compatible selected database needs a change, call vc_propose_db_change with exact SQL and wait for explicit human approval. Do not work around this boundary with actor arbitrary SQL, generated startup migrations, or a model-supplied confirmation.

Resource bindings belong to the widget definition, so all actor instances of that definition resolve the same bound resource. A rebind affects calls that start after it. Do not copy a complete shared resource into actor data unless the UI genuinely needs that data.

KV reads are available in `fx` and `tx`; writes are `tx` only:

```ts
import { defineFx, defineTx } from "@vibecanvas/sdk/actor";

export const fxLoadPreference = defineFx(async (portal) => {
  const entry = await portal.resources.kv("preferences").get<string>("theme");
  return entry?.value ?? "system";
});

export const txSavePreference = defineTx(async (portal, args: { msg: { theme: string }; data: unknown }) => {
  await portal.resources.kv("preferences").set({ key: "theme", value: args.msg.theme });
});
```

Use `compareAndSet` with the revision returned by `get` for shared read-modify-write flows. Plain `set` is last-write-wins across actor instances.

Secret-store reads are available in `fx` and `tx`; writes are `tx` only:

```ts
const token = await portal.resources.secretStore("credentials").get("accessToken");
await portal.resources.secretStore("credentials").set({ name: "accessToken", value: nextToken });
```

Secret values are currently stored as plaintext. Retrieve them only when needed. Never log, emit, or copy a token into actor data. Secret `list`, `set`, and `delete` results intentionally omit plaintext values.

DB named operations are preferred and arbitrary SQL exists only when the manifest explicitly enables it:

```ts
const rows = await portal.resources.db("notes").invoke("listNotes", { archived: false });
const selected = await portal.resources.db("notes").query("SELECT id, title FROM notes WHERE id = :id", { id });
await portal.resources.db("notes").execute("UPDATE notes SET title = :title WHERE id = :id", { id, title });
await portal.resources.db("notes").execute([
  { sql: "BEGIN IMMEDIATE" },
  { sql: "INSERT INTO notes (id, title) VALUES (:id, :title)", parameters: { id, title } },
  { sql: "UPDATE counters SET value = value + 1 WHERE name = :name", parameters: { name: "notes" } },
  { sql: "COMMIT" },
]);
```

- `invoke` calls only a manifest-declared named operation.
- SQLite INTEGER columns in returned rows are `bigint`. Never discard them with a `typeof value === "number"` check and never put bigint directly into actor JSON data/messages. Prefer validating and converting them to decimal strings; convert to number only after an explicit safe-integer range check.
- `query` requires declared arbitrary SQL plus effective read access and is available to `fx` and `tx`.
- `execute` requires declared arbitrary SQL plus effective write access and is available only to `tx`; it is always treated as write-capable even when SQL happens to read.
- `execute(sql, parameters?)` runs one statement. `execute(operations)` runs a non-empty ordered operation array on one resolved resource connection without interleaving.
- Multi-operation execution is not automatically atomic. Include explicit `BEGIN`/`COMMIT` operations when atomicity is required; `SAVEPOINT`, `ROLLBACK TO`, `RELEASE`, and `ROLLBACK` are supported for caller-controlled flow.
- Each operation contains exactly one SQL statement and its own parameters. Bind values through parameter objects; never interpolate actor values into SQL.
- If an operation fails, execution stops and the host defensively rolls back any transaction left open. Without an explicit transaction, earlier successful operations may already be committed.
- Write ordinary SQLite-compatible SQL only: tables, indexes, views, triggers, parameters, and transactions. Do not use Turso-only syntax or PRAGMAs, custom types, materialized views, extensions, remote sync, MVCC, or CDC.
- DB slots are schema-agnostic. Actors cannot coordinate structure changes, publish schemas, run host migrations, choose database files, or access Vibecanvas's application database. The host may replace its internal SQLite-compatible engine without changing actor APIs.
