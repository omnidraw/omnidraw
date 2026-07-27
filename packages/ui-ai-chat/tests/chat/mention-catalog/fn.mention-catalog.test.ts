import type { TWidgetCatalog, TWidgetVariantSummary } from "@vibecanvas/orpc-client"
import { describe, expect, it } from "vitest"
import { fnIsWidgetCatalogEventKind, fnProjectMentionCatalog } from "../../../src/chat/mention-catalog/fn.mention-catalog"

function variant(source: "published" | "draft", displayName = "Camera"): TWidgetVariantSummary {
  return {
    source,
    displayName,
    kind: "notes-widget",
    slug: "camera",
    description: null,
    revision: source,
    contentFingerprint: source,
    updatedAt: null,
    tool: { label: displayName, icon: { lucidIcon: "Camera" }, group: null, priority: null, behaviorType: "action" },
    validation: source === "draft" ? { status: "unknown", errors: [], warnings: [] } : null,
  }
}

describe("mention catalog projection", () => {
  it("uses typed identities and configured icons for resources and widgets", () => {
    const catalog: TWidgetCatalog = {
      generation: "one",
      groups: [],
      widgets: [{
        name: "CameraInternal",
        relation: "different",
        published: variant("published"),
        draft: variant("draft"),
        problem: null,
      }],
    }
    const mentions = fnProjectMentionCatalog([{
      id: "db-1",
      kind: "db",
      name: "Camera",
      status: "ready",
    }], catalog)

    expect(mentions.map((mention) => mention.id)).toEqual([
      "resource:db-1",
      "widget:draft:CameraInternal",
      "widget:published:CameraInternal",
    ])
    expect(mentions[0]).toMatchObject({ target: { type: "resource", resourceId: "db-1" }, icon: { type: "resource", kind: "db" } })
    expect(mentions[1]).toMatchObject({ kind: "Draft widget · CameraInternal", target: { type: "widget", name: "CameraInternal", source: "draft" } })
    expect(mentions[1]?.icon).toEqual({ type: "widget", icon: { lucidIcon: "Camera" } })
  })

  it("collapses identical draft/published variants to the published target", () => {
    const mentions = fnProjectMentionCatalog([], {
      generation: "same",
      groups: [],
      widgets: [{ name: "Camera", relation: "same", published: variant("published"), draft: variant("draft"), problem: null }],
    })
    expect(mentions.map((mention) => mention.target)).toEqual([{ type: "widget", name: "Camera", source: "published" }])
  })

  it("recognizes every widget mutation event that can change suggestions", () => {
    expect(["widget-draft", "widget-published", "widgetupdate", "widget-catalog"].every(fnIsWidgetCatalogEventKind)).toBe(true)
    expect(fnIsWidgetCatalogEventKind("approval")).toBe(false)
  })
})
