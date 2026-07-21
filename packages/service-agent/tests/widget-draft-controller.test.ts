import { afterEach, describe, expect, test } from "bun:test"
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  IEventPublisherService,
  TActorEvent,
  TAgentEvent,
  TDbEvent,
  TFilesystemEvent,
  TNotificationEvent,
} from "@vibecanvas/service-event-publisher/IEventPublisherService"
import { createWidgetWorkspaceTools } from "../src/tools/tool.widget-workspace"
import { fnBuildWidgetCreateManifest } from "../src/tools/fn.widget-create"
import { WidgetDraftController } from "../src/widget-drafts/WidgetDraftController"
import { WidgetManagement } from "../src/widget-management/WidgetManagement"
import { WidgetWorkspace } from "../src/workspace/WidgetWorkspace"
import { executeTool } from "./tool.test-helpers"

class TestEvents implements IEventPublisherService {
  name = "widget-draft-controller-events"
  agentEvents: TAgentEvent[] = []
  publishDbEvent(_canvasId: string, _event: TDbEvent): void {}
  async *subscribeDbEvents(_canvasId: string): AsyncIterable<TDbEvent> {}
  publishActorEvent(_event: TActorEvent): void {}
  async *subscribeActorEvents(): AsyncIterable<TActorEvent> {}
  publishAgentEvent(event: TAgentEvent): void { this.agentEvents.push(event) }
  async *subscribeAgentEvents(): AsyncIterable<TAgentEvent> {}
  publishFilesystemEvent(_path: string, _event: TFilesystemEvent): void {}
  async *subscribeFilesystemEvents(_path: string): AsyncIterable<TFilesystemEvent> {}
  publishNotification(_event: TNotificationEvent): void {}
  async *subscribeNotifications(): AsyncIterable<TNotificationEvent> {}
  getLatestNotification(): TNotificationEvent | null { return null }
}

const roots: string[] = []
const PREVIEW_ID = "preview-owner-a"

