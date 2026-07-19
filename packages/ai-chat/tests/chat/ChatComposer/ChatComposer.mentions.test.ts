import { describe, expect, it } from "vitest"
import { getEditorMentions } from "../../../src/chat/components/ChatComposer/ChatComposer"

function fakeView(nodes: Array<{ type: { name: string }; attrs?: Record<string, unknown> }>) {
  return {
    state: {
      doc: {
        descendants(visitor: (node: unknown) => boolean) {
          nodes.forEach((node) => visitor(node))
        },
      },
    },
  } as never
}

describe("ChatComposer resource mention authority", () => {
  it("derives submitted mentions from the current document", () => {
    const selected = getEditorMentions(fakeView([
      { type: { name: "text" } },
      { type: { name: "mention" }, attrs: { id: "db-1", label: "Notes", kind: "Database" } },
    ]))
    expect(selected).toEqual([{ id: "db-1", label: "Notes", kind: "Database" }])
  })

  it("does not submit a resource after its mention node is removed", () => {
    expect(getEditorMentions(fakeView([{ type: { name: "text" } }]))).toEqual([])
  })

  it("keeps an inserted widget bound to its exact source and stale name snapshot", () => {
    expect(getEditorMentions(fakeView([{
      type: { name: "mention" },
      attrs: {
        id: "widget:draft:Weather",
        label: "Weather dashboard",
        kind: "Draft widget · Weather",
        targetType: "widget",
        widgetName: "Weather",
        widgetSource: "draft",
      },
    }]))).toEqual([{
      id: "widget:draft:Weather",
      label: "Weather dashboard",
      kind: "Draft widget · Weather",
      target: { type: "widget", name: "Weather", source: "draft" },
    }])
  })
})
