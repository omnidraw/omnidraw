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
import { WidgetDraftController } from "../src/widget-drafts/WidgetDraftController"
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
      { name: "Shared Clock", kind: "widget", description: "A shared clock." },
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
    expect(await controller.getPreview("Shared Clock")).toMatchObject({ ready: false, reason: "not-built" })

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
      kind: "actor-widget",
      description: "A snapshot-backed clock.",
    })

    const initial = await controller.get("Snapshot Clock")
    const first = await controller.buildPreview("Snapshot Clock", initial!.revision)
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
    const stale = await controller.getPreview("Snapshot Clock")
    expect(stale).toMatchObject({ ready: true, revision: initial!.revision, currentRevision: changed!.revision, stale: true })
    if (!stale.ready) throw new Error(stale.message)
    expect(stale.sources["main.ts"]).not.toContain("shared draft changed")

    expect((await controller.refreshPreview("Snapshot Clock", changed!.revision)).ready).toBe(true)
    const refreshedSnapshots = await readdir(workspace.previewSnapshotRoot)
    expect(refreshedSnapshots).toHaveLength(1)
    expect(refreshedSnapshots[0]).not.toBe(firstSnapshot)
    await expect(lstat(join(workspace.previewSnapshotRoot, firstSnapshot))).rejects.toThrow()

    const beforeReset = refreshedSnapshots[0]!
    expect((await controller.resetPreview("Snapshot Clock", changed!.revision)).ready).toBe(true)
    const resetSnapshots = await readdir(workspace.previewSnapshotRoot)
    expect(resetSnapshots).toHaveLength(1)
    expect(resetSnapshots[0]).not.toBe(beforeReset)

    const concurrent = await Promise.all([
      controller.refreshPreview("Snapshot Clock", changed!.revision),
      controller.refreshPreview("Snapshot Clock", changed!.revision),
    ])
    expect(concurrent.every((result) => result.ready)).toBe(true)
    expect(await readdir(workspace.previewSnapshotRoot)).toHaveLength(1)

    await rename(
      join(workspace.draftRoot, "Snapshot Clock", "widget", "main.css"),
      join(workspace.draftRoot, "Snapshot Clock", "widget", "renamed.css"),
    )
    const renamed = await controller.get("Snapshot Clock")
    expect(renamed!.revision).not.toBe(changed!.revision)
    expect(await controller.getPreview("Snapshot Clock")).toMatchObject({ ready: true, stale: true })

    await rm(join(workspace.draftRoot, "Snapshot Clock", "widget", "main.ts"))
    const broken = await controller.get("Snapshot Clock")
    expect((await controller.buildPreview("Snapshot Clock", broken!.revision)).ready).toBe(false)
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
    await controller.close()
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
      kind: "actor-widget",
    })
    const draft = await controller.get("Closing Preview")

    const building = controller.buildPreview("Closing Preview", draft!.revision)
    await copyStarted
    const closing = controller.close()
    releaseCopy()
    expect((await building).ready).toBe(true)
    await closing
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([])
    expect(await controller.buildPreview("Closing Preview", draft!.revision)).toMatchObject({
      ready: false,
      reason: "build-failed",
    })
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
      kind: "actor-widget",
    })
    const initial = await controller.get("Racing Clock")
    mutateDuringCopy = true

    expect(await controller.buildPreview("Racing Clock", initial!.revision)).toMatchObject({
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
      kind: "actor-widget",
    })
    const draftRoot = join(workspace.draftRoot, "Causal Preview")
    const manifestPath = join(draftRoot, "vibecanvas.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.actor.initialData = { version: "initial" }
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
      "import { txUpdate } from './tx.update';",
      "export default {",
      "  fn: {},",
      "  fx: { 'fx.loadVersion': fxLoadVersion },",
      "  tx: { 'tx.resetError': txResetError, 'tx.update': txUpdate },",
      "};",
      "",
    ].join("\n"), "utf8")
    await writeFile(join(draftRoot, "widget", "main.ts"), "export const revision = 'snapshot';\n", "utf8")
    const accepted = await controller.get("Causal Preview")
    mutateAfterSnapshot = true

    const preview = await controller.buildPreview("Causal Preview", accepted!.revision)
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
    const tools = createWidgetWorkspaceTools({ workspace, chatId: "chat-a", authorize: async () => true })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Stable Slug",
      kind: "widget",
    })

    const initial = await controller.get("Stable Slug")
    expect((await controller.publish("Stable Slug", initial!.revision)).published).toBe(true)
    await writeFile(join(workspace.draftRoot, "Stable Slug", "widget", "main.css"), ".same-slug { color: green; }\n", "utf8")
    const sameSlug = await controller.get("Stable Slug")
    expect((await controller.publish("Stable Slug", sameSlug!.revision)).published).toBe(true)
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
    const tools = createWidgetWorkspaceTools({ workspace, chatId: "chat-a", authorize: async () => true })
    await executeTool(tools.find((tool) => tool.name === "vc_widget_create")!, {
      name: "Binding Compensation",
      kind: "actor-widget",
    })
    const initial = await firstController.get("Binding Compensation")
    expect((await firstController.publish("Binding Compensation", initial!.revision)).published).toBe(true)
    await firstController.close()

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
