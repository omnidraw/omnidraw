import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { DbServiceTurso } from "../../../src/DbServiceTurso/DbServiceTurso"

async function insertDefinition(db: DbServiceTurso, name: string, slug: string) {
  await db.actor.insertDefinition({
    name,
    slug,
    url: null,
    description: null,
    manifest_path: `widgets/${slug}/vibecanvas.json`,
  })
}

describe("DbServiceTurso actor resources", () => {
  let db!: DbServiceTurso

  beforeEach(async () => {
    db = new DbServiceTurso({
      databasePath: ":memory:",
      dataDir: ".",
      cacheDir: ".",
    })
    await db.start()
  })

  afterEach(async () => {
    await db.db.close()
  })

  test("persists catalog lifecycle state, duplicate display names, filters, and provider errors", async () => {
    await db.actorResource.create({
      id: "kv-a",
      kind: "kv",
      name: "Shared",
      status: "ready",
    })
    await db.actorResource.create({
      id: "secret-a",
      kind: "secretStore",
      name: "Shared",
      status: "ready",
    })

    await expect(db.actorResource.list({ kind: "kv" })).resolves.toMatchObject([
      { id: "kv-a", kind: "kv" },
    ])
    await expect(db.actorResource.list({ status: "ready" })).resolves.toHaveLength(2)
    await expect(db.actorResource.rename({ id: "kv-a", name: "Preferences" })).resolves.toMatchObject({
      id: "kv-a",
      name: "Preferences",
    })
    await expect(db.actorResource.updateProviderState({
      id: "kv-a",
      status: "error",
      lastError: { code: "TEST_FAILURE" },
    })).resolves.toMatchObject({
      status: "error",
      last_error: { code: "TEST_FAILURE" },
    })
    expect("metadata" in (await db.actorResource.get({ id: "kv-a" })!)).toBe(false)
    await expect(db.actorResource.updateProviderState({ id: "kv-a", status: "ready", lastError: null })).resolves.toMatchObject({
      status: "ready",
      last_error: null,
    })
  })

  test("upserts definition-level bindings, blocks bound deletion, and cascades definition deletion", async () => {
    await insertDefinition(db, "Definition A", "definition-a")
    await insertDefinition(db, "Definition B", "definition-b")
    await db.actorResource.create({ id: "kv-a", kind: "kv", name: "A", status: "ready" })
    await db.actorResource.create({ id: "kv-b", kind: "kv", name: "B", status: "ready" })

    await expect(db.actorResource.upsertBinding({
      definitionName: "Definition A",
      slotName: "preferences",
      resourceId: "kv-a",
      allowRead: true,
      allowWrite: false,
    })).resolves.toMatchObject({
      actor_definition_name: "Definition A",
      slot_name: "preferences",
      resource_id: "kv-a",
      allow_read: true,
      allow_write: false,
    })

    await db.actorResource.upsertBinding({
      definitionName: "Definition B",
      slotName: "preferences",
      resourceId: "kv-a",
      allowRead: true,
      allowWrite: true,
    })
    await expect(db.actorResource.listDefinitionsReferencingResource({ resourceId: "kv-a" })).resolves.toMatchObject([
      { name: "Definition A" },
      { name: "Definition B" },
    ])
    await expect(db.actorResource.beginDelete({ id: "kv-a" })).resolves.toBeNull()

    await expect(db.actorResource.upsertBinding({
      definitionName: "Definition A",
      slotName: "preferences",
      resourceId: "kv-b",
      allowRead: true,
      allowWrite: true,
    })).resolves.toMatchObject({ resource_id: "kv-b", allow_write: true })
    await db.actor.deleteDefinition("Definition B")
    await expect(db.actorResource.listBindingsForResource({ resourceId: "kv-a" })).resolves.toEqual([])

    await expect(db.actorResource.beginDelete({ id: "kv-a" })).resolves.toMatchObject({ status: "deleting" })
    await expect(db.actorResource.delete({ id: "kv-a" })).resolves.toBe(true)
    await expect(db.actorResource.get({ id: "kv-a" })).resolves.toBeNull()
  })

  test("refuses bindings to resources that are not ready and rejects empty permission sets", async () => {
    await insertDefinition(db, "Definition A", "definition-a")
    await db.actorResource.create({ id: "kv-created", kind: "kv", name: "Created" })

    await expect(db.actorResource.upsertBinding({
      definitionName: "Definition A",
      slotName: "storage",
      resourceId: "kv-created",
      allowRead: true,
      allowWrite: false,
    })).resolves.toBeNull()

    await db.actorResource.updateProviderState({ id: "kv-created", status: "ready" })
    await expect(db.actorResource.upsertBinding({
      definitionName: "Definition A",
      slotName: "storage",
      resourceId: "kv-created",
      allowRead: false,
      allowWrite: false,
    })).rejects.toBeInstanceOf(Error)
  })

  test("stores every JSON family, distinguishes stored null, increments revisions, and isolates resources", async () => {
    await db.actorResource.create({ id: "kv-a", kind: "kv", name: "A", status: "ready" })
    await db.actorResource.create({ id: "kv-b", kind: "kv", name: "B", status: "ready" })

    const values = [null, "text", 42, true, [1, "two", null], { nested: { ok: true } }] as const
    for (const [index, value] of values.entries()) {
      await db.actorResource.keyValue.set({ resourceId: "kv-a", key: `key-${index}`, value })
    }
    await expect(db.actorResource.keyValue.get({ resourceId: "kv-a", key: "key-0" })).resolves.toMatchObject({
      value: null,
      revision: 1,
    })
    await expect(db.actorResource.keyValue.get({ resourceId: "kv-a", key: "missing" })).resolves.toBeNull()

    await expect(db.actorResource.keyValue.set({ resourceId: "kv-a", key: "same", value: "A1" })).resolves.toMatchObject({ revision: 1 })
    await expect(db.actorResource.keyValue.set({ resourceId: "kv-a", key: "same", value: "A2" })).resolves.toMatchObject({ value: "A2", revision: 2 })
    await db.actorResource.keyValue.set({ resourceId: "kv-b", key: "same", value: "B1" })
    await expect(db.actorResource.keyValue.get({ resourceId: "kv-a", key: "same" })).resolves.toMatchObject({ value: "A2" })
    await expect(db.actorResource.keyValue.get({ resourceId: "kv-b", key: "same" })).resolves.toMatchObject({ value: "B1", revision: 1 })
  })

  test("lists literal prefixes in key order with bounded cursor pages", async () => {
    await db.actorResource.create({ id: "kv-a", kind: "kv", name: "A", status: "ready" })
    for (const key of ["plain", "todo%1", "todo%2", "todo_3", "todoX4"]) {
      await db.actorResource.keyValue.set({ resourceId: "kv-a", key, value: key })
    }

    const first = await db.actorResource.keyValue.list({ resourceId: "kv-a", prefix: "todo%", limit: 1 })
    expect(first.entries.map((entry) => entry.key)).toEqual(["todo%1"])
    expect(first.nextCursor).toBe("todo%1")
    const second = await db.actorResource.keyValue.list({
      resourceId: "kv-a",
      prefix: "todo%",
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    })
    expect(second.entries.map((entry) => entry.key)).toEqual(["todo%2"])
    expect(second.nextCursor).toBeNull()
    await expect(db.actorResource.keyValue.list({ resourceId: "kv-a", limit: 501 })).rejects.toBeInstanceOf(RangeError)
  })

  test("implements create/update CAS and allows only one concurrent stale revision", async () => {
    await db.actorResource.create({ id: "kv-a", kind: "kv", name: "A", status: "ready" })

    await expect(db.actorResource.keyValue.compareAndSet({
      resourceId: "kv-a",
      key: "counter",
      expectedRevision: null,
      value: 1,
    })).resolves.toMatchObject({ ok: true, entry: { value: 1, revision: 1 } })
    await expect(db.actorResource.keyValue.compareAndSet({
      resourceId: "kv-a",
      key: "counter",
      expectedRevision: null,
      value: 2,
    })).resolves.toEqual({ ok: false, expectedRevision: null, currentRevision: 1 })

    const results = await Promise.all([
      db.actorResource.keyValue.compareAndSet({ resourceId: "kv-a", key: "counter", expectedRevision: 1, value: 2 }),
      db.actorResource.keyValue.compareAndSet({ resourceId: "kv-a", key: "counter", expectedRevision: 1, value: 3 }),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
    await expect(db.actorResource.keyValue.get({ resourceId: "kv-a", key: "counter" })).resolves.toMatchObject({ revision: 2 })
  })

  test("deletes within one resource and cascades entries when the catalog row is removed", async () => {
    await db.actorResource.create({ id: "kv-a", kind: "kv", name: "A", status: "ready" })
    await db.actorResource.create({ id: "kv-b", kind: "kv", name: "B", status: "ready" })
    await db.actorResource.keyValue.set({ resourceId: "kv-a", key: "shared", value: "A" })
    await db.actorResource.keyValue.set({ resourceId: "kv-b", key: "shared", value: "B" })

    await expect(db.actorResource.keyValue.delete({ resourceId: "kv-a", key: "shared" })).resolves.toEqual({ deleted: true })
    await expect(db.actorResource.keyValue.has({ resourceId: "kv-a", key: "shared" })).resolves.toBe(false)
    await expect(db.actorResource.keyValue.has({ resourceId: "kv-b", key: "shared" })).resolves.toBe(true)

    await db.actorResource.beginDelete({ id: "kv-b" })
    await db.actorResource.delete({ id: "kv-b" })
    const count = await db.db.get("SELECT count(*) AS count FROM actor_resource_key_values WHERE resource_id = ?", "kv-b")
    expect(count).toEqual({ count: 0 })
  })

  test("rejects non-JSON values before persistence", async () => {
    await db.actorResource.create({ id: "kv-a", kind: "kv", name: "A", status: "ready" })
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    await expect(db.actorResource.keyValue.set({ resourceId: "kv-a", key: "undefined", value: undefined as never })).rejects.toBeInstanceOf(TypeError)
    await expect(db.actorResource.keyValue.set({ resourceId: "kv-a", key: "bigint", value: 1n as never })).rejects.toBeInstanceOf(TypeError)
    await expect(db.actorResource.keyValue.set({ resourceId: "kv-a", key: "cyclic", value: cyclic as never })).rejects.toBeInstanceOf(TypeError)
    await expect(db.actorResource.keyValue.set({ resourceId: "kv-a", key: "class", value: new Date() as never })).rejects.toBeInstanceOf(TypeError)
  })
})