async function createDraftFixture(workspace: WidgetWorkspace, chatId: string, name: string) {
  const draftRoot = join(workspace.draftRoot, name)
  await mkdir(join(draftRoot, "actor"), { recursive: true })
  await mkdir(join(draftRoot, "widget"), { recursive: true })
  await writeFile(join(draftRoot, "vibecanvas.json"), `${JSON.stringify(fnBuildWidgetCreateManifest({ name }), null, 2)}\n`, "utf8")
  await writeFile(join(draftRoot, "actor", "functions.ts"), [
    'import { txResetError } from "./tx.resetError";',
    'export default { fn: {}, fx: {}, tx: { "tx.resetError": txResetError } };',
    '',
  ].join("\n"), "utf8")
  await writeFile(join(draftRoot, "actor", "tx.resetError.ts"), 'export async function txResetError() {}\n', "utf8")
  await writeFile(join(draftRoot, "widget", "main.ts"), 'export default {};\n', "utf8")
  await writeFile(join(draftRoot, "widget", "main.css"), '.fixture { color: black; }\n', "utf8")
  await workspace.loadWidget(chatId, name)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("WidgetDraftController", () => {
  test("exposes shared draft state without paths and rejects a stale publication revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-draft-controller-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    const workspace = new WidgetWorkspace({ dataPath, configPath })
    await workspace.init()
    const events = new TestEvents()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: events })
    const tools = createWidgetWorkspaceTools({
      workspace,
      chatId: "chat-a",
      authorize: async () => true,
      onDraftChanged: (change) => controller.handleToolChange(change),
    })

    const created = await executeTool(
      tools.find((tool) => tool.name === "vc_widget_create")!,
      { name: "Shared Clock", description: "A shared clock." },
    )
    expect(created.isError).toBeUndefined()

    const initial = await controller.get("Shared Clock")
    expect(initial).toMatchObject({
      draftId: "Shared Clock",
      state: "new",
      validation: { status: "unknown" },
      previewAvailable: true,
      publishReady: false,
    })
    expect(JSON.stringify(initial)).not.toContain(root)
    expect(await controller.getPreview("Shared Clock", PREVIEW_ID)).toMatchObject({ ready: false, reason: "not-built" })

    const validated = await controller.validate("Shared Clock", initial!.revision)
    expect(validated?.validation).toMatchObject({ status: "valid", validatedRevision: initial!.revision })
    expect(validated?.publishReady).toBe(true)

    await workspace.writeMountedFileAtomic("chat-b", "widgets/Shared Clock/widget/main.css", ".changed { color: red; }\n")
    await controller.handleToolChange({ name: "Shared Clock", type: "changed" })
    const changed = await controller.get("Shared Clock")
    expect(changed?.revision).not.toBe(initial!.revision)
    expect(changed?.validation.status).toBe("unknown")

    expect(await controller.publish("Shared Clock", initial!.revision)).toMatchObject({
      published: false,
      reason: "stale-revision",
      currentRevision: changed!.revision,
    })
    expect(events.agentEvents.filter((event) => "kind" in event && event.kind === "widget-draft").map((event) => event.type))
      .toEqual(["created", "validated", "changed"])
    await controller.close()
  })

  test("pins Preview to a private snapshot and cleans replaced, reset, failed, and closed snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-snapshot-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    const workspace = new WidgetWorkspace({ dataPath, configPath })
    await workspace.init()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const tools = createWidgetWorkspaceTools({
      workspace,
      chatId: "chat-a",
      authorize: async () => true,
      onDraftChanged: (change) => controller.handleToolChange(change),
    })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Snapshot Clock",
      description: "A snapshot-backed clock.",
    })

    const initial = await controller.get("Snapshot Clock")
    const first = await controller.buildPreview("Snapshot Clock", PREVIEW_ID, initial!.revision)
    expect(first.ready).toBe(true)
    if (!first.ready) throw new Error(first.message)
    const firstSnapshot = (await readdir(workspace.previewSnapshotRoot))[0]!
    expect(await readFile(join(workspace.previewSnapshotRoot, firstSnapshot, "widget", "main.ts"), "utf8"))
      .toBe(first.sources["main.ts"])

    await workspace.writeMountedFileAtomic(
      "chat-a",
      "widgets/Snapshot Clock/widget/main.ts",
      `${first.sources["main.ts"]}\n// shared draft changed\n`,
    )
    await controller.handleToolChange({ name: "Snapshot Clock", type: "changed" })
    const changed = await controller.get("Snapshot Clock")
    const stale = await controller.getPreview("Snapshot Clock", PREVIEW_ID)
    expect(stale).toMatchObject({ ready: true, revision: initial!.revision, currentRevision: changed!.revision, stale: true })
    if (!stale.ready) throw new Error(stale.message)
    expect(stale.sources["main.ts"]).not.toContain("shared draft changed")

    expect((await controller.refreshPreview("Snapshot Clock", PREVIEW_ID, changed!.revision)).ready).toBe(true)
    const refreshedSnapshots = await readdir(workspace.previewSnapshotRoot)
    expect(refreshedSnapshots).toHaveLength(1)
    expect(refreshedSnapshots[0]).not.toBe(firstSnapshot)
    await expect(lstat(join(workspace.previewSnapshotRoot, firstSnapshot))).rejects.toThrow()

    const beforeReset = refreshedSnapshots[0]!
    expect((await controller.resetPreview("Snapshot Clock", PREVIEW_ID, changed!.revision)).ready).toBe(true)
    const resetSnapshots = await readdir(workspace.previewSnapshotRoot)
    expect(resetSnapshots).toHaveLength(1)
    expect(resetSnapshots[0]).not.toBe(beforeReset)

    const concurrent = await Promise.all([
      controller.refreshPreview("Snapshot Clock", PREVIEW_ID, changed!.revision),
      controller.refreshPreview("Snapshot Clock", PREVIEW_ID, changed!.revision),
    ])
    expect(concurrent.every((result) => result.ready)).toBe(true)
    expect(await readdir(workspace.previewSnapshotRoot)).toHaveLength(1)

    await rename(
      join(workspace.draftRoot, "Snapshot Clock", "widget", "main.css"),
      join(workspace.draftRoot, "Snapshot Clock", "widget", "renamed.css"),
    )
    const renamed = await controller.get("Snapshot Clock")
    expect(renamed!.revision).not.toBe(changed!.revision)
    expect(await controller.getPreview("Snapshot Clock", PREVIEW_ID)).toMatchObject({ ready: true, stale: true })

    await rm(join(workspace.draftRoot, "Snapshot Clock", "widget", "main.ts"))
    const broken = await controller.get("Snapshot Clock")
    expect((await controller.buildPreview("Snapshot Clock", PREVIEW_ID, broken!.revision)).ready).toBe(false)
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
    await controller.close()
  })

  test("closes only the active Preview revision and treats missing or obsolete closes as no-ops", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-user-close-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    const workspace = new WidgetWorkspace({ dataPath, configPath })
    await workspace.init()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const tools = createWidgetWorkspaceTools({
      workspace,
      chatId: "chat-a",
      authorize: async () => true,
      onDraftChanged: (change) => controller.handleToolChange(change),
    })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Owned Preview",
    })

    const initial = await controller.get("Owned Preview")
    expect((await controller.buildPreview("Owned Preview", PREVIEW_ID, initial!.revision)).ready).toBe(true)
    await workspace.writeMountedFileAtomic(
      "chat-a",
      "widgets/Owned Preview/widget/main.css",
      ".changed { color: green; }\n",
    )
    await controller.handleToolChange({ name: "Owned Preview", type: "changed" })
    const changed = await controller.get("Owned Preview")
    expect(changed!.revision).not.toBe(initial!.revision)

    expect(await controller.closePreview("Owned Preview", PREVIEW_ID, initial!.revision)).toEqual({
      closed: true,
      draftId: "Owned Preview",
      revision: initial!.revision,
    })
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])

    expect((await controller.buildPreview("Owned Preview", PREVIEW_ID, changed!.revision)).ready).toBe(true)
    expect(await controller.closePreview("Owned Preview", PREVIEW_ID, initial!.revision)).toEqual({
      closed: false,
      draftId: "Owned Preview",
      revision: initial!.revision,
    })
    expect(await controller.getPreview("Owned Preview", PREVIEW_ID)).toMatchObject({
      ready: true,
      revision: changed!.revision,
    })
    expect(await readdir(workspace.previewSnapshotRoot)).toHaveLength(1)

    expect(await controller.closePreview("Owned Preview", PREVIEW_ID, changed!.revision)).toEqual({
      closed: true,
      draftId: "Owned Preview",
      revision: changed!.revision,
    })
    expect(await controller.closePreview("Owned Preview", PREVIEW_ID, changed!.revision)).toEqual({
      closed: false,
      draftId: "Owned Preview",
      revision: changed!.revision,
    })
    expect(await controller.getPreview("Owned Preview", PREVIEW_ID)).toMatchObject({ ready: false, reason: "not-built" })
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
    await controller.close()
  })

  test("keeps same-revision Preview owners independent when one owner closes", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-owner-isolation-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    const workspace = new WidgetWorkspace({ dataPath, configPath })
    await workspace.init()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const tools = createWidgetWorkspaceTools({ workspace, chatId: "chat-a", authorize: async () => true })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Shared Owner Preview",
    })
    const draft = await controller.get("Shared Owner Preview")
    const ownerA = "canvas-a-element"
    const ownerB = "canvas-b-element"

    expect((await controller.buildPreview("Shared Owner Preview", ownerA, draft!.revision)).ready).toBe(true)
    expect((await controller.buildPreview("Shared Owner Preview", ownerB, draft!.revision)).ready).toBe(true)
    expect(await readdir(workspace.previewSnapshotRoot)).toHaveLength(2)
    expect(await controller.getPreview("Shared Owner Preview", ownerA)).toMatchObject({
      ready: true,
      revision: draft!.revision,
    })
    expect(await controller.getPreview("Shared Owner Preview", ownerB)).toMatchObject({
      ready: true,
      revision: draft!.revision,
    })

    expect(await controller.closePreview("Shared Owner Preview", ownerA, draft!.revision)).toEqual({
      closed: true,
      draftId: "Shared Owner Preview",
      revision: draft!.revision,
    })
    expect(await controller.getPreview("Shared Owner Preview", ownerA)).toMatchObject({
      ready: false,
      reason: "not-built",
    })
    expect(await controller.getPreview("Shared Owner Preview", ownerB)).toMatchObject({
      ready: true,
      revision: draft!.revision,
    })
    expect(await readdir(workspace.previewSnapshotRoot)).toHaveLength(1)

    expect(await controller.closePreview("Shared Owner Preview", ownerB, draft!.revision)).toMatchObject({ closed: true })
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
    await controller.close()
  })

  test("serializes forgotten Preview disposal before rebuilding the same owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-forget-race-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    const workspace = new WidgetWorkspace({ dataPath, configPath })
    await workspace.init()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const tools = createWidgetWorkspaceTools({ workspace, chatId: "chat-a", authorize: async () => true })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Forgotten Preview",
    })
    const draft = await controller.get("Forgotten Preview")
    expect((await controller.buildPreview("Forgotten Preview", PREVIEW_ID, draft!.revision)).ready).toBe(true)

    const forgetting = controller.forget("Forgotten Preview")
    const rebuilding = controller.buildPreview("Forgotten Preview", PREVIEW_ID, draft!.revision)
    await forgetting
    expect((await rebuilding).ready).toBe(true)
    expect(await controller.getPreview("Forgotten Preview", PREVIEW_ID)).toMatchObject({
      ready: true,
      revision: draft!.revision,
    })
    expect(await readdir(workspace.previewSnapshotRoot)).toHaveLength(1)

    await controller.close()
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
  })

  test("drains an in-flight build and blocks later builds through destructive draft cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-destructive-race-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    let releaseCopy!: () => void
    let markCopyStarted!: () => void
    let releaseRemoval!: () => void
    let markCleanupDone!: () => void
    const copyStarted = new Promise<void>((resolve) => { markCopyStarted = resolve })
    const copyReleased = new Promise<void>((resolve) => { releaseCopy = resolve })
    const cleanupDone = new Promise<void>((resolve) => { markCleanupDone = resolve })
    const removalReleased = new Promise<void>((resolve) => { releaseRemoval = resolve })
    const copyDirectory = (async (source, destination, options) => {
      if (String(destination).includes("preview-snapshots")) {
        markCopyStarted()
        await copyReleased
      }
      await cp(source, destination, options)
    }) as typeof cp
    const workspace = new WidgetWorkspace({ dataPath, configPath, copyDirectory })
    await workspace.init()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const tools = createWidgetWorkspaceTools({ workspace, chatId: "chat-a", authorize: async () => true })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Destructive Preview",
    })
    await expect(workspace.getDraft("destructive preview")).rejects.toThrow("collides with existing")
    const draft = await controller.get("Destructive Preview")

    const building = controller.buildPreview("Destructive Preview", "owner-building", draft!.revision)
    await copyStarted
    const removing = controller.withPreviewCleanup("Destructive Preview", async (cleanup) => {
      await cleanup()
      markCleanupDone()
      await removalReleased
      return workspace.removeDraft("Destructive Preview")
    })
    let lateBuildSettled = false
    const lateBuild = controller.buildPreview("  Destructive   Preview  ", "owner-late", draft!.revision)
      .finally(() => { lateBuildSettled = true })

    releaseCopy()
    expect((await building).ready).toBe(true)
    await cleanupDone
    expect(lateBuildSettled).toBe(false)
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
    releaseRemoval()
    expect(await removing).toBe(true)
    expect(await lateBuild).toMatchObject({ ready: false, reason: "not-found" })
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
    await controller.close()
  })

  test("uses one deterministic lock order for distinct Unicode draft identities", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-lock-order-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    const workspace = new WidgetWorkspace({ dataPath, configPath })
    await workspace.init()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    let markFirstStarted!: () => void
    let releaseFirst!: () => void
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve })
    const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve })

    const first = controller.withPreviewRenameCleanup("ab", "a\u200bb", async () => {
      markFirstStarted()
      await firstReleased
    })
    await firstStarted
    let secondStarted = false
    const second = controller.withPreviewRenameCleanup("a\u200bb", "ab", async () => {
      secondStarted = true
    })
    await Promise.resolve()
    expect(secondStarted).toBe(false)

    releaseFirst()
    await first
    await second
    expect(secondStarted).toBe(true)
    await controller.close()
  })

  test("locks both draft identities while a visible rename is rolled back", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-rename-rollback-race-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    const workspace = new WidgetWorkspace({ dataPath, configPath })
    await workspace.init()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const tools = createWidgetWorkspaceTools({ workspace, chatId: "chat-a", authorize: async () => true })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Rename Source",
    })
    const draft = await controller.get("Rename Source")
    let markRenamed!: () => void
    let releaseRollback!: () => void
    const renamed = new Promise<void>((resolve) => { markRenamed = resolve })
    const rollbackReleased = new Promise<void>((resolve) => { releaseRollback = resolve })
    const sourcePath = join(workspace.draftRoot, "Rename Source")
    const nextPath = join(workspace.draftRoot, "Rename Target")

    const rollingBack = controller.withPreviewRenameCleanup("Rename Source", "Rename Target", async (cleanup) => {
      await cleanup()
      await rename(sourcePath, nextPath)
      markRenamed()
      await rollbackReleased
      await rename(nextPath, sourcePath)
      throw new Error("Simulated mount migration rollback.")
    })
    await renamed
    let buildSettled = false
    const building = controller.buildPreview("Rename Target", "rename-target-owner", draft!.revision)
      .finally(() => { buildSettled = true })
    await Promise.resolve()
    expect(buildSettled).toBe(false)

    releaseRollback()
    await expect(rollingBack).rejects.toThrow("mount migration rollback")
    expect(await building).toMatchObject({ ready: false, reason: "not-found" })
    expect(await workspace.getDraft("Rename Source")).not.toBeNull()
    expect(await workspace.getDraft("Rename Target")).toBeNull()
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
    await controller.close()
  })

  test("queues a user close behind an in-flight Preview build", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-user-close-race-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    let releaseCopy!: () => void
    let markCopyStarted!: () => void
    const copyStarted = new Promise<void>((resolve) => { markCopyStarted = resolve })
    const copyReleased = new Promise<void>((resolve) => { releaseCopy = resolve })
    const copyDirectory = (async (source, destination, options) => {
      if (String(destination).includes("preview-snapshots")) {
        markCopyStarted()
        await copyReleased
      }
      await cp(source, destination, options)
    }) as typeof cp
    const workspace = new WidgetWorkspace({ dataPath, configPath, copyDirectory })
    await workspace.init()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const tools = createWidgetWorkspaceTools({ workspace, chatId: "chat-a", authorize: async () => true })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Queued Close",
    })
    const draft = await controller.get("Queued Close")

    const building = controller.buildPreview("Queued Close", PREVIEW_ID, draft!.revision)
    await copyStarted
    const closing = controller.closePreview("Queued Close", PREVIEW_ID, draft!.revision)
    releaseCopy()
    expect((await building).ready).toBe(true)
    expect(await closing).toEqual({
      closed: true,
      draftId: "Queued Close",
      revision: draft!.revision,
    })
    expect(await controller.getPreview("Queued Close", PREVIEW_ID)).toMatchObject({ ready: false, reason: "not-built" })
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
    await controller.close()
  })

  test("registers build ownership before draft lookup so response-loss cleanup cannot overtake it", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-initial-read-race-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    const workspace = new WidgetWorkspace({ dataPath, configPath })
    await workspace.init()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const tools = createWidgetWorkspaceTools({ workspace, chatId: "chat-a", authorize: async () => true })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Initial Read Preview",
    })
    const draft = await controller.get("Initial Read Preview")
    const originalGetDraft = workspace.getDraft.bind(workspace)
    let releaseRead!: () => void
    let markReadStarted!: () => void
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
    const readReleased = new Promise<void>((resolve) => { releaseRead = resolve })
    let delayNextRead = true
    workspace.getDraft = async (name) => {
      if (delayNextRead && name === "Initial Read Preview") {
        delayNextRead = false
        markReadStarted()
        await readReleased
      }
      return originalGetDraft(name)
    }

    const building = controller.buildPreview("Initial Read Preview", PREVIEW_ID, draft!.revision)
    await readStarted
    const closing = controller.closePreview("Initial Read Preview", PREVIEW_ID, draft!.revision)
    releaseRead()

    expect((await building).ready).toBe(true)
    expect(await closing).toEqual({
      closed: true,
      draftId: "Initial Read Preview",
      revision: draft!.revision,
    })
    expect(await controller.getPreview("Initial Read Preview", PREVIEW_ID)).toMatchObject({ ready: false, reason: "not-built" })
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
    await controller.close()
  })

  test("queues actor messages behind a same-owner Preview replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-send-race-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    let blockPreviewCopy = false
    let releaseCopy!: () => void
    let markCopyStarted!: () => void
    const copyStarted = new Promise<void>((resolve) => { markCopyStarted = resolve })
    const copyReleased = new Promise<void>((resolve) => { releaseCopy = resolve })
    const copyDirectory = (async (source, destination, options) => {
      if (blockPreviewCopy && String(destination).includes("preview-snapshots")) {
        markCopyStarted()
        await copyReleased
      }
      await cp(source, destination, options)
    }) as typeof cp
    const workspace = new WidgetWorkspace({ dataPath, configPath, copyDirectory })
    await workspace.init()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const tools = createWidgetWorkspaceTools({ workspace, chatId: "chat-a", authorize: async () => true })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Queued Message",
    })
    const draft = await controller.get("Queued Message")
    expect((await controller.buildPreview("Queued Message", PREVIEW_ID, draft!.revision)).ready).toBe(true)

    blockPreviewCopy = true
    const resetting = controller.resetPreview("Queued Message", PREVIEW_ID, draft!.revision)
    await copyStarted
    const sending = controller.sendPreview("Queued Message", PREVIEW_ID, draft!.revision, "tick", { by: 1 })
    const earlyResult = await Promise.race([
      sending.then(() => "settled" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 20)),
    ])
    expect(earlyResult).toBe("pending")

    releaseCopy()
    expect((await resetting).ready).toBe(true)
    expect(await sending).toMatchObject({ ready: true, revision: draft!.revision })
    expect(await controller.getPreview("Queued Message", PREVIEW_ID)).toMatchObject({
      ready: true,
      revision: draft!.revision,
    })

    await controller.close()
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
  })

  test("close drains an in-flight Preview build before deleting its snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-close-race-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    let releaseCopy!: () => void
    let markCopyStarted!: () => void
    const copyStarted = new Promise<void>((resolve) => { markCopyStarted = resolve })
    const copyReleased = new Promise<void>((resolve) => { releaseCopy = resolve })
    const copyDirectory = (async (source, destination, options) => {
      if (String(destination).includes("preview-snapshots")) {
        markCopyStarted()
        await copyReleased
      }
      await cp(source, destination, options)
    }) as typeof cp
    const workspace = new WidgetWorkspace({ dataPath, configPath, copyDirectory })
    await workspace.init()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const tools = createWidgetWorkspaceTools({ workspace, chatId: "chat-a", authorize: async () => true })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Closing Preview",
    })
    const draft = await controller.get("Closing Preview")

    const building = controller.buildPreview("Closing Preview", PREVIEW_ID, draft!.revision)
    await copyStarted
    const closing = controller.close()
    let destructiveOperationRan = false
    await expect(controller.withPreviewCleanup("Closing Preview", async () => {
      destructiveOperationRan = true
    })).rejects.toThrow("Preview service is closing")
    expect(destructiveOperationRan).toBe(false)
    releaseCopy()
    expect((await building).ready).toBe(true)
    await closing
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
    expect(await controller.buildPreview("Closing Preview", PREVIEW_ID, draft!.revision)).toMatchObject({
      ready: false,
      reason: "build-failed",
    })
  })

  test("close drains every Preview owner before surfacing a cleanup failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-close-failure-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    const workspace = new WidgetWorkspace({ dataPath, configPath })
    await workspace.init()
    const createPreviewSnapshot = workspace.createPreviewSnapshot.bind(workspace)
    let snapshotIndex = 0
    let markFastDispose!: () => void
    let markSlowDispose!: () => void
    let releaseSlowDispose!: () => void
    const fastDisposeStarted = new Promise<void>((resolve) => { markFastDispose = resolve })
    const slowDisposeStarted = new Promise<void>((resolve) => { markSlowDispose = resolve })
    const slowDisposeReleased = new Promise<void>((resolve) => { releaseSlowDispose = resolve })
    workspace.createPreviewSnapshot = async (name, revision) => {
      const snapshot = await createPreviewSnapshot(name, revision)
      const currentIndex = snapshotIndex++
      return {
        ...snapshot,
        dispose: async () => {
          if (currentIndex === 0) {
            await snapshot.dispose()
            markFastDispose()
            throw new Error("Simulated owner cleanup failure.")
          }
          markSlowDispose()
          await slowDisposeReleased
          await snapshot.dispose()
        },
      }
    }
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const tools = createWidgetWorkspaceTools({ workspace, chatId: "chat-a", authorize: async () => true })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Close Failure Preview",
    })
    const draft = await controller.get("Close Failure Preview")
    expect((await controller.buildPreview("Close Failure Preview", "owner-fast", draft!.revision)).ready).toBe(true)
    expect((await controller.buildPreview("Close Failure Preview", "owner-slow", draft!.revision)).ready).toBe(true)

    let closeSettled = false
    const closing = controller.close()
    closing.then(() => { closeSettled = true }, () => { closeSettled = true })
    await Promise.all([fastDisposeStarted, slowDisposeStarted])
    await Promise.resolve()
    expect(closeSettled).toBe(false)

    releaseSlowDispose()
    await expect(closing).rejects.toThrow("Simulated owner cleanup failure")
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
  })

  test("destructive cleanup drains every Preview owner before surfacing a failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-transaction-failure-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    const workspace = new WidgetWorkspace({ dataPath, configPath })
    await workspace.init()
    const createPreviewSnapshot = workspace.createPreviewSnapshot.bind(workspace)
    let snapshotIndex = 0
    let markFastDispose!: () => void
    let markSlowDispose!: () => void
    let releaseSlowDispose!: () => void
    const fastDisposeStarted = new Promise<void>((resolve) => { markFastDispose = resolve })
    const slowDisposeStarted = new Promise<void>((resolve) => { markSlowDispose = resolve })
    const slowDisposeReleased = new Promise<void>((resolve) => { releaseSlowDispose = resolve })
    workspace.createPreviewSnapshot = async (name, revision) => {
      const snapshot = await createPreviewSnapshot(name, revision)
      const currentIndex = snapshotIndex++
      return {
        ...snapshot,
        dispose: async () => {
          if (currentIndex === 0) {
            await snapshot.dispose()
            markFastDispose()
            throw new Error("Simulated transaction cleanup failure.")
          }
          markSlowDispose()
          await slowDisposeReleased
          await snapshot.dispose()
        },
      }
    }
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const tools = createWidgetWorkspaceTools({ workspace, chatId: "chat-a", authorize: async () => true })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Transaction Failure Preview",
    })
    const draft = await controller.get("Transaction Failure Preview")
    expect((await controller.buildPreview("Transaction Failure Preview", "owner-fast", draft!.revision)).ready).toBe(true)
    expect((await controller.buildPreview("Transaction Failure Preview", "owner-slow", draft!.revision)).ready).toBe(true)

    let transactionSettled = false
    const transaction = controller.withPreviewCleanup("Transaction Failure Preview", async (cleanup) => {
      await cleanup()
      return workspace.removeDraft("Transaction Failure Preview")
    })
    transaction.then(() => { transactionSettled = true }, () => { transactionSettled = true })
    await Promise.all([fastDisposeStarted, slowDisposeStarted])
    await Promise.resolve()
    expect(transactionSettled).toBe(false)
    expect(await workspace.getDraft("Transaction Failure Preview")).not.toBeNull()

    releaseSlowDispose()
    await expect(transaction).rejects.toThrow("Simulated transaction cleanup failure")
    expect(await workspace.getDraft("Transaction Failure Preview")).not.toBeNull()
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
  })

  test("rejects and cleans a Preview snapshot when an external edit lands during its copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-race-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    let mutateDuringCopy = false
    const copyDirectory = (async (source, destination, options) => {
      await cp(source, destination, options)
      if (mutateDuringCopy && String(destination).includes("preview-snapshots")) {
        await rename(
          join(String(source), "widget", "main.css"),
          join(String(source), "widget", "renamed.css"),
        )
      }
    }) as typeof cp
    const workspace = new WidgetWorkspace({ dataPath, configPath, copyDirectory })
    await workspace.init()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const tools = createWidgetWorkspaceTools({ workspace, chatId: "chat-a", authorize: async () => true })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Racing Clock",
    })
    const initial = await controller.get("Racing Clock")
    mutateDuringCopy = true

    expect(await controller.buildPreview("Racing Clock", PREVIEW_ID, initial!.revision)).toMatchObject({
      ready: false,
      reason: "stale-revision",
    })
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
    expect(await readFile(join(workspace.draftRoot, "Racing Clock", "widget", "renamed.css"), "utf8")).toContain("system-ui")
    await controller.close()
  })

  test("loads Actor functions and returned widget sources from the accepted snapshot after the shared draft changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-preview-causal-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    let mutateAfterSnapshot = false
    class CausalWorkspace extends WidgetWorkspace {
      override async createPreviewSnapshot(name: string, expectedRevision: string) {
        const snapshot = await super.createPreviewSnapshot(name, expectedRevision)
        if (mutateAfterSnapshot) {
          const draftRoot = join(this.draftRoot, name)
          await writeFile(join(draftRoot, "actor", "fx.loadVersion.ts"), [
            "import type { TFxArgs, TFxPortal } from '@vibecanvas/sdk/actor';",
            "export async function fxLoadVersion(portal: TFxPortal, args: TFxArgs) {",
            "  void args;",
            "  await portal.setData({ version: 'draft' });",
            "  return portal.next();",
            "}",
            "",
          ].join("\n"), "utf8")
          await writeFile(join(draftRoot, "widget", "main.ts"), "export const revision = 'draft';\n", "utf8")
        }
        return snapshot
      }
    }
    const workspace = new CausalWorkspace({ dataPath, configPath })
    await workspace.init()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const tools = createWidgetWorkspaceTools({ workspace, chatId: "chat-a", authorize: async () => true })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Causal Preview",
    })
    const draftRoot = join(workspace.draftRoot, "Causal Preview")
    const manifestPath = join(draftRoot, "vibecanvas.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.actor.initialData = { version: "initial" }
    manifest.actor.dataSchema = {
      type: "object",
      properties: { version: { type: "string" } },
      required: ["version"],
      additionalProperties: false,
    }
    manifest.actor.states.ready.onEnter = ["fx.loadVersion"]
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
    await writeFile(join(draftRoot, "actor", "fx.loadVersion.ts"), [
      "import type { TFxArgs, TFxPortal } from '@vibecanvas/sdk/actor';",
      "export async function fxLoadVersion(portal: TFxPortal, args: TFxArgs) {",
      "  void args;",
      "  await portal.setData({ version: 'snapshot' });",
      "  return portal.next();",
      "}",
      "",
    ].join("\n"), "utf8")
    await writeFile(join(draftRoot, "actor", "functions.ts"), [
      "import { fxLoadVersion } from './fx.loadVersion';",
      "import { txResetError } from './tx.resetError';",
      "export default {",
      "  fn: {},",
      "  fx: { 'fx.loadVersion': fxLoadVersion },",
      "  tx: { 'tx.resetError': txResetError },",
      "};",
      "",
    ].join("\n"), "utf8")
    await writeFile(join(draftRoot, "widget", "main.ts"), "export const revision = 'snapshot';\n", "utf8")
    const accepted = await controller.get("Causal Preview")
    mutateAfterSnapshot = true

    const preview = await controller.buildPreview("Causal Preview", PREVIEW_ID, accepted!.revision)
    expect(preview).toMatchObject({
      ready: true,
      revision: accepted!.revision,
      stale: true,
      snapshot: { context: { version: "snapshot" } },
      sources: { "main.ts": "export const revision = 'snapshot';\n" },
    })
    expect(await readFile(join(draftRoot, "actor", "fx.loadVersion.ts"), "utf8")).toContain("version: 'draft'")
    expect(await readFile(join(draftRoot, "widget", "main.ts"), "utf8")).toContain("revision = 'draft'")
    await controller.close()
  })

  test("republishes the original slug but rejects a published slug change before mutating either installation", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-published-slug-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    const workspace = new WidgetWorkspace({ dataPath, configPath })
    await workspace.init()
    const controller = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    const management = new WidgetManagement({ workspace, drafts: controller })
    await createDraftFixture(workspace, "chat-a", "Stable Slug")

    const initial = await controller.get("Stable Slug")
    expect((await controller.buildPreview("Stable Slug", PREVIEW_ID, initial!.revision)).ready).toBe(true)
    expect((await controller.publish("Stable Slug", initial!.revision)).published).toBe(true)
    expect(await controller.get("Stable Slug")).toMatchObject({ revision: initial!.revision })
    expect((await workspace.listMounts("chat-a"))[0]).toMatchObject({ name: "Stable Slug", source: "draft" })
    expect(await readdir(workspace.previewSnapshotRoot)).toHaveLength(1)
    expect(await controller.getPreview("Stable Slug", PREVIEW_ID)).toMatchObject({ ready: true, revision: initial!.revision })
    expect(await management.detail("Stable Slug", "draft")).toMatchObject({ source: "draft" })
    expect(await management.detail("Stable Slug", "published")).toMatchObject({ source: "published", sibling: { source: "draft" } })
    const publishedManifestPath = join(workspace.publishedRoot, "Stable Slug", "vibecanvas.json")
    await writeFile(publishedManifestPath, `${(await readFile(publishedManifestPath, "utf8")).trim()}  \n`, "utf8")
    const publishedCatalog = await management.catalog([])
    expect(publishedCatalog.widgets).toEqual([
      expect.objectContaining({ name: "Stable Slug", relation: "same", draft: expect.anything() }),
    ])
    expect(publishedCatalog.widgets[0]?.published?.contentFingerprint)
      .not.toBe(publishedCatalog.widgets[0]?.draft?.contentFingerprint)

    await writeFile(join(workspace.draftRoot, "Stable Slug", "widget", "main.css"), ".same-slug { color: green; }\n", "utf8")
    const sameSlug = await controller.get("Stable Slug")
    expect((await management.catalog([])).widgets[0]?.relation).toBe("different")
    expect((await controller.publish("Stable Slug", sameSlug!.revision)).published).toBe(true)
    expect(await controller.get("Stable Slug")).toMatchObject({ revision: sameSlug!.revision })
    expect((await management.catalog([])).widgets[0]?.relation).toBe("same")
    expect(await readFile(join(configPath, "widgets", "stable-slug", "widget", "main.css"), "utf8"))
      .toContain("same-slug")

    const manifestPath = join(workspace.draftRoot, "Stable Slug", "vibecanvas.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.slug = "stable-slug-v2"
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
    const changed = await controller.get("Stable Slug")
    const rejected = await controller.publish("Stable Slug", changed!.revision)
    expect(rejected).toMatchObject({
      published: false,
      reason: "publication-failed",
      message: expect.stringContaining("Published slug 'stable-slug' is immutable"),
    })
    expect(await readFile(join(configPath, "widgets", "stable-slug", "widget", "main.css"), "utf8"))
      .toContain("same-slug")
    await expect(lstat(join(configPath, "widgets", "stable-slug-v2"))).rejects.toThrow()
    expect(JSON.parse(await readFile(join(workspace.publishedRoot, "Stable Slug", "vibecanvas.json"), "utf8")).slug)
      .toBe("stable-slug")
    await controller.close()
  })

  test("restores full binding scopes and files after a post-replacement instance reload failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "vc-widget-binding-compensation-"))
    roots.push(root)
    const dataPath = join(root, "data")
    const configPath = join(root, "config")
    await mkdir(join(configPath, "widgets"), { recursive: true })
    const workspace = new WidgetWorkspace({ dataPath, configPath })
    await workspace.init()
    const firstController = new WidgetDraftController({ configPath, workspace, eventPublisher: new TestEvents() })
    await createDraftFixture(workspace, "chat-a", "Binding Compensation")
    const initial = await firstController.get("Binding Compensation")
    expect((await firstController.publish("Binding Compensation", initial!.revision)).published).toBe(true)
    await firstController.close()

    await workspace.ensureDraftFromPublished("Binding Compensation")
    const draftRoot = join(workspace.draftRoot, "Binding Compensation")
    const manifestPath = join(draftRoot, "vibecanvas.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.actor.resources = {
      storage: { kind: "kv", required: true, scope: ["read", "write"] },
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
    await writeFile(join(draftRoot, "widget", "main.css"), ".new-publication { color: red; }\n", "utf8")

    let bindingState = [{ slot_name: "storage", resource_id: "old-resource", allow_read: true, allow_write: false }]
    const replacements: { definitionName: string; bindings: readonly { slot: string; resourceId: string; scope: ("read" | "write")[] }[] }[] = []
    let publicationTransitions = 0
    const controller = new WidgetDraftController({
      configPath,
      workspace,
      eventPublisher: new TestEvents(),
      actorService: {
        reload: async () => {},
        listResources: async () => [{
          id: "new-resource",
          kind: "kv",
          name: "New resource",
          status: "ready",
          last_error: null,
          created_at: "2026-07-18T00:00:00.000Z",
          updated_at: "2026-07-18T00:00:00.000Z",
        }],
        listResourceBindingsForDefinition: async () => bindingState,
        transitionDefinitionPublication: async (args) => {
          replacements.push({ definitionName: args.definitionName, bindings: args.bindings })
          bindingState = args.bindings.map((binding) => ({
            slot_name: binding.slot,
            resource_id: binding.resourceId,
            allow_read: binding.scope.includes("read"),
            allow_write: binding.scope.includes("write"),
          }))
          publicationTransitions += 1
          if (publicationTransitions === 1) {
            throw Object.assign(new Error("instance reload failed"), { bindingReplacementCommitted: true })
          }
        },
      },
    })
    const changed = await controller.get("Binding Compensation")
    const failed = await controller.publish("Binding Compensation", changed!.revision)
    expect(failed).toMatchObject({ published: false, reason: "publication-failed", message: "instance reload failed" })
    expect(replacements).toEqual([
      {
        definitionName: "Binding Compensation",
        bindings: [{ slot: "storage", resourceId: "new-resource", scope: ["read", "write"] }],
      },
      {
        definitionName: "Binding Compensation",
        bindings: [{ slot: "storage", resourceId: "old-resource", scope: ["read"] }],
      },
    ])
    expect(bindingState).toEqual([{ slot_name: "storage", resource_id: "old-resource", allow_read: true, allow_write: false }])
    expect(publicationTransitions).toBe(2)
    expect(await readFile(join(workspace.publishedRoot, "Binding Compensation", "widget", "main.css"), "utf8"))
      .not.toContain("new-publication")
    expect(await readFile(join(configPath, "widgets", "binding-compensation", "widget", "main.css"), "utf8"))
      .not.toContain("new-publication")
    await controller.close()
  })
})
