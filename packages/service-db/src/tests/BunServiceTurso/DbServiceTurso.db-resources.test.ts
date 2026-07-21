import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { DbServiceTurso } from "../../../src/DbServiceTurso/DbServiceTurso"

const testUuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`
const IDS = {
  dbNotes: testUuid(401), draftOne: testUuid(402), draftTwo: testUuid(403),
  kv: testUuid(404), dbLoading: testUuid(405), badKind: testUuid(406), notReady: testUuid(407),
  draft: testUuid(408), db: testUuid(409), draft1: testUuid(410), draft2: testUuid(411),
  draft3: testUuid(412), apply1: testUuid(413), apply2: testUuid(414), apply3: testUuid(415),
  applyOne: testUuid(416), applyTwo: testUuid(417), restoreOne: testUuid(418),
  dbAtomic: testUuid(419), draftAtomic: testUuid(420), duplicateApply: testUuid(421),
  applyAtomic: testUuid(422), missingDraft: testUuid(423), canvas: testUuid(424),
  runningInstance: testUuid(425), stoppedInstance: testUuid(426), apply: testUuid(427),
  instance: testUuid(428), restore: testUuid(429),
} as const

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
    await db.actorResource.create({ id: IDS.dbNotes, kind: "db", name: "Notes", status: "ready" })

    await expect(db.dbResource.draft.create({
      id: IDS.draftOne,
      resourceId: IDS.dbNotes,
      name: "Add note labels",
    })).resolves.toMatchObject({
      id: IDS.draftOne,
      resource_id: IDS.dbNotes,
      name: "Add note labels",
      status: "editing",
      last_error: null,
      applied_at: null,
    })
    await expect(db.dbResource.draft.getActive({ resourceId: IDS.dbNotes })).resolves.toMatchObject({ id: IDS.draftOne })
    await expect(db.dbResource.draft.create({
      id: IDS.draftTwo,
      resourceId: IDS.dbNotes,
      name: "Competing draft",
    })).rejects.toBeDefined()

    await expect(db.dbResource.draft.rename({ id: IDS.draftOne, name: "Labels and colors" })).resolves.toMatchObject({
      name: "Labels and colors",
    })
    await expect(db.dbResource.draft.discard({ id: IDS.draftOne })).resolves.toMatchObject({ status: "discarded" })
    await expect(db.dbResource.draft.getActive({ resourceId: IDS.dbNotes })).resolves.toBeNull()
    await expect(db.dbResource.draft.create({
      id: IDS.draftTwo,
      resourceId: IDS.dbNotes,
      name: "Replacement",
    })).resolves.toMatchObject({ status: "editing" })

    const drafts = await db.dbResource.draft.list({ resourceId: IDS.dbNotes })
    expect(drafts.map((draft) => draft.id)).toEqual([IDS.draftTwo, IDS.draftOne])
  })

  test("requires a ready database resource for draft creation", async () => {
    await db.actorResource.create({ id: IDS.kv, kind: "kv", name: "KV", status: "ready" })
    await db.actorResource.create({ id: IDS.dbLoading, kind: "db", name: "Loading", status: "provisioning" })

    await expect(db.dbResource.draft.create({ id: IDS.badKind, resourceId: IDS.kv, name: "No" })).rejects.toThrow(
      "not an available DbResource",
    )
    await expect(db.dbResource.draft.create({
      id: IDS.notReady,
      resourceId: IDS.dbLoading,
      name: "No",
    })).rejects.toThrow("not an available DbResource")
  })

  test("stores ordered structured and raw changes with exact SQL", async () => {
    await db.actorResource.create({ id: IDS.dbNotes, kind: "db", name: "Notes", status: "ready" })
    await db.dbResource.draft.create({ id: IDS.draft, resourceId: IDS.dbNotes, name: "Structure" })
    const exactSql = "ALTER TABLE \"notes\" ADD COLUMN \"color\" TEXT;\r\n"

    await expect(db.dbResource.draft.change.append({
      draftId: IDS.draft,
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
      draftId: IDS.draft,
      sequence: 2,
      kind: "sql",
      sql: "CREATE INDEX notes_color_idx ON notes(color);",
    })

    await expect(db.dbResource.draft.change.list({ draftId: IDS.draft })).resolves.toMatchObject([
      { sequence: 1, sql: exactSql },
      { sequence: 2, kind: "sql", operation: null },
    ])
    await db.dbResource.draft.updateStatus({ id: IDS.draft, status: "applying", expectedStatus: "editing" })
    await expect(db.dbResource.draft.change.append({
      draftId: IDS.draft,
      sequence: 3,
      kind: "sql",
      sql: "DROP TABLE notes;",
    })).rejects.toThrow("is not editable")
  })

  test("cursor-paginates bounded draft and apply history without offsets", async () => {
    await db.actorResource.create({ id: IDS.db, kind: "db", name: "DB", status: "ready" })
    for (const id of [IDS.draft1, IDS.draft2, IDS.draft3]) {
      await db.dbResource.draft.create({ id, resourceId: IDS.db, name: id })
      await db.dbResource.draft.discard({ id })
    }
    const draftPage = await db.dbResource.draft.list({ resourceId: IDS.db, limit: 2 })
    expect(draftPage.map((draft) => draft.id)).toEqual([IDS.draft3, IDS.draft2])
    await expect(db.dbResource.draft.list({
      resourceId: IDS.db,
      before: { createdAt: draftPage[1]!.created_at, id: draftPage[1]!.id },
      limit: 2,
    })).resolves.toMatchObject([{ id: IDS.draft1 }])
    await expect(db.dbResource.draft.list({ resourceId: IDS.db, limit: 201 })).rejects.toThrow("between 1 and 200")

    for (const id of [IDS.apply1, IDS.apply2, IDS.apply3]) {
      await db.dbResource.apply.create({ id, resourceId: IDS.db })
      await db.dbResource.apply.update({ id, status: "succeeded", expectedStatus: "preparing" })
    }
    const applyPage = await db.dbResource.apply.list({ resourceId: IDS.db, limit: 2 })
    expect(applyPage.map((apply) => apply.id)).toEqual([IDS.apply3, IDS.apply2])
    await expect(db.dbResource.apply.list({
      resourceId: IDS.db,
      before: { createdAt: applyPage[1]!.created_at, id: applyPage[1]!.id },
      limit: 2,
    })).resolves.toMatchObject([{ id: IDS.apply1 }])
    await expect(db.dbResource.apply.list({ resourceId: IDS.db, limit: 101 })).rejects.toThrow("between 1 and 100")
  })

  test("persists apply lifecycle separately from draft state and retains recovery metadata", async () => {
    await db.actorResource.create({ id: IDS.dbNotes, kind: "db", name: "Notes", status: "ready" })
    await db.dbResource.draft.create({ id: IDS.draft, resourceId: IDS.dbNotes, name: "Structure" })

    await expect(db.dbResource.apply.create({ id: IDS.applyOne, resourceId: IDS.dbNotes, draftId: IDS.draft })).resolves.toMatchObject({
      status: "preparing",
      backup_retained: false,
      completed_at: null,
    })
    await expect(db.dbResource.apply.create({ id: IDS.applyTwo, resourceId: IDS.dbNotes, draftId: IDS.draft })).rejects.toBeDefined()
    await expect(db.dbResource.apply.update({
      id: IDS.applyOne,
      status: "stopping",
      expectedStatus: "preparing",
    })).resolves.toMatchObject({ status: "stopping" })
    await expect(db.dbResource.apply.update({
      id: IDS.applyOne,
      status: "succeeded",
      expectedStatus: "stopping",
      backupRetained: true,
    })).resolves.toMatchObject({ status: "succeeded", backup_retained: true })

    const completed = await db.dbResource.apply.get({ id: IDS.applyOne })
    expect(completed?.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    await expect(db.dbResource.draft.updateStatus({
      id: IDS.draft,
      status: "applied",
      expectedStatus: "editing",
    })).resolves.toMatchObject({ status: "applied", applied_at: expect.any(String) })

    await expect(db.dbResource.apply.create({
      id: IDS.restoreOne,
      resourceId: IDS.dbNotes,
      draftId: null,
      sourceApplyId: IDS.applyOne,
    })).resolves.toMatchObject({ draft_id: null, source_apply_id: IDS.applyOne, status: "preparing" })
    await expect(db.dbResource.apply.update({
      id: IDS.restoreOne,
      status: "recovered",
      lastError: { code: "DB_RESOURCE_APPLY_RECOVERED", message: "Backup restored" },
    })).resolves.toMatchObject({
      status: "recovered",
      last_error: { code: "DB_RESOURCE_APPLY_RECOVERED", message: "Backup restored" },
    })

    const firstCompletedAt = "2100-01-01T00:00:00.000Z"
    await (await db.db.prepare("UPDATE db_resource_apply_runs SET completed_at_ms = ? WHERE id = ?")).run(4102444800000, IDS.applyOne)
    await db.dbResource.apply.update({
      id: IDS.applyOne,
      status: "succeeded",
      backupRetained: false,
    })
    expect((await db.dbResource.apply.get({ id: IDS.applyOne }))?.completed_at).toBe(firstCompletedAt)
  })

  test("atomically admits and completes a draft apply", async () => {
    await db.actorResource.create({ id: IDS.dbAtomic, kind: "db", name: "Atomic", status: "ready" })
    await db.dbResource.draft.create({ id: IDS.draftAtomic, resourceId: IDS.dbAtomic, name: "Atomic draft" })
    await db.dbResource.apply.create({ id: IDS.duplicateApply, resourceId: IDS.dbAtomic })
    await db.dbResource.apply.update({ id: IDS.duplicateApply, status: "succeeded", expectedStatus: "preparing" })

    await expect(db.dbResource.apply.createFromDraft({
      id: IDS.duplicateApply,
      resourceId: IDS.dbAtomic,
      draftId: IDS.draftAtomic,
    })).rejects.toBeDefined()
    expect(await db.dbResource.draft.get({ id: IDS.draftAtomic })).toMatchObject({ status: "editing" })

    const admitted = await db.dbResource.apply.createFromDraft({
      id: IDS.applyAtomic,
      resourceId: IDS.dbAtomic,
      draftId: IDS.draftAtomic,
    })
    expect(admitted).toMatchObject({
      apply: { id: IDS.applyAtomic, status: "preparing", draft_id: IDS.draftAtomic },
      draft: { id: IDS.draftAtomic, status: "applying" },
    })
    await db.dbResource.apply.update({ id: IDS.applyAtomic, status: "restarting", expectedStatus: "preparing" })
    await expect(db.dbResource.apply.finishWithDraft({
      id: IDS.applyAtomic,
      draftId: IDS.missingDraft,
      status: "succeeded",
      expectedStatus: "restarting",
      draftStatus: "applied",
    })).rejects.toBeDefined()
    expect(await db.dbResource.apply.get({ id: IDS.applyAtomic })).toMatchObject({ status: "restarting" })
    const completed = await db.dbResource.apply.finishWithDraft({
      id: IDS.applyAtomic,
      draftId: IDS.draftAtomic,
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
    await db.canvas.create({ id: IDS.canvas, name: "Canvas", automerge_url: "automerge:db-resource" })
    await db.actor.insertDefinition({
      name: "Notes Widget",
      slug: "notes-widget",
      url: null,
      description: null,
      manifest_path: "widgets/notes/vibecanvas.json",
    })
    await db.actorResource.create({ id: IDS.dbNotes, kind: "db", name: "Notes", status: "ready" })
    await db.actorResource.upsertBinding({
      definitionName: "Notes Widget",
      slotName: "notes",
      resourceId: IDS.dbNotes,
      allowRead: true,
      allowWrite: true,
    })
    for (const [id, status] of [[IDS.runningInstance, "running"], [IDS.stoppedInstance, "stopped"]] as const) {
      await db.actor.insertInstance({
        id,
        canvas_id: IDS.canvas,
        element_id: `element-${id}`,
        actor_definition_name: "Notes Widget",
        filesystem_id: null,
        display_name: id,
        status,
        machine_state: "ready",
        machine_context: { persisted: true },
      })
    }

    await expect(db.dbResource.listAffectedInstances({ resourceId: IDS.dbNotes })).resolves.toMatchObject([
      { id: IDS.runningInstance, machine_context: { persisted: true } },
      { id: IDS.stoppedInstance, machine_context: { persisted: true } },
    ])
    await db.dbResource.apply.create({ id: IDS.apply, resourceId: IDS.dbNotes })
    await db.dbResource.apply.instanceResult.upsert({
      applyId: IDS.apply,
      actorInstanceId: IDS.runningInstance,
      actorDefinitionName: "Notes Widget",
      wasRunning: true,
      status: "pendingStop",
    })
    await expect(db.dbResource.apply.instanceResult.upsert({
      applyId: IDS.apply,
      actorInstanceId: IDS.runningInstance,
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
      applyId: IDS.apply,
      actorInstanceId: IDS.stoppedInstance,
      actorDefinitionName: "Notes Widget",
      wasRunning: false,
      status: "notRunning",
    })

    await expect(db.dbResource.apply.instanceResult.listByApply({ applyId: IDS.apply })).resolves.toMatchObject([
      { actor_instance_id: IDS.runningInstance, status: "startFailed" },
      { actor_instance_id: IDS.stoppedInstance, status: "notRunning", was_running: false },
    ])
    await expect(db.dbResource.apply.instanceResult.listByInstance({
      actorInstanceId: IDS.runningInstance,
    })).resolves.toHaveLength(1)
  })

  test("resource deletion cascades drafts, apply runs, and instance results", async () => {
    await db.canvas.create({ id: IDS.canvas, name: "Canvas", automerge_url: "automerge:cascade" })
    await db.actor.insertDefinition({
      name: "Widget",
      slug: "widget",
      url: null,
      description: null,
      manifest_path: "widgets/widget/vibecanvas.json",
    })
    await db.actor.insertInstance({
      id: IDS.instance,
      canvas_id: IDS.canvas,
      element_id: "element",
      actor_definition_name: "Widget",
      filesystem_id: null,
      display_name: "Widget",
      status: "stopped",
      machine_state: "ready",
      machine_context: {},
    })
    await db.actorResource.create({ id: IDS.db, kind: "db", name: "DB", status: "ready" })
    await db.dbResource.draft.create({ id: IDS.draft, resourceId: IDS.db, name: "Draft" })
    await db.dbResource.apply.create({ id: IDS.apply, resourceId: IDS.db, draftId: IDS.draft })
    await db.dbResource.apply.instanceResult.upsert({
      applyId: IDS.apply,
      actorInstanceId: IDS.instance,
      actorDefinitionName: "Widget",
      wasRunning: false,
      status: "notRunning",
    })
    await db.dbResource.apply.update({ id: IDS.apply, status: "succeeded", backupRetained: true })
    await db.dbResource.apply.create({ id: IDS.restore, resourceId: IDS.db, sourceApplyId: IDS.apply })
    await db.dbResource.apply.update({ id: IDS.restore, status: "succeeded" })

    await db.actorResource.beginDelete({ id: IDS.db })
    await db.actorResource.delete({ id: IDS.db })
    await expect(db.dbResource.draft.get({ id: IDS.draft })).resolves.toBeNull()
    await expect(db.dbResource.apply.get({ id: IDS.apply })).resolves.toBeNull()
    await expect(db.dbResource.apply.get({ id: IDS.restore })).resolves.toBeNull()
    await expect(db.dbResource.apply.instanceResult.listByApply({ applyId: IDS.apply })).resolves.toEqual([])
  })
})
