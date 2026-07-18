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

  test("persists normalized unique names across kinds, filters, and provider errors", async () => {
    await db.actorResource.create({
      id: "kv-a",
      kind: "kv",
      name: "  ShÁred  ",
      status: "ready",
    })
    await expect(db.actorResource.create({
      id: "secret-a",
      kind: "secretStore",
      name: "sha\u0301RED",
      status: "ready",
    })).rejects.toMatchObject({ code: "RESOURCE_NAME_CONFLICT" })

    await expect(db.actorResource.list({ kind: "kv" })).resolves.toMatchObject([
      { id: "kv-a", kind: "kv", name: "ShÁred" },
    ])
    await expect(db.actorResource.list({ status: "ready" })).resolves.toHaveLength(1)
    await expect(db.actorResource.findByNameKey({ nameKey: "sháred" })).resolves.toMatchObject([{ id: "kv-a" }])
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
    expect("metadata" in (await db.actorResource.get({ id: "kv-a" }))!).toBe(false)
    await expect(db.actorResource.updateProviderState({ id: "kv-a", status: "ready", lastError: null })).resolves.toMatchObject({
      status: "ready",
      last_error: null,
    })
    await expect(db.actorResource.create({
      id: "secret-a",
      kind: "secretStore",
      name: "Shared",
      status: "ready",
    })).resolves.toMatchObject({ id: "secret-a" })
    await expect(db.actorResource.rename({ id: "secret-a", name: " preferences " }))
      .rejects.toMatchObject({ code: "RESOURCE_NAME_CONFLICT" })
  })

  test("guards normalized name keys at the database boundary outside the service write queue", async () => {
    const insert = await db.db.prepare(`
      INSERT INTO actor_resources (id, kind, name, name_key, status)
      VALUES (?, ?, ?, ?, ?)
    `)
    await insert.run("raw-a", "kv", "Guarded", "guarded", "ready")
    await expect(insert.run("raw-b", "db", "guarded", "guarded", "ready"))
      .rejects.toThrow("RESOURCE_NAME_CONFLICT")
    await expect(insert.run("raw-null", "db", "Missing key", null, "ready"))
      .rejects.toThrow("RESOURCE_NAME_CONFLICT")
  })

  test("replaces a complete binding set transactionally when a later resource is invalid", async () => {
    await insertDefinition(db, "Atomic bindings", "atomic-bindings")
    await db.actorResource.create({ id: "old-kv", kind: "kv", name: "Old KV", status: "ready" })
    await db.actorResource.create({ id: "old-secret", kind: "secretStore", name: "Old secret", status: "ready" })
    await db.actorResource.create({ id: "new-kv", kind: "kv", name: "New KV", status: "ready" })
    await db.actorResource.upsertBinding({
      definitionName: "Atomic bindings", slotName: "storage", resourceId: "old-kv", allowRead: true, allowWrite: false,
    })
    await db.actorResource.upsertBinding({
      definitionName: "Atomic bindings", slotName: "credentials", resourceId: "old-secret", allowRead: true, allowWrite: true,
    })

    await expect(db.actorResource.replaceBindings({
      definitionName: "Atomic bindings",
      bindings: [
        { slotName: "storage", resourceId: "new-kv", allowRead: true, allowWrite: true },
        { slotName: "credentials", resourceId: "missing", allowRead: true, allowWrite: false },
      ],
    })).rejects.toThrow("not ready")

    expect(await db.actorResource.listBindingsForDefinition({ definitionName: "Atomic bindings" })).toEqual([
      expect.objectContaining({ slot_name: "credentials", resource_id: "old-secret", allow_read: true, allow_write: true }),
      expect.objectContaining({ slot_name: "storage", resource_id: "old-kv", allow_read: true, allow_write: false }),
    ])

    await db.actorResource.upsertBinding({
      definitionName: "Atomic bindings", slotName: "storage", resourceId: "new-kv", allowRead: true, allowWrite: false,
    })
    await expect(db.actorResource.replaceBindings({
      definitionName: "Atomic bindings",
      expectedBindings: [
        { slotName: "credentials", resourceId: "old-secret", allowRead: true, allowWrite: true },
        { slotName: "storage", resourceId: "old-kv", allowRead: true, allowWrite: false },
      ],
      bindings: [],
    })).rejects.toMatchObject({ code: "RESOURCE_BINDING_CONFLICT" })
    expect(await db.actorResource.listBindingsForDefinition({ definitionName: "Atomic bindings" })).toEqual([
      expect.objectContaining({ slot_name: "credentials", resource_id: "old-secret" }),
      expect.objectContaining({ slot_name: "storage", resource_id: "new-kv" }),
    ])
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
})
