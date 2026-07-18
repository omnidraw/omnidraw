import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types"
import { describe, expect, test, vi } from "vitest"
import { fnCreateClonedWidgetElement } from "../../../src/services/widget/fn.create-cloned-widget-element"

function createAiChatElement(): TElement {
  return {
    id: "source-widget",
    x: 10,
    y: 20,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: "a0",
    parentGroupId: "group-1",
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    style: {},
    data: {
      type: "ui-widget",
      kind: "ai-chat",
      w: 420,
      h: 640,
      expanded: true,
      window: "contained",
      payload: { sessionId: "source-session" },
    },
  }
}

describe("fnCreateClonedWidgetElement", () => {
  test("gives a cloned AI Chat a fresh generated session payload", () => {
    const createUiWidgetPayload = vi.fn(() => ({ sessionId: "fresh-session" }))
    const cloned = fnCreateClonedWidgetElement({
      clone: (value) => structuredClone(value),
      createId: () => "cloned-widget",
      createUiWidgetPayload,
      now: () => 42,
    }, { sourceElement: createAiChatElement() })

    expect(createUiWidgetPayload).toHaveBeenCalledTimes(1)
    expect(cloned).toMatchObject({
      id: "cloned-widget",
      createdAt: 42,
      updatedAt: 42,
      parentGroupId: null,
      zIndex: "",
      data: { type: "ui-widget", payload: { sessionId: "fresh-session" } },
    })
    expect(cloned.data.type === "ui-widget" && cloned.data.payload).not.toEqual({ sessionId: "source-session" })
  })
})
