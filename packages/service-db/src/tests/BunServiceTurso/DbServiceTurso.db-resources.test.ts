import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { DbServiceTurso } from "../../../src/DbServiceTurso/DbServiceTurso"

describe("DbServiceTurso DbResource draft/apply persistence", () => {
  let db!: DbServiceTurso

  beforeEach(async () => {
    db = new DbServiceTurso({ databasePath: ":memory:", dataDir: ".", cacheDir: "." })
    await db.start()
  })

  afterEach(async () => {
    await db.db.close()
  })

  test("creates one active resource-local draft and permits a new one after discard", async () => {
    await db.actorResource.create({ id: "db-notes", kind: "db", name: "Notes", status: "ready" })

    await expect(db.dbResource.draft.create({
      id: "draft-one",
      resourceId: "db-notes",
      name: "Add note labels",
    })).resolves.toMatchObject({
      id: "draft-one",
      resource_id: "db-notes",
      name: "Add note labels",
      status: "editing",
      last_error: null,
      applied_at: null,
    })
    await expect(db.dbResource.draft.getActive({ resourceId: "db-notes" })).resolves.toMatchObject({ id: "draft-one" })
    await expect(db.dbResource.draft.create({
      id: "draft-two",
      resourceId: "db-notes",
      name: "Competing draft",
    })).rejects.toBeDefined()

    await expect(db.dbResource.draft.rename({ id: "draft-one", name: "Labels and colors" })).resolves.toMatchObject({
      name: "Labels and colors",
    })
    await expect(db.dbResource.draft.discard({ id: "draft-one" })).resolves.toMatchObject({ status: "discarded" })
    await expect(db.dbResource.draft.getActive({ resourceId: "db-notes" })).resolves.toBeNull()
    await expect(db.dbResource.draft.create({
      id: "draft-two",
      resourceId: "db-notes",
      name: "Replacement",
    })).resolves.toMatchObject({ status: "editing" })

    const drafts = await db.dbResource.draft.list({ resourceId: "db-notes" })
    expect(drafts.map((draft) => draft.id)).toEqual(["draft-two", "draft-one"])
  })

  test("requires a ready database resource for draft creation", async () => {
    await db.actorResource.create({ id: "kv", kind: "kv", name: "KV", status: "ready" })
    await db.actorResource.create({ id: "db-loading", kind: "db", name: "Loading", status: "provisioning" })

    await expect(db.dbResource.draft.create({ id: "bad-kind", resourceId: "kv", name: "No" })).rejects.toThrow(
      "not an available DbResource",
    )
    await expect(db.dbResource.draft.create({
      id: "not-ready",
      resourceId: "db-loading",
      name: "No",
    })).rejects.toThrow("not an available DbResource")
  })

  test("stores ordered structured and raw changes with exact SQL", async () => {
    await db.actorResource.create({ id: "db-notes", kind: "db", name: "Notes", status: "ready" })
    await db.dbResource.draft.create({ id: "draft", resourceId: "db-notes", name: "Structure" })
    const exactSql = "ALTER TABLE \"notes\" ADD COLUMN \"color\" TEXT;\r\n"

    await expect(db.dbResource.draft.change.append({
      draftId: "draft",
      sequence: 1,
      kind: "structure",
      operation: { type: "addColumn", table: "notes", column: "color" },
      sql: exactSql,
    })).resolves.toMatchObject({
      sequence: 1,
      kind: "structure",
      operation: { type: "addColumn", table: "notes", column: "color" },
      sql: exactSql,
    })
    await db.dbResource.draft.change.append({
      draftId: "draft",
      sequence: 2,
      kind: "sql",
      sql: "CREATE INDEX notes_color_idx ON notes(color);",
    })

    await expect(db.dbResource.draft.change.list({ draftId: "draft" })).resolves.toMatchObject([
      { sequence: 1, sql: exactSql },
      { sequence: 2, kind: "sql", operation: null },
    ])
    await db.dbResource.draft.updateStatus({ id: "draft", status: "applying", expectedStatus: "editing" })
    await expect(db.dbResource.draft.change.append({
      draftId: "draft",
      sequence: 3,
      kind: "sql",
      sql: "DROP TABLE notes;",
    })).rejects.toThrow("is not editable")
  })

  test("cursor-paginates bounded draft and apply history without offsets", async () => {
    await db.actorResource.create({ id: "db", kind: "db", name: "DB", status: "ready" })
    for (const id of ["draft-1", "draft-2", "draft-3"]) {
      await db.dbResource.draft.create({ id, resourceId: "db", name: id })
      await db.dbResource.draft.discard({ id })
    }
    const draftPage = await db.dbResource.draft.list({ resourceId: "db", limit: 2 })
    expect(draftPage.map((draft) => draft.id)).toEqual(["draft-3", "draft-2"])
    await expect(db.dbResource.draft.list({
      resourceId: "db",
      before: { createdAt: draftPage[1]!.created_at, id: draftPage[1]!.id },
      limit: 2,
    })).resolves.toMatchObject([{ id: "draft-1" }])
    await expect(db.dbResource.draft.list({ resourceId: "db", limit: 201 })).rejects.toThrow("between 1 and 200")

    for (const id of ["apply-1", "apply-2", "apply-3"]) {
      await db.dbResource.apply.create({ id, resourceId: "db" })
      await db.dbResource.apply.update({ id, status: "succeeded", expectedStatus: "preparing" })
    }
    const applyPage = await db.dbResource.apply.list({ resourceId: "db", limit: 2 })
    expect(applyPage.map((apply) => apply.id)).toEqual(["apply-3", "apply-2"])
    await expect(db.dbResource.apply.list({
      resourceId: "db",
      before: { createdAt: applyPage[1]!.created_at, id: applyPage[1]!.id },
      limit: 2,
    })).resolves.toMatchObject([{ id: "apply-1" }])
    await expect(db.dbResource.apply.list({ resourceId: "db", limit: 101 })).rejects.toThrow("between 1 and 100")
  })

  test("persists apply lifecycle separately from draft state and retains recovery metadata", async () => {
    await db.actorResource.create({ id: "db-notes", kind: "db", name: "Notes", status: "ready" })
    await db.dbResource.draft.create({ id: "draft", resourceId: "db-notes", name: "Structure" })

    await expect(db.dbResource.apply.create({ id: "apply-one", resourceId: "db-notes", draftId: "draft" })).resolves.toMatchObject({
      status: "preparing",
      backup_retained: false,
      completed_at: null,
    })
    await expect(db.dbResource.apply.create({ id: "apply-two", resourceId: "db-notes", draftId: "draft" })).rejects.toBeDefined()
    await expect(db.dbResource.apply.update({
      id: "apply-one",
      status: "stopping",
      expectedStatus: "preparing",
    })).resolves.toMatchObject({ status: "stopping" })
    await expect(db.dbResource.apply.update({
      id: "apply-one",
      status: "succeeded",
      expectedStatus: "stopping",
      backupRetained: true,
    })).resolves.toMatchObject({ status: "succeeded", backup_retained: true })

    const completed = await db.dbResource.apply.get({ id: "apply-one" })
    expect(completed?.completed_at).toMatch(/^\d{4}-\d{2}-\d{2} /)
    await expect(db.dbResource.draft.updateStatus({
      id: "draft",
      status: "applied",
      expectedStatus: "editing",
    })).resolves.toMatchObject({ status: "applied", applied_at: expect.any(String) })

    await expect(db.dbResource.apply.create({
      id: "restore-one",
      resourceId: "db-notes",
      draftId: null,
      sourceApplyId: "apply-one",
    })).resolves.toMatchObject({ draft_id: null, source_apply_id: "apply-one", status: "preparing" })
    await expect(db.dbResource.apply.update({
      id: "restore-one",
      status: "recovered",
      lastError: { code: "DB_RESOURCE_APPLY_RECOVERED", message: "Backup restored" },
    })).resolves.toMatchObject({
      status: "recovered",
      last_error: { code: "DB_RESOURCE_APPLY_RECOVERED", message: "Backup restored" },
    })

    const firstCompletedAt = "2000-01-01 00:00:00"
    await (await db.db.prepare("UPDATE db_resource_apply_runs SET completed_at = ? WHERE id = ?")).run(firstCompletedAt, "apply-one")
    await db.dbResource.apply.update({
      id: "apply-one",
      status: "succeeded",
      backupRetained: false,
    })
    expect((await db.dbResource.apply.get({ id: "apply-one" }))?.completed_at).toBe(firstCompletedAt)
  })

  test("atomically admits and completes a draft apply", async () => {
    await db.actorResource.create({ id: "db-atomic", kind: "db", name: "Atomic", status: "ready" })
    await db.dbResource.draft.create({ id: "draft-atomic", resourceId: "db-atomic", name: "Atomic draft" })
    await db.dbResource.apply.create({ id: "duplicate-apply", resourceId: "db-atomic" })
    await db.dbResource.apply.update({ id: "duplicate-apply", status: "succeeded", expectedStatus: "preparing" })

    await expect(db.dbResource.apply.createFromDraft({
      id: "duplicate-apply",
      resourceId: "db-atomic",
      draftId: "draft-atomic",
    })).rejects.toBeDefined()
    expect(await db.dbResource.draft.get({ id: "draft-atomic" })).toMatchObject({ status: "editing" })

    const admitted = await db.dbResource.apply.createFromDraft({
      id: "apply-atomic",
      resourceId: "db-atomic",
      draftId: "draft-atomic",
    })
    expect(admitted).toMatchObject({
      apply: { id: "apply-atomic", status: "preparing", draft_id: "draft-atomic" },
      draft: { id: "draft-atomic", status: "applying" },
    })
    await db.dbResource.apply.update({ id: "apply-atomic", status: "restarting", expectedStatus: "preparing" })
    await expect(db.dbResource.apply.finishWithDraft({
      id: "apply-atomic",
      draftId: "missing-draft",
      status: "succeeded",
      expectedStatus: "restarting",
      draftStatus: "applied",
    })).rejects.toBeDefined()
    expect(await db.dbResource.apply.get({ id: "apply-atomic" })).toMatchObject({ status: "restarting" })
    const completed = await db.dbResource.apply.finishWithDraft({
      id: "apply-atomic",
      draftId: "draft-atomic",
      status: "succeeded",
      expectedStatus: "restarting",
      draftStatus: "applied",
      backupRetained: true,
    })
    expect(completed).toMatchObject({
      apply: { status: "succeeded", backup_retained: true },
      draft: { status: "applied" },
    })
  })

  test("persists and updates every affected instance outcome", async () => {
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
    await db.dbResource.apply.create({ id: "apply", resourceId: "db-notes" })
    await db.dbResource.apply.instanceResult.upsert({
      applyId: "apply",
      actorInstanceId: "running-instance",
      actorDefinitionName: "Notes Widget",
      wasRunning: true,
      status: "pendingStop",
    })
    await expect(db.dbResource.apply.instanceResult.upsert({
      applyId: "apply",
      actorInstanceId: "running-instance",
      actorDefinitionName: "Notes Widget",
      wasRunning: true,
      status: "startFailed",
      error: { code: "ACTOR_START_FAILED", message: "Observed start failure" },
    })).resolves.toMatchObject({
      was_running: true,
      status: "startFailed",
      error: { code: "ACTOR_START_FAILED" },
    })
    await db.dbResource.apply.instanceResult.upsert({
      applyId: "apply",
      actorInstanceId: "stopped-instance",
      actorDefinitionName: "Notes Widget",
      wasRunning: false,
      status: "notRunning",
    })

    await expect(db.dbResource.apply.instanceResult.listByApply({ applyId: "apply" })).resolves.toMatchObject([
      { actor_instance_id: "running-instance", status: "startFailed" },
      { actor_instance_id: "stopped-instance", status: "notRunning", was_running: false },
    ])
    await expect(db.dbResource.apply.instanceResult.listByInstance({
      actorInstanceId: "running-instance",
    })).resolves.toHaveLength(1)
  })

  test("resource deletion cascades drafts, apply runs, and instance results", async () => {
    await db.canvas.create({ id: "canvas", name: "Canvas", automerge_url: "automerge:cascade" })
    await db.actor.insertDefinition({
      name: "Widget",
      slug: "widget",
      url: null,
      description: null,
      manifest_path: "widgets/widget/vibecanvas.json",
    })
    await db.actor.insertInstance({
      id: "instance",
      canvas_id: "canvas",
      element_id: "element",
      actor_definition_name: "Widget",
      filesystem_id: null,
      display_name: "Widget",
      status: "stopped",
      machine_state: "ready",
      machine_context: {},
    })
    await db.actorResource.create({ id: "db", kind: "db", name: "DB", status: "ready" })
    await db.dbResource.draft.create({ id: "draft", resourceId: "db", name: "Draft" })
    await db.dbResource.apply.create({ id: "apply", resourceId: "db", draftId: "draft" })
    await db.dbResource.apply.instanceResult.upsert({
      applyId: "apply",
      actorInstanceId: "instance",
      actorDefinitionName: "Widget",
      wasRunning: false,
      status: "notRunning",
    })
    await db.dbResource.apply.update({ id: "apply", status: "succeeded", backupRetained: true })
    await db.dbResource.apply.create({ id: "restore", resourceId: "db", sourceApplyId: "apply" })
    await db.dbResource.apply.update({ id: "restore", status: "succeeded" })

    await db.actorResource.beginDelete({ id: "db" })
    await db.actorResource.delete({ id: "db" })
    await expect(db.dbResource.draft.get({ id: "draft" })).resolves.toBeNull()
    await expect(db.dbResource.apply.get({ id: "apply" })).resolves.toBeNull()
    await expect(db.dbResource.apply.get({ id: "restore" })).resolves.toBeNull()
    await expect(db.dbResource.apply.instanceResult.listByApply({ applyId: "apply" })).resolves.toEqual([])
  })
})
