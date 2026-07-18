import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
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
    controller.close()
  })
})
