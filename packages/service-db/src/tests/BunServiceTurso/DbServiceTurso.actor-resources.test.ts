import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { DbServiceTurso } from "../../../src/DbServiceTurso/DbServiceTurso"

const testUuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`
const KV_A = testUuid(301)
const SECRET_A = testUuid(302)
const RAW_A = testUuid(303)
const RAW_B = testUuid(304)
const OLD_KV = testUuid(305)
const OLD_SECRET = testUuid(306)
const NEW_KV = testUuid(307)
const MISSING = testUuid(308)
const KV_B = testUuid(309)
const KV_CREATED = testUuid(310)

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
      id: KV_A,
      kind: "kv",
      name: "  ShÁred  ",
      status: "ready",
    })
    await expect(db.actorResource.create({
      id: SECRET_A,
      kind: "secretStore",
      name: "sha\u0301RED",
      status: "ready",
    })).rejects.toMatchObject({ code: "RESOURCE_NAME_CONFLICT" })

    await expect(db.actorResource.list({ kind: "kv" })).resolves.toMatchObject([
      { id: KV_A, kind: "kv", name: "ShÁred" },
    ])
    await expect(db.actorResource.list({ status: "ready" })).resolves.toHaveLength(1)
    await expect(db.actorResource.findByNameKey({ nameKey: "sháred" })).resolves.toMatchObject([{ id: KV_A }])
    await expect(db.actorResource.rename({ id: KV_A, name: "Preferences" })).resolves.toMatchObject({
      id: KV_A,
      name: "Preferences",
    })
    await expect(db.actorResource.updateProviderState({
      id: KV_A,
      status: "error",
      lastError: { code: "TEST_FAILURE" },
    })).resolves.toMatchObject({
      status: "error",
      last_error: { code: "TEST_FAILURE" },
    })
    expect("metadata" in (await db.actorResource.get({ id: KV_A }))!).toBe(false)
    await expect(db.actorResource.updateProviderState({ id: KV_A, status: "ready", lastError: null })).resolves.toMatchObject({
      status: "ready",
      last_error: null,
    })
    await expect(db.actorResource.create({
      id: SECRET_A,
      kind: "secretStore",
      name: "Shared",
      status: "ready",
    })).resolves.toMatchObject({ id: SECRET_A })
    await expect(db.actorResource.rename({ id: SECRET_A, name: " preferences " }))
      .rejects.toMatchObject({ code: "RESOURCE_NAME_CONFLICT" })
  })

  test("guards exact organization-scoped names at the database boundary", async () => {
    const insert = await db.db.prepare(`
      INSERT INTO resource_catalog (
        org_id, id, kind, name, status, last_error_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, 'ready', NULL, 1, 1)
    `)
    await insert.run("00000000-0000-4000-8000-000000000001", RAW_A, "kv", "Guarded")
    await expect(insert.run("00000000-0000-4000-8000-000000000001", RAW_B, "db", "Guarded"))
      .rejects.toThrow()
  })

  test("replaces a complete binding set transactionally when a later resource is invalid", async () => {
    await insertDefinition(db, "Atomic bindings", "atomic-bindings")
    await db.actorResource.create({ id: OLD_KV, kind: "kv", name: "Old KV", status: "ready" })
    await db.actorResource.create({ id: OLD_SECRET, kind: "secretStore", name: "Old secret", status: "ready" })
    await db.actorResource.create({ id: NEW_KV, kind: "kv", name: "New KV", status: "ready" })
    await db.actorResource.upsertBinding({
      definitionName: "Atomic bindings", slotName: "storage", resourceId: OLD_KV, allowRead: true, allowWrite: false,
    })
    await db.actorResource.upsertBinding({
      definitionName: "Atomic bindings", slotName: "credentials", resourceId: OLD_SECRET, allowRead: true, allowWrite: true,
    })

    await expect(db.actorResource.replaceBindings({
      definitionName: "Atomic bindings",
      bindings: [
        { slotName: "storage", resourceId: NEW_KV, allowRead: true, allowWrite: true },
        { slotName: "credentials", resourceId: MISSING, allowRead: true, allowWrite: false },
      ],
    })).rejects.toThrow("not ready")

    expect(await db.actorResource.listBindingsForDefinition({ definitionName: "Atomic bindings" })).toEqual([
      expect.objectContaining({ slot_name: "credentials", resource_id: OLD_SECRET, allow_read: true, allow_write: true }),
      expect.objectContaining({ slot_name: "storage", resource_id: OLD_KV, allow_read: true, allow_write: false }),
    ])

    await db.actorResource.upsertBinding({
      definitionName: "Atomic bindings", slotName: "storage", resourceId: NEW_KV, allowRead: true, allowWrite: false,
    })
    await expect(db.actorResource.replaceBindings({
      definitionName: "Atomic bindings",
      expectedBindings: [
        { slotName: "credentials", resourceId: OLD_SECRET, allowRead: true, allowWrite: true },
        { slotName: "storage", resourceId: OLD_KV, allowRead: true, allowWrite: false },
      ],
      bindings: [],
    })).rejects.toMatchObject({ code: "RESOURCE_BINDING_CONFLICT" })
    expect(await db.actorResource.listBindingsForDefinition({ definitionName: "Atomic bindings" })).toEqual([
      expect.objectContaining({ slot_name: "credentials", resource_id: OLD_SECRET }),
      expect.objectContaining({ slot_name: "storage", resource_id: NEW_KV }),
    ])
  })

  test("upserts definition-level bindings, blocks bound deletion, and cascades definition deletion", async () => {
    await insertDefinition(db, "Definition A", "definition-a")
    await insertDefinition(db, "Definition B", "definition-b")
    await db.actorResource.create({ id: KV_A, kind: "kv", name: "A", status: "ready" })
    await db.actorResource.create({ id: KV_B, kind: "kv", name: "B", status: "ready" })

    await expect(db.actorResource.upsertBinding({
      definitionName: "Definition A",
      slotName: "preferences",
      resourceId: KV_A,
      allowRead: true,
      allowWrite: false,
    })).resolves.toMatchObject({
      actor_definition_name: "Definition A",
      slot_name: "preferences",
      resource_id: KV_A,
      allow_read: true,
      allow_write: false,
    })

    await db.actorResource.upsertBinding({
      definitionName: "Definition B",
      slotName: "preferences",
      resourceId: KV_A,
      allowRead: true,
      allowWrite: true,
    })
    await expect(db.actorResource.listDefinitionsReferencingResource({ resourceId: KV_A })).resolves.toMatchObject([
      { name: "Definition A" },
      { name: "Definition B" },
    ])
    await expect(db.actorResource.beginDelete({ id: KV_A })).resolves.toBeNull()

    await expect(db.actorResource.upsertBinding({
      definitionName: "Definition A",
      slotName: "preferences",
      resourceId: KV_B,
      allowRead: true,
      allowWrite: true,
    })).resolves.toMatchObject({ resource_id: KV_B, allow_write: true })
    await db.actor.deleteDefinition("Definition B")
    await expect(db.actorResource.listBindingsForResource({ resourceId: KV_A })).resolves.toEqual([])

    await expect(db.actorResource.beginDelete({ id: KV_A })).resolves.toMatchObject({ status: "deleting" })
    await expect(db.actorResource.delete({ id: KV_A })).resolves.toBe(true)
    await expect(db.actorResource.get({ id: KV_A })).resolves.toBeNull()
  })

  test("refuses bindings to resources that are not ready and rejects empty permission sets", async () => {
    await insertDefinition(db, "Definition A", "definition-a")
    await db.actorResource.create({ id: KV_CREATED, kind: "kv", name: "Created" })

    await expect(db.actorResource.upsertBinding({
      definitionName: "Definition A",
      slotName: "storage",
      resourceId: KV_CREATED,
      allowRead: true,
      allowWrite: false,
    })).resolves.toBeNull()

    await db.actorResource.updateProviderState({ id: KV_CREATED, status: "ready" })
    await expect(db.actorResource.upsertBinding({
      definitionName: "Definition A",
      slotName: "storage",
      resourceId: KV_CREATED,
      allowRead: false,
      allowWrite: false,
    })).rejects.toBeInstanceOf(Error)
  })
})
