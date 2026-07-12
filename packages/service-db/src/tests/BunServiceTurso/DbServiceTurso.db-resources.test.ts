import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { DbServiceTurso } from "../../../src/DbServiceTurso/DbServiceTurso"

async function expectFailure(action: () => Promise<unknown>) {
  let failure: unknown
  try {
    await action()
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
}

describe("DbServiceTurso DbResource control persistence", () => {
  let db!: DbServiceTurso

  beforeEach(async () => {
    db = new DbServiceTurso({ databasePath: ":memory:", dataDir: ".", cacheDir: "." })
    await db.start()
  })

  afterEach(async () => {
    await db.db.close()
  })

  test("publishes a contiguous initial schema and keeps published migrations immutable", async () => {
    await expect(db.dbResource.schema.create({ id: "notes", name: "Notes" })).resolves.toMatchObject({
      id: "notes",
      status: "draft",
    })
    await expect(db.dbResource.schema.updateDraft({ id: "notes", name: "Shared Notes", description: "Notes schema" })).resolves.toMatchObject({
      name: "Shared Notes",
      description: "Notes schema",
    })
    await db.dbResource.migration.createDraft({
      schemaId: "notes",
      version: 1,
      name: "initial",
      sql: "CREATE TABLE notes (id TEXT PRIMARY KEY) STRICT;\n",
      checksum: "sha256:one",
    })
    await db.dbResource.migration.createDraft({
      schemaId: "notes",
      version: 2,
      name: "add-title",
      sql: "ALTER TABLE notes ADD COLUMN title TEXT;\n",
      checksum: "sha256:two",
    })
    await expect(db.dbResource.migration.createDraft({
      schemaId: "notes",
      version: 4,
      name: "gap",
      sql: "SELECT 1;",
      checksum: "sha256:gap",
    })).rejects.toThrow("must be version 3")

    await expect(db.dbResource.schema.publish({ id: "notes" })).resolves.toMatchObject({ status: "published" })
    const published = await db.dbResource.migration.list({ schemaId: "notes", status: "published" })
    expect(published.map((migration) => [migration.version, migration.status, migration.published_at !== null])).toEqual([
      [1, "published", true],
      [2, "published", true],
    ])
    await expect(db.dbResource.migration.updateDraft({
      schemaId: "notes",
      version: 2,
      name: "mutated",
      sql: "DROP TABLE notes;",
      checksum: "sha256:changed",
    })).resolves.toBeNull()
    await expect(db.dbResource.schema.updateDraft({ id: "notes", name: "Mutated" })).resolves.toBeNull()
    await expect(db.dbResource.migration.get({ schemaId: "notes", version: 2 })).resolves.toMatchObject({
      name: "add-title",
      checksum: "sha256:two",
    })
  })

  test("allows one next draft on a published schema, then publishes and deprecates it", async () => {
    await db.dbResource.schema.create({ id: "notes", name: "Notes" })
    await db.dbResource.schema.publish({ id: "notes" })
    await db.dbResource.migration.createDraft({
      schemaId: "notes",
      version: 1,
      name: "initial",
      sql: "CREATE TABLE notes (id TEXT PRIMARY KEY) STRICT;",
      checksum: "sha256:one",
    })
    await expect(db.dbResource.migration.createDraft({
      schemaId: "notes",
      version: 2,
      name: "second-draft",
      sql: "SELECT 2;",
      checksum: "sha256:two",
    })).rejects.toThrow("only one draft")
    await expect(db.dbResource.migration.updateDraft({
      schemaId: "notes",
      version: 1,
      name: "initial-renamed",
      sql: "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT) STRICT;",
      checksum: "sha256:one-edited",
    })).resolves.toMatchObject({ status: "draft", checksum: "sha256:one-edited" })
    await expect(db.dbResource.schema.deprecate({ id: "notes" })).rejects.toThrow("draft migration")
    await expect(db.dbResource.migration.publish({ schemaId: "notes", version: 1 })).resolves.toMatchObject({ status: "published" })
    await expect(db.dbResource.schema.deprecate({ id: "notes" })).resolves.toMatchObject({ status: "deprecated" })
    await expect(db.dbResource.migration.createDraft({
      schemaId: "notes",
      version: 2,
      name: "after-deprecation",
      sql: "SELECT 2;",
      checksum: "sha256:two",
    })).rejects.toThrow("cannot accept migrations")
  })

  test("supports version zero and validates every positive configured version is published", async () => {
    await db.dbResource.schema.create({ id: "empty", name: "Empty" })
    await db.dbResource.schema.publish({ id: "empty" })
    await db.actorResource.create({ id: "db-empty", kind: "db", name: "Empty DB", status: "provisioning" })
    await expect(db.dbResource.configuration.create({ resourceId: "db-empty", schemaId: "empty" })).resolves.toMatchObject({
      schema_id: "empty",
      applied_version: 0,
      target_version: 0,
    })

    await db.dbResource.schema.create({ id: "notes", name: "Notes" })
    await db.dbResource.schema.publish({ id: "notes" })
    await db.dbResource.migration.createDraft({
      schemaId: "notes",
      version: 1,
      name: "initial",
      sql: "CREATE TABLE notes (id TEXT PRIMARY KEY) STRICT;",
      checksum: "sha256:one",
    })
    await db.actorResource.create({ id: "db-notes", kind: "db", name: "Notes DB", status: "provisioning" })
    await expect(db.dbResource.configuration.create({
      resourceId: "db-notes",
      schemaId: "notes",
      targetVersion: 1,
    })).rejects.toThrow("no published migration")

    await db.dbResource.migration.publish({ schemaId: "notes", version: 1 })
    await expect(db.dbResource.configuration.create({
      resourceId: "db-notes",
      schemaId: "notes",
      appliedVersion: 0,
      targetVersion: 1,
    })).resolves.toMatchObject({ applied_version: 0, target_version: 1 })
    await expect(db.dbResource.configuration.setVersions({
      resourceId: "db-notes",
      appliedVersion: 1,
      targetVersion: 1,
    })).resolves.toMatchObject({ applied_version: 1, target_version: 1 })
  })

  test("only moves migration targets forward and retains exact SQL bytes and checksums", async () => {
    const exactSql = "CREATE TABLE exact (id TEXT);\r\n-- exact trailing bytes\r\n"
    await db.dbResource.schema.create({ id: "exact", name: "Exact" })
    await db.dbResource.schema.publish({ id: "exact" })
    await db.dbResource.migration.createDraft({
      schemaId: "exact",
      version: 1,
      name: "initial",
      sql: exactSql,
      checksum: "sha256:exact",
    })
    await db.dbResource.migration.publish({ schemaId: "exact", version: 1 })
    await db.actorResource.create({ id: "db-exact", kind: "db", name: "Exact DB", status: "provisioning" })
    await db.dbResource.configuration.create({ resourceId: "db-exact", schemaId: "exact" })

    await expect(db.dbResource.configuration.setTargetVersion({ resourceId: "db-exact", targetVersion: 1 })).resolves.toMatchObject({
      applied_version: 0,
      target_version: 1,
    })
    await expect(db.dbResource.configuration.setTargetVersion({ resourceId: "db-exact", targetVersion: 0 })).rejects.toThrow("backwards")
    await expect(db.dbResource.migration.get({ schemaId: "exact", version: 1 })).resolves.toMatchObject({
      sql: exactSql,
      checksum: "sha256:exact",
    })
  })

  test("requires a published schema and a db-kind catalog resource for configurations", async () => {
    await db.dbResource.schema.create({ id: "draft", name: "Draft" })
    await db.actorResource.create({ id: "kv-a", kind: "kv", name: "KV", status: "ready" })
    await db.actorResource.create({ id: "db-a", kind: "db", name: "DB", status: "provisioning" })

    await expect(db.dbResource.configuration.create({ resourceId: "db-a", schemaId: "draft" })).rejects.toThrow("not published")
    await db.dbResource.schema.publish({ id: "draft" })
    await expect(db.dbResource.configuration.create({ resourceId: "kv-a", schemaId: "draft" })).rejects.toThrow("not an available DbResource")
  })

  test("lists affected instances and persists indexed migration blocks with restart intent", async () => {
    await db.canvas.create({ id: "canvas", name: "Canvas", automerge_url: "automerge:db-resource" })
    await db.actor.insertDefinition({
      name: "Notes Widget",
      slug: "notes-widget",
      url: null,
      description: null,
      manifest_path: "widgets/notes/vibecanvas.json",
    })
    await db.actorResource.create({ id: "db-notes", kind: "db", name: "Notes", status: "ready" })
    await db.actorResource.upsertBinding({
      definitionName: "Notes Widget",
      slotName: "notes",
      resourceId: "db-notes",
      allowRead: true,
      allowWrite: true,
    })
    for (const [id, status] of [["running-instance", "running"], ["stopped-instance", "stopped"]] as const) {
      await db.actor.insertInstance({
        id,
        canvas_id: "canvas",
        element_id: `element-${id}`,
        actor_definition_name: "Notes Widget",
        filesystem_id: null,
        display_name: id,
        status,
        machine_state: "ready",
        machine_context: { persisted: true },
      })
    }

    await expect(db.dbResource.listAffectedInstances({ resourceId: "db-notes" })).resolves.toMatchObject([
      { id: "running-instance", machine_context: { persisted: true } },
      { id: "stopped-instance", machine_context: { persisted: true } },
    ])
    await expect(db.dbResource.migrationBlock.upsert({
      resourceId: "db-notes",
      actorInstanceId: "running-instance",
      reason: "versionMismatch",
      restartWhenCompatible: true,
      expectedSchemaId: "notes",
      expectedVersion: 1,
      actualSchemaId: "notes",
      actualVersion: 2,
    })).resolves.toMatchObject({
      restart_when_compatible: true,
      expected_version: 1,
      actual_version: 2,
    })
    await expect(db.dbResource.migrationBlock.listByInstance({ actorInstanceId: "running-instance" })).resolves.toHaveLength(1)
    await expect(db.db.run(`
      INSERT INTO db_resource_migration_blocks (
        resource_id, actor_instance_id, reason, restart_when_compatible,
        expected_schema_id, expected_version, actual_schema_id, actual_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, "db-notes", "running-instance", "versionMismatch", true, "notes", 1, "notes", 2)).rejects.toBeDefined()
    await expect(db.db.run(`
      UPDATE db_resource_migration_blocks SET reason = ?
      WHERE resource_id = ? AND actor_instance_id = ?
    `, "unrelatedBlock", "db-notes", "running-instance")).rejects.toBeDefined()

    await db.actorResource.create({ id: "db-other", kind: "db", name: "Other", status: "ready" })
    await db.dbResource.migrationBlock.upsert({
      resourceId: "db-other",
      actorInstanceId: "running-instance",
      reason: "migrating",
      restartWhenCompatible: false,
      expectedSchemaId: "notes",
      expectedVersion: 1,
      actualSchemaId: "notes",
      actualVersion: 1,
    })
    await expect(db.dbResource.migrationBlock.listByResource({ resourceId: "db-notes" })).resolves.toHaveLength(1)
    await db.actorResource.beginDelete({ id: "db-other" })
    await db.actorResource.delete({ id: "db-other" })
    await expect(db.dbResource.migrationBlock.listByInstance({ actorInstanceId: "running-instance" })).resolves.toHaveLength(1)
    await db.actor.deleteInstance("running-instance")
    await expect(db.dbResource.migrationBlock.listByResource({ resourceId: "db-notes" })).resolves.toEqual([])
  })

  test("restricts schema deletion while referenced and cascades configuration with resource deletion", async () => {
    await db.dbResource.schema.create({ id: "notes", name: "Notes" })
    await db.dbResource.schema.publish({ id: "notes" })
    await db.actorResource.create({ id: "db-notes", kind: "db", name: "Notes", status: "ready" })
    await db.dbResource.configuration.create({ resourceId: "db-notes", schemaId: "notes" })

    await expectFailure(() => db.db.run("DELETE FROM db_resource_schemas WHERE id = ?", "notes"))
    await db.actorResource.beginDelete({ id: "db-notes" })
    await db.actorResource.delete({ id: "db-notes" })
    await expect(db.dbResource.configuration.get({ resourceId: "db-notes" })).resolves.toBeNull()
  })
})
